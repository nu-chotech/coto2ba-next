/**
 * ヒントの順位改善率のベンチマーク（SPEC §3.3 の検証）。
 *
 * 「ヒントに従うと順位が上がる」を体感ではなく数値で固定する。
 * `goal_pool` から決定論的に 100 局面を作り、ヒント 1 位を**提案どおりの比率**で
 * 適用して rank が改善するかを数える。
 *
 * 除外語は本番の `openHints` と同じ（ゴール・現在の語・forbidden_inputs）にする。
 * DB が無い環境ではスキップする（vector.test.ts と同じ機構）。
 */
import {
  GOAL_NEIGHBOR_BAN,
  START_MAX_FREQ_RANK,
  START_RANK_RANGE,
  sharesKanji,
} from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import { goalNeighborhood, hintCandidates, mixAndRank, rankOf } from '../src/services/vector'

/** 改善率の下限。ここを下げてはいけない（下げるならアルゴリズムを直すこと）。 */
const REQUIRED_IMPROVEMENT_RATE = 0.9
const SITUATIONS = 100
/** 100 局面 × 数クエリ。ローカルの pgvector で 15 秒前後。 */
const BENCHMARK_TIMEOUT_MS = 600_000

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
  if (!hasVocab) console.warn('vocab が無いのでヒントのベンチマークをスキップします')
})

afterAll(async () => {
  await pool.end().catch(() => {})
})

interface Situation {
  goal: string
  current: string
}

/**
 * 100 局面を決定論的に作る。**乱数を使わない。**
 * ゴールは `goal_pool` を語順で先頭から、スタートは本番と同じ条件
 * （ランク帯・具体名詞・頻度上限・ゴールと漢字を共有しない）で `md5` 順の先頭。
 * `ORDER BY word` にすると片仮名語ばかりが選ばれて偏るので md5 で散らす。
 */
async function sampleSituations(n: number): Promise<Situation[]> {
  const goals = await db.execute<{ word: string }>(sql`
    SELECT word FROM goal_pool WHERE enabled ORDER BY word LIMIT ${n}
  `)
  const out: Situation[] = []
  for (const g of goals.rows) {
    const goal = g.word
    const rows = await db.execute<{ word: string }>(sql`
      WITH ranked AS (
        SELECT v.word, v.is_common_noun, v.is_concrete, v.freq_rank, v.pos,
               row_number() OVER (
                 ORDER BY v.w2v <=> (SELECT w2v FROM vocab WHERE word = ${goal})
               ) AS rk
        FROM vocab v
        WHERE v.is_output AND v.word <> ${goal}
      )
      SELECT word FROM ranked
      WHERE rk BETWEEN ${START_RANK_RANGE[0]} AND ${START_RANK_RANGE[1]}
        AND is_common_noun AND is_concrete AND pos = '名詞-普通名詞'
        AND freq_rank <= ${START_MAX_FREQ_RANK}
      ORDER BY md5(word || ${goal})
      LIMIT 32
    `)
    const words = rows.rows.map((r) => r.word)
    const current = words.find((w) => !sharesKanji(w, goal)) ?? words[0]
    if (current !== undefined) out.push({ goal, current })
  }
  return out
}

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('ヒントの順位改善率', () => {
  it(
    'ヒント 1 位に従うと 9 割以上の局面で順位が上がる',
    async () => {
      if (!hasVocab) return
      const started = Date.now()
      const cases = await sampleSituations(SITUATIONS)
      expect(cases.length).toBeGreaterThan(0)

      let improved = 0
      let withoutHint = 0
      const deltas: number[] = []
      // 逐次で回す（同時実行すると計測時間が意味を持たなくなる）。
      for (const { goal, current } of cases) {
        const forbidden = await goalNeighborhood(db, goal, GOAL_NEIGHBOR_BAN)
        const [hint] = await hintCandidates(db, goal, current, forbidden, 1)
        if (!hint) {
          withoutHint++
          continue
        }
        const before = await rankOf(db, goal, current)
        const res = await mixAndRank(db, goal, current, hint.word, hint.ratio)
        if (before === null || res === null) {
          withoutHint++
          continue
        }
        if (res.rank < before) improved++
        deltas.push(before - res.rank)
      }

      const sorted = [...deltas].sort((a, b) => a - b)
      const median = sorted.length === 0 ? 0 : (sorted[(sorted.length - 1) >> 1] as number)
      const rate = improved / cases.length
      console.info(
        `[hint-benchmark] 局面 ${cases.length} / 改善 ${improved} (${(rate * 100).toFixed(1)}%)` +
          ` / ヒント無し ${withoutHint} / rank 改善幅の中央値 ${median}` +
          ` / ${Date.now() - started}ms`,
      )

      expect(rate).toBeGreaterThanOrEqual(REQUIRED_IMPROVEMENT_RATE)
    },
    BENCHMARK_TIMEOUT_MS,
  )
})
