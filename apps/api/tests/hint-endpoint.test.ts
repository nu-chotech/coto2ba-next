/**
 * ヒントのエンドポイントの統合テスト（SPEC §3.3 / §7.5）。
 *
 * ここで守りたいのは「シートで選んだヒントを**そのまま打てて、順位が上がる**」こと。
 * - 返す比率が 8 段階でなければサーバー自身が 422 を返す（丸めない契約）
 * - 提案どおりに混ぜたとき rank が改善する
 * - hint_candidate_cache（jsonb）を経由しても同じヒントが返る
 *
 * vocab のデータが無ければ skipped として報告する（実行 0 件の passed にしない）。
 */
import { hintResponseSchema, RATIOS } from '@coto2ba/contracts'
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { games, hintCache, hintCandidateCache, moves, session, user } from '../src/db/schema'
import { openHints } from '../src/services/game'
import { SKIP_WITHOUT_DB, SKIP_WITHOUT_VOCAB } from './db-available'

const createdUserIds: string[] = []

afterAll(async () => {
  for (const id of createdUserIds) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {})
  }
  await pool.end().catch(() => {})
})

async function signIn(): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(user).values({
    id,
    name: 'ヒント検証',
    email: `${id}@test.coto2ba.invalid`,
    emailVerified: false,
    isAnonymous: true,
    displayName: 'ヒント検証',
    bestFreeMoves: {},
    booth: false,
  })
  createdUserIds.push(id)
  const token = crypto.randomUUID().replaceAll('-', '')
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId: id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return token
}

async function post(path: string, bearer: string, body?: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  })
}

describe.skipIf(SKIP_WITHOUT_VOCAB)('POST /api/games/:id/hints', () => {
  it('提案されたヒントをそのまま打てて、順位が上がる', async () => {
    const bearer = await signIn()
    const created = await post('/api/games', bearer, { mode: 'free', difficulty: 'normal' })
    expect(created.status).toBe(200)
    const game = (await created.json()) as { id: string; current_rank: number }

    const res = await post(`/api/games/${game.id}/hints`, bearer)
    expect(res.status).toBe(200)
    // クライアントと同じスキーマで検証する（比率が 8 段階でなければここで落ちる）。
    const parsed = hintResponseSchema.safeParse(await res.json())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.hint_count).toBe(1)

    const hint = parsed.data.hints[0]
    expect(hint).toBeTruthy()
    if (!hint) return
    expect(RATIOS).toContain(hint.ratio)

    // ヒントをそのまま打つ。422 にならず、rank が改善すること。
    const moved = await post(`/api/games/${game.id}/moves`, bearer, {
      input_word: hint.word,
      ratio: hint.ratio,
    })
    expect(moved.status).toBe(200)
    const move = (await moved.json()) as { rank: number; prev_rank: number }
    expect(move.rank).toBeLessThan(move.prev_rank)
  })

  it('2 回目は hint_candidate_cache 経由でも同じヒントを返す', async () => {
    const bearer = await signIn()
    const created = await post('/api/games', bearer, { mode: 'free', difficulty: 'normal' })
    const game = (await created.json()) as { id: string }

    const first = await post(`/api/games/${game.id}/hints`, bearer)
    const [board] = await db
      .select({ goal: games.goal, current: games.current })
      .from(games)
      .where(eq(games.id, game.id))
    expect(board).toBeDefined()
    if (!board) return
    const cached = await db
      .select()
      .from(hintCandidateCache)
      .where(
        and(
          eq(hintCandidateCache.goal, board.goal),
          eq(hintCandidateCache.current, board.current),
          eq(hintCandidateCache.hintVersion, 2),
        ),
      )
    expect(cached).toHaveLength(1)
    const second = await post(`/api/games/${game.id}/hints`, bearer)
    const a = (await first.json()) as { hints: unknown; hint_count: number }
    const b = (await second.json()) as { hints: unknown; hint_count: number }
    expect(b.hints).toEqual(a.hints)
    // 開いた回数はキャッシュに関係なく増える。
    expect(b.hint_count).toBe(a.hint_count + 1)
  })
})

describe.skipIf(SKIP_WITHOUT_DB)('game-specific exclusions on a shared cached pool', () => {
  it('keeps each game history out and ignores the old display cache', async () => {
    await signIn()
    const userId = createdUserIds.at(-1)!
    const goal = `test-goal-${crypto.randomUUID()}`
    const current = `test-current-${crypto.randomUUID()}`
    const hints = Array.from({ length: 10 }, (_, i) => ({
      word: `test-candidate-${i}`,
      ratio: 0.5,
    }))
    const [a, b] = await db
      .insert(games)
      .values([
        {
          userId,
          mode: 'free',
          difficulty: 'normal',
          goal,
          current,
          start: hints[0]!.word,
          currentRank: 500,
        },
        {
          userId,
          mode: 'free',
          difficulty: 'normal',
          goal,
          current,
          start: hints[3]!.word,
          currentRank: 500,
          forbiddenInputs: [hints[4]!.word],
        },
      ])
      .returning({ id: games.id })
    expect(a && b).toBeTruthy()
    if (!a || !b) return
    try {
      await db
        .insert(hintCache)
        .values({ goal, current, hints: [{ word: 'old-cache-only', ratio: 0.5 }] })
      await db.insert(hintCandidateCache).values({ goal, current, hintVersion: 2, hints })
      await db.insert(moves).values([
        {
          gameId: a.id,
          seq: 1,
          inputWord: hints[1]!.word,
          result: hints[2]!.word,
          ratio: 0.5,
          rank: 500,
        },
        {
          gameId: b.id,
          seq: 1,
          inputWord: hints[5]!.word,
          result: hints[6]!.word,
          ratio: 0.5,
          rank: 500,
        },
      ])
      const first = await openHints(db, userId, a.id)
      const second = await openHints(db, userId, b.id)
      for (const word of hints.slice(0, 3))
        expect(first.hints.map((h) => h.word)).not.toContain(word.word)
      for (const word of hints.slice(3, 7))
        expect(second.hints.map((h) => h.word)).not.toContain(word.word)
      expect(second.hints.map((h) => h.word)).toContain(hints[0]!.word)
      expect(first.hints.map((h) => h.word)).not.toContain('old-cache-only')
      const [stored] = await db
        .select({ hints: hintCandidateCache.hints })
        .from(hintCandidateCache)
        .where(
          and(
            eq(hintCandidateCache.goal, goal),
            eq(hintCandidateCache.current, current),
            eq(hintCandidateCache.hintVersion, 2),
          ),
        )
      expect(stored?.hints).toEqual(hints)
    } finally {
      await db
        .delete(hintCandidateCache)
        .where(and(eq(hintCandidateCache.goal, goal), eq(hintCandidateCache.current, current)))
      await db
        .delete(hintCache)
        .where(and(eq(hintCache.goal, goal), eq(hintCache.current, current)))
    }
  })
})
