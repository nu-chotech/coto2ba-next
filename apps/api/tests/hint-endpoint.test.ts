/**
 * ヒントのエンドポイントの統合テスト（SPEC §3.3 / §7.5）。
 *
 * ここで守りたいのは「シートで選んだヒントを**そのまま打てて、順位が上がる**」こと。
 * - 返す比率が 8 段階でなければサーバー自身が 422 を返す（丸めない契約）
 * - 提案どおりに混ぜたとき rank が改善する
 * - hint_cache（jsonb）を経由しても同じヒントが返る
 *
 * DB が無ければスキップする（CI で落ちないように）。
 */
import { hintResponseSchema, RATIOS } from '@coto2ba/contracts'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { session, user } from '../src/db/schema'

let hasDb = false
const createdUserIds: string[] = []

beforeAll(async () => {
  try {
    const r = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM vocab WHERE is_output`,
    )
    hasDb = Number(r.rows[0]?.n ?? 0) > 1000
  } catch {
    hasDb = false
  }
  if (!hasDb) console.warn('vocab が無いのでヒントの統合テストをスキップします')
})

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

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('POST /api/games/:id/hints', () => {
  it('提案されたヒントをそのまま打てて、順位が上がる', async () => {
    if (!hasDb) return
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

  it('2 回目は hint_cache 経由でも同じヒントを返す', async () => {
    if (!hasDb) return
    const bearer = await signIn()
    const created = await post('/api/games', bearer, { mode: 'free', difficulty: 'normal' })
    const game = (await created.json()) as { id: string }

    const first = await post(`/api/games/${game.id}/hints`, bearer)
    const second = await post(`/api/games/${game.id}/hints`, bearer)
    const a = (await first.json()) as { hints: unknown; hint_count: number }
    const b = (await second.json()) as { hints: unknown; hint_count: number }
    expect(b.hints).toEqual(a.hints)
    // 開いた回数はキャッシュに関係なく増える。
    expect(b.hint_count).toBe(a.hint_count + 1)
  })
})
