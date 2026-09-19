/**
 * ヒントの順位改善率のベンチマーク（SPEC §3.3 の検証）。
 *
 * 「ヒントに従うと順位が上がる」を体感ではなく数値で固定する。
 * `goal_pool` から決定論的に 100 局面を作り、**シートの一番上に出るヒント**を
 * 提案どおりの比率で適用して rank が改善するかを数える。
 * 並びは盤面から決まる決定的シャッフルなので、一番上＝最良の手とは限らない。
 * これは「人は反射的に一番上を押す」という前提での実測値になる。
 *
 * あわせて**着地 rank の分布**を記録する（characterization test）。
 * ヒントの強さに上限は設けていない（ランキングの並び順で課金する設計）が、
 * 上限テストが 1 つも無いとアルゴリズムを変えたときに強さの激変に気づけないため、
 * 現在の挙動を幅を持たせた範囲で固定する。**下限で落として弱めるための閾値ではない。**
 *
 * 除外語は本番の `openHints` と同じ（ゴール・現在の語・forbidden_inputs）にする。
 * DB が無い環境では skipped として報告する（vector.test.ts と同じ機構）。
 */
import {
  CLEAR_RANK,
  GOAL_NEIGHBOR_BAN,
  START_MAX_FREQ_RANK,
  START_RANK_RANGE,
  sharesKanji,
} from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import { selectHints } from '../src/services/hint-pool'
import { goalNeighborhood, mixAndRank, rankOf, verifiedHintPool } from '../src/services/vector'
import { SKIP_WITHOUT_VOCAB } from './db-available'

/** 改善率の下限。ここを下げてはいけない（下げるならアルゴリズムを直すこと）。 */
const REQUIRED_IMPROVEMENT_RATE = 0.9
const SITUATIONS = 100
/**
 * 一番上のヒントがそのままクリア（rank <= CLEAR_RANK）になる割合の許容幅。
 * 実測 0.51。並べ替えをやめて「ゴールに近い順」に戻すと 1.0 に張り付き、
 * ヒントが効かなくなると 0 に落ちる。どちらも掴めるだけの幅にしてある。
 */
const CLEAR_SHARE_RANGE = [0.2, 0.9] as const
/** 一番上のヒントで rank 100 以内まで届く割合の下限。実測 0.99。 */
const MIN_WITHIN_100_SHARE = 0.8
/** 100 局面 × 数クエリ。ローカルの pgvector で 15 秒前後。 */
const BENCHMARK_TIMEOUT_MS = 600_000

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

describe.skipIf(SKIP_WITHOUT_VOCAB)('ヒントの順位改善率', () => {
  it(
    'シートの一番上のヒントに従うと 9 割以上の局面で順位が上がる',
    async () => {
      const started = Date.now()
      const cases = await sampleSituations(SITUATIONS)
      expect(cases.length).toBeGreaterThan(0)

      let improved = 0
      let withoutHint = 0
      let perfect = 0
      let cleared = 0
      let within100 = 0
      const deltas: number[] = []
      // 逐次で回す（同時実行すると計測時間が意味を持たなくなる）。
      for (const { goal, current } of cases) {
        const forbidden = await goalNeighborhood(db, goal, GOAL_NEIGHBOR_BAN)
        // シートに出るのと同じ件数を取り、**一番上**を打つ（人はそうする）。
        // openHints と同じ順序で呼ぶ（プール構築にゴール由来の禁止語、表示時に履歴）。
        const [hint] = selectHints(
          await verifiedHintPool(db, goal, current, forbidden),
          goal,
          current,
          forbidden,
        )
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
        if (res.rank === 0) perfect++
        if (res.rank <= CLEAR_RANK) cleared++
        if (res.rank <= 100) within100++
        deltas.push(before - res.rank)
      }

      const sorted = [...deltas].sort((a, b) => a - b)
      const median = sorted.length === 0 ? 0 : (sorted[(sorted.length - 1) >> 1] as number)
      const rate = improved / cases.length
      const clearShare = cleared / cases.length
      const within100Share = within100 / cases.length
      console.info(
        `[hint-benchmark] 局面 ${cases.length} / 改善 ${improved} (${(rate * 100).toFixed(1)}%)` +
          ` / ヒント無し ${withoutHint} / rank 改善幅の中央値 ${median}` +
          ` / 着地 rank: 完全錬成 ${perfect} / クリア圏 ${cleared} / 100 位以内 ${within100}` +
          ` / ${Date.now() - started}ms`,
      )

      expect(rate).toBeGreaterThanOrEqual(REQUIRED_IMPROVEMENT_RATE)
      // 強さの characterization。幅から外れたらアルゴリズムの挙動が変わったということ。
      expect(clearShare).toBeGreaterThanOrEqual(CLEAR_SHARE_RANGE[0])
      expect(clearShare).toBeLessThanOrEqual(CLEAR_SHARE_RANGE[1])
      expect(within100Share).toBeGreaterThanOrEqual(MIN_WITHIN_100_SHARE)
    },
    BENCHMARK_TIMEOUT_MS,
  )
})
