/**
 * ベクトル演算の統合テスト。DATABASE_URL が指す DB に vocab が入っている必要がある。
 * 入っていなければスキップする（CI で DB が無くても落ちないように）。
 */
import { HINT_CANDIDATE_COUNT, HINT_COUNT, HINT_RATIO } from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import { hintWords, lookupWord, mixAndRank, rankOf, sampleStartWord } from '../src/services/vector'

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

  it(`ヒントは ${HINT_COUNT} 語で、除外語を含まない`, async () => {
    if (!hasVocab) return
    const exclude = ['銀河', '宇宙']
    const hints = await hintWords(
      db,
      '銀河',
      '宇宙',
      exclude,
      HINT_RATIO,
      HINT_CANDIDATE_COUNT,
      HINT_COUNT,
    )
    expect(hints).toHaveLength(HINT_COUNT)
    for (const h of hints) expect(exclude).not.toContain(h)
    expect(new Set(hints).size).toBe(hints.length)
  })

  it('ヒントはゴールに近づく方向にある（current より平均ランクが小さい）', async () => {
    if (!hasVocab) return
    const goal = '銀河'
    const current = '味噌汁'
    const currentRank = await rankOf(db, goal, current)
    const hints = await hintWords(
      db,
      goal,
      current,
      [goal, current],
      HINT_RATIO,
      HINT_CANDIDATE_COUNT,
      HINT_COUNT,
    )
    const ranks = await Promise.all(hints.map((h) => rankOf(db, goal, h)))
    const avg = ranks.reduce<number>((a, b) => a + (b ?? 0), 0) / ranks.length
    expect(avg).toBeLessThan(currentRank as number)
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
