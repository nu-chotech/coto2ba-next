/**
 * ベクトル演算の統合テスト。DATABASE_URL が指す DB に vocab が入っている必要がある。
 * 入っていなければスキップする（CI で DB が無くても落ちないように）。
 */
import { CLEAR_RANK, HINT_COUNT, RATIOS } from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import {
  hintCandidates,
  lookupWord,
  mixAndRank,
  rankOf,
  sampleStartWord,
} from '../src/services/vector'

let hasVocab = false

beforeAll(async () => {
  try {
    const r = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM vocab WHERE is_output`,
    )
    hasVocab = Number(r.rows[0]?.n ?? 0) > 1000
  } catch {
    hasVocab = false
  }
  if (!hasVocab) {
    console.warn('vocab が無いのでベクトルの統合テストをスキップします')
  }
})

afterAll(async () => {
  await pool.end().catch(() => {})
})

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('ベクトル演算', () => {
  it('ゴールの最近傍のランクは 1（gensim との契約）', async () => {
    if (!hasVocab) return
    const goal = '銀河'
    const nn = await db.execute<{ word: string }>(sql`
      WITH g AS (SELECT w2v FROM vocab WHERE word = ${goal})
      SELECT v.word FROM vocab v, g
      WHERE v.is_output AND v.word <> ${goal}
      ORDER BY v.w2v <=> g.w2v
      LIMIT 1
    `)
    const nearest = nn.rows[0]?.word
    expect(nearest).toBeTruthy()
    expect(await rankOf(db, goal, nearest as string)).toBe(1)
  })

  it('ゴール自身のランクは 0（完全錬成）', async () => {
    if (!hasVocab) return
    expect(await rankOf(db, '銀河', '銀河')).toBe(0)
  })

  it('ランクは近いほど小さい', async () => {
    if (!hasVocab) return
    const goal = '銀河'
    const rows = await db.execute<{ word: string; rk: number }>(sql`
      WITH g AS (SELECT w2v FROM vocab WHERE word = ${goal})
      SELECT v.word, row_number() OVER (ORDER BY v.w2v <=> g.w2v) AS rk
      FROM vocab v, g WHERE v.is_output AND v.word <> ${goal}
      ORDER BY rk LIMIT 500
    `)
    const near = rows.rows[4]
    const far = rows.rows[499]
    expect(near && far).toBeTruthy()
    const rNear = await rankOf(db, goal, near?.word as string)
    const rFar = await rankOf(db, goal, far?.word as string)
    expect(rNear).toBeLessThan(rFar as number)
  })

  it('混合の結果は current / input を含まない', async () => {
    if (!hasVocab) return
    const res = await mixAndRank(db, '銀河', '宇宙', '船', 0.5)
    expect(res).toBeTruthy()
    expect(res?.result).not.toBe('宇宙')
    expect(res?.result).not.toBe('船')
    expect(res?.rank).toBeGreaterThanOrEqual(0)
  })

  it('混合は決定論的（同じ入力なら同じ結果）', async () => {
    if (!hasVocab) return
    const a = await mixAndRank(db, '銀河', '宇宙', '船', 0.3)
    const b = await mixAndRank(db, '銀河', '宇宙', '船', 0.3)
    expect(a).toEqual(b)
  })

  it('ratio が大きいほど input 側に寄る', async () => {
    if (!hasVocab) return
    const low = await mixAndRank(db, '銀河', '宇宙', '味噌汁', 0.1)
    const high = await mixAndRank(db, '銀河', '宇宙', '味噌汁', 0.8)
    expect(low?.result).not.toBe(high?.result)
  })

  it('mixAndRank の rank は rankOf と一致する', async () => {
    if (!hasVocab) return
    const res = await mixAndRank(db, '銀河', '宇宙', '船', 0.5)
    expect(res).toBeTruthy()
    expect(await rankOf(db, '銀河', res?.result as string)).toBe(res?.rank)
  })

  it('語彙の引き当て', async () => {
    if (!hasVocab) return
    expect((await lookupWord(db, '銀河'))?.isInput).toBe(true)
    expect(await lookupWord(db, 'ぎゃぴぴぴぴ')).toBeNull()
  })

  it('スタート語は規定のランク帯から選ばれる', async () => {
    if (!hasVocab) return
    const words = await sampleStartWord(db, '銀河', 20000, 3000, 30000, 5)
    expect(words.length).toBeGreaterThan(0)
    for (const w of words) {
      const r = await rankOf(db, '銀河', w)
      expect(r).toBeGreaterThanOrEqual(3000)
      expect(r).toBeLessThanOrEqual(30001)
    }
  })
})

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('hintCandidates', () => {
  const GOAL = '温泉'
  const CURRENT = '味噌汁'

  it('提案どおりに混ぜるとゴールに近づく', async () => {
    if (!hasVocab) return
    const hints = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)

    expect(hints.length).toBeGreaterThan(0)
    const before = await rankOf(db, GOAL, CURRENT)
    for (const hint of hints) {
      const res = await mixAndRank(db, GOAL, CURRENT, hint.word, hint.ratio)
      expect(res).toBeTruthy()
      // ヒントは「順位が上がる手」でなければ意味がない。これが契約。
      expect(res?.rank).toBeLessThan(before as number)
    }
  })

  it('クリアそのものは渡さない', async () => {
    if (!hasVocab) return
    const hints = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)
    for (const hint of hints) {
      const res = await mixAndRank(db, GOAL, CURRENT, hint.word, hint.ratio)
      expect(res?.rank).toBeGreaterThan(CLEAR_RANK)
    }
  })

  // ゴールのすぐ近くに立っていると「効くが強すぎない手」が存在しないことがある。
  // そのときは 0 件を返す（保険の経路でクリアを渡さないことの確認）。
  it('ゴールの目前でもクリアを渡さない', async () => {
    if (!hasVocab) return
    const near = await db.execute<{ word: string }>(sql`
      SELECT v.word FROM vocab v
      WHERE v.is_output AND v.word <> ${GOAL}
      ORDER BY v.w2v <=> (SELECT w2v FROM vocab WHERE word = ${GOAL})
      LIMIT 1 OFFSET ${CLEAR_RANK + 4}
    `)
    const current = near.rows[0]?.word
    expect(current).toBeTruthy()
    const hints = await hintCandidates(db, GOAL, current as string, [], HINT_COUNT)
    for (const hint of hints) {
      const res = await mixAndRank(db, GOAL, current as string, hint.word, hint.ratio)
      expect(res?.rank).toBeGreaterThan(CLEAR_RANK)
    }
  })

  it('比率は 8 段階のいずれか', async () => {
    if (!hasVocab) return
    const hints = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)
    for (const hint of hints) expect(RATIOS).toContain(hint.ratio)
  })

  it('除外語を返さない', async () => {
    if (!hasVocab) return
    const first = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)
    const banned = [GOAL, CURRENT, ...first.map((h) => h.word)]
    const hints = await hintCandidates(db, GOAL, CURRENT, banned, HINT_COUNT)
    for (const hint of hints) expect(banned).not.toContain(hint.word)
  })

  it('同じ入力なら同じ結果（キャッシュが決定論であるため）', async () => {
    if (!hasVocab) return
    const a = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)
    const b = await hintCandidates(db, GOAL, CURRENT, [], HINT_COUNT)
    expect(a).toEqual(b)
  })

  it('limit を超えない', async () => {
    if (!hasVocab) return
    const hints = await hintCandidates(db, GOAL, CURRENT, [], 2)
    expect(hints.length).toBeLessThanOrEqual(2)
  })
})
