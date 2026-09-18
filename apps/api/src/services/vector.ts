/**
 * ベクトル演算（SQL ラッパ）。
 *
 * 設計上の要点（docs/ARCHITECTURE.md §3）:
 * - 1 手の処理は **1 本の SQL** に畳む。
 *   （以前ここに「Vercel(sin1) ↔ Neon(sin1) でも 1 往復 ≈ 70ms」と書いてあったが**誤り**。
 *   実測は 2〜5ms。70〜90ms は日本→シンガポールの往復で、関数を同居させて避けたもの。
 *   2026-09-18 訂正）。往復を畳む判断自体は、往復数が増えるほど tail が伸びるので正しい。
 * - 最近傍は HNSW インデックス、**ランクは厳密な全走査**。HNSW は近似なので
 *   同じ盤面で rank が揺れてスコアが再現しなくなる。
 * - **混合ベクトルは CTE の結合ではなくスカラー副問い合わせで書く。**
 *   CTE を FROM で結合すると Postgres は値を定数と見なせず HNSW を使えない
 *   （実測: 全ソート 220ms → InitPlan 経由の HNSW 0.7ms）。
 * - 除外リストは必ず `sql.param(list)` + 明示的な `::text[]`。
 *   `sql`... <> ALL(${jsArray})`` はパラメータ列にコンパイルされて 42809 になる。
 * - halfvec のスカラー倍は演算子が無いので `array_fill(s, ARRAY[dim])::vector` との
 *   要素ごと積で表現する。
 */
import {
  HINT_EXTRAPOLATION_NEIGHBORS,
  HINT_VERIFY_LIMIT,
  type Hint,
  isMorphologicalVariant,
  NEAREST_CANDIDATES,
  RATIOS,
  VECTOR_DIM,
} from '@coto2ba/contracts'
import { type SQL, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { deterministicShuffle } from '../lib/random'
import { bestRatioForCandidate, extrapolationTarget } from './hint-target'
import type { MixCandidateScore } from './mix-scoring'

const DIM = sql.raw(String(VECTOR_DIM))

/** 語のベクトルを引くスカラー副問い合わせ。InitPlan になるので定数として扱われる。 */
function vectorOf(word: string): SQL {
  return sql`(SELECT w2v FROM vocab WHERE word = ${word})`
}

/**
 * a * v1 + b * v2 を halfvec で表す式。
 * halfvec にスカラー倍の演算子が無いので、定数ベクトルとの要素ごと積で代用する。
 */
function blend(v1: SQL, a: number, v2: SQL, b: number): SQL {
  return sql`(
    (${v1}::vector * array_fill(${a}::real, ARRAY[${DIM}])::vector)
    + (${v2}::vector * array_fill(${b}::real, ARRAY[${DIM}])::vector)
  )::halfvec(${DIM})`
}

export interface MixResult {
  result: string
  rank: number
}

/**
 * 1 手ぶんの混合＋最近傍＋ランクを 1 クエリで行う。
 * goal / current / input はすべて vocab に存在していること（呼び出し側で検証済み）。
 */
export async function mixAndRank(
  db: Db,
  goal: string,
  current: string,
  input: string,
  ratio: number,
): Promise<MixResult | null> {
  const mixed = blend(vectorOf(current), 1 - ratio, vectorOf(input), ratio)
  const rows = await db.execute<{ result: string; rank: number }>(sql`
    WITH
      cand AS (
        SELECT v.word, v.w2v
        FROM vocab v
        WHERE v.is_output
        ORDER BY v.w2v <=> ${mixed}
        LIMIT ${NEAREST_CANDIDATES}
      ),
      picked AS (
        SELECT word, w2v FROM cand
        WHERE word <> ${current} AND word <> ${input}
        LIMIT 1
      )
    SELECT
      p.word AS result,
      CASE
        WHEN p.word = ${goal} THEN 0
        ELSE 1 + (
          SELECT count(*)::int
          FROM vocab v2
          WHERE v2.is_output
            AND v2.word <> ${goal}
            AND (v2.w2v <=> ${vectorOf(goal)}) < (p.w2v <=> ${vectorOf(goal)})
        )
      END AS rank
    FROM picked p
  `)
  const row = rows.rows[0]
  return row ? { result: row.result, rank: Number(row.rank) } : null
}

/** 比較実験専用。production の mixAndRank と同じ LIMIT 後に除外する。 */
export function mixCandidateMetricsQuery(
  goal: string,
  current: string,
  input: string,
  ratio: number,
): SQL {
  const mixed = blend(vectorOf(current), 1 - ratio, vectorOf(input), ratio)
  return sql`
    WITH cand AS (
      SELECT v.word, v.w2v
      FROM vocab v
      WHERE v.is_output
      ORDER BY v.w2v <=> ${mixed}
      LIMIT ${NEAREST_CANDIDATES}
    )
    SELECT c.word,
      1 - (c.w2v <=> ${mixed}) AS blend_similarity,
      1 - (c.w2v <=> ${vectorOf(goal)}) AS goal_similarity
    FROM cand c
    WHERE c.word <> ${current} AND c.word <> ${input}
  `
}

export async function mixCandidateMetrics(
  db: Db,
  goal: string,
  current: string,
  input: string,
  ratio: number,
): Promise<MixCandidateScore[]> {
  const rows = await db.execute<{
    word: string
    blend_similarity: number | null
    goal_similarity: number | null
  }>(mixCandidateMetricsQuery(goal, current, input, ratio))
  return rows.rows.map((row) => {
    if (row.blend_similarity === null || row.goal_similarity === null) {
      throw new Error('comparison words must exist in vocab')
    }
    return {
      word: row.word,
      blendSimilarity: Number(row.blend_similarity),
      goalSimilarity: Number(row.goal_similarity),
    }
  })
}

/**
 * ゴールから見た語のランク。
 * rank = 1 + |{ w ∈ 出力語彙 : w ≠ goal, cos(w, goal) > cos(word, goal) }|
 * word === goal のときは 0（完全錬成）。
 */
export async function rankOf(db: Db, goal: string, word: string): Promise<number | null> {
  if (word === goal) return 0
  const rows = await db.execute<{ rank: number }>(sql`
    SELECT 1 + count(*)::int AS rank
    FROM vocab v
    WHERE v.is_output AND v.word <> ${goal}
      AND (v.w2v <=> ${vectorOf(goal)})
        < ((SELECT w2v FROM vocab WHERE word = ${word}) <=> ${vectorOf(goal)})
  `)
  const row = rows.rows[0]
  return row ? Number(row.rank) : null
}

/**
 * JS のベクトルを halfvec リテラルにする。
 * `<=>` は余弦距離でスケール不変なので、halfvec(float16) の表現域に収まるよう
 * **ここで**単位長に直してから渡す（`extrapolationTarget` 側は性質を保つため正規化しない）。
 */
function halfvecParam(v: Float32Array): SQL {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number
    sum += x * x
  }
  const n = Math.sqrt(sum)
  if (!Number.isFinite(n) || n === 0) throw new TypeError('vector must have a non-zero norm')
  const parts = new Array<string>(v.length)
  for (let i = 0; i < v.length; i++) parts[i] = String((v[i] as number) / n)
  return sql`${`[${parts.join(',')}]`}::halfvec(${DIM})`
}

/** 語 → ベクトル。DB に無い語は Map に入らない。 */
export async function wordVectors(
  db: Db,
  words: readonly string[],
): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>()
  if (words.length === 0) return out
  const rows = await db.execute<{ word: string; v: string }>(sql`
    SELECT word, w2v::text AS v FROM vocab WHERE word = ANY(${sql.param([...words])}::text[])
  `)
  for (const row of rows.rows) {
    out.set(row.word, Float32Array.from(JSON.parse(row.v) as number[]))
  }
  return out
}

/**
 * 外挿点ごとの近傍の**和集合**。比率ごとに往復すると 8 往復になるので 1 本の SQL に畳む。
 * 順序は使わない（最終的な並びは検証後のゴール類似度で決まる）ので DISTINCT で十分。
 */
async function extrapolationNeighbors(
  db: Db,
  targets: readonly Float32Array[],
  perTarget: number,
): Promise<string[]> {
  if (targets.length === 0) return []
  const parts = targets.map(
    (t) => sql`(
      SELECT v.word FROM vocab v
      WHERE v.is_output
      ORDER BY v.w2v <=> ${halfvecParam(t)}
      LIMIT ${perTarget}
    )`,
  )
  const rows = await db.execute<{ word: string }>(sql`
    SELECT DISTINCT t.word FROM (${sql.join(parts, sql` UNION ALL `)}) t
  `)
  return rows.rows.map((r) => r.word)
}

export interface MixVerification {
  input: string
  result: string
  goalSimilarity: number
  /** current 自身のゴール類似度。これを超えない候補は「効かないヒント」。 */
  currentGoalSimilarity: number
}

/**
 * 候補を**実際に混ぜて**結果語とそのゴール類似度を取る。
 * 1 件ずつだと候補数ぶん往復するので、`mixCandidateMetricsQuery` をそのまま
 * UNION ALL で束ねて 1 往復にする（混合と類似度の計算自体は再実装しない）。
 * `blend_similarity` の降順 1 件 = `mixAndRank` が選ぶ結果語と同じ。
 */
export async function verifyMixes(
  db: Db,
  goal: string,
  current: string,
  candidates: readonly Hint[],
): Promise<MixVerification[]> {
  if (candidates.length === 0) return []
  const parts = candidates.map(
    (c) => sql`(
      SELECT ${c.word}::text AS input, m.word AS result, m.goal_similarity
      FROM (${mixCandidateMetricsQuery(goal, current, c.word, c.ratio)}) m
      ORDER BY m.blend_similarity DESC
      LIMIT 1
    )`,
  )
  const rows = await db.execute<{
    input: string
    result: string
    goal_similarity: number | null
    current_goal_similarity: number | null
  }>(sql`
    SELECT u.input, u.result, u.goal_similarity,
      (1 - (${vectorOf(current)} <=> ${vectorOf(goal)})) AS current_goal_similarity
    FROM (${sql.join(parts, sql` UNION ALL `)}) u
  `)
  return rows.rows.flatMap((row) => {
    if (row.goal_similarity === null || row.current_goal_similarity === null) return []
    return [
      {
        input: row.input,
        result: row.result,
        goalSimilarity: Number(row.goal_similarity),
        currentGoalSimilarity: Number(row.current_goal_similarity),
      },
    ]
  })
}

/**
 * ヒント候補（SPEC §3.3）。
 *
 * 「混ぜると**実際にゴールへ近づく**語」と、その**混ぜ方**を返す。
 *
 * 1. 比率ごとに外挿点 v_W*(r) = (v_goal - (1 - r) * v_current) / r を作り、近傍を集める
 * 2. 各候補に対して最良の比率を算術で選ぶ（DB を使わない）
 * 3. 上位だけ実際に混ぜ、結果語のゴール類似度が current を超えるものだけ残す
 *
 * 足りなくても**効かない語で埋めない**（埋めると元の「ヒントが効かない」に戻る）。
 * 出力は (ゴール類似度降順, 語の昇順) で決定論。`hint_cache` がこれを前提にしている。
 */
export async function hintCandidates(
  db: Db,
  goal: string,
  current: string,
  exclude: readonly string[],
  limit: number,
  shuffle = true,
): Promise<Hint[]> {
  if (limit <= 0) return []
  const anchors = await wordVectors(db, [current, goal])
  const currentVec = anchors.get(current)
  const goalVec = anchors.get(goal)
  if (!currentVec || !goalVec) return []

  const banned = new Set<string>([...exclude, current, goal])
  const targets = RATIOS.map((r) => extrapolationTarget(currentVec, goalVec, r))
  const neighbors = (
    await extrapolationNeighbors(db, targets, HINT_EXTRAPOLATION_NEIGHBORS)
  ).filter(
    (w) =>
      !banned.has(w) && !isMorphologicalVariant(w, current) && !isMorphologicalVariant(w, goal),
  )

  const vectors = await wordVectors(db, neighbors)
  const scored: { word: string; ratio: number; cosine: number }[] = []
  for (const word of neighbors) {
    const v = vectors.get(word)
    if (!v) continue
    const best = bestRatioForCandidate(currentVec, v, goalVec, RATIOS)
    scored.push({ word, ratio: best.ratio, cosine: best.cosine })
  }
  // 検証に回す前の並び。算術上ゴールに近づくものから見る。同値は語の昇順（決定論）。
  const byArithmetic: Hint[] = scored
    .sort((a, b) => b.cosine - a.cosine || (a.word < b.word ? -1 : 1))
    .slice(0, HINT_VERIFY_LIMIT)
    .map(({ word, ratio }) => ({ word, ratio }))

  const hints = await keepUsefulHints(db, goal, current, byArithmetic, limit)
  if (hints.length > 0) return shuffle ? shuffleForDisplay(hints, goal, current) : hints

  // 最後の手段。1 件も検証を通らなかったときだけ、ゴールの近傍を候補にしてもう一度試す。
  // **ここでも同じ検証を通す。** 素通しすると「混ぜても順位が下がる語」を返しうる。
  const rescue = await goalNeighborCandidates(db, goal, current, currentVec, goalVec, banned)
  const fallback = await keepUsefulHints(db, goal, current, rescue, 1)
  return shuffle ? shuffleForDisplay(fallback, goal, current) : fallback
}

/** Ordered, verified, history-independent cache pool. Display selection happens after reading it. */
export async function verifiedHintPool(db: Db, goal: string, current: string): Promise<Hint[]> {
  // Eight extrapolation targets each fetch HINT_EXTRAPOLATION_NEIGHBORS words.
  // At most HINT_VERIFY_LIMIT (16) candidates enter the batched real-mix check;
  // zero can pass it. The rescue check is also bounded by 16 and runs only when
  // the first check yields nothing. Display selection takes at most six later.
  return hintCandidates(db, goal, current, [], HINT_VERIFY_LIMIT, false)
}

/**
 * 表示順を崩す。**選ぶところまではゴールに近い順**で、崩すのは最後の並びだけ。
 *
 * ゴールに近い順のまま出すと 1 位が常に勝ち確定の手になり、人は反射的に一番上を押す。
 * かといって毎回変えると、`hint_cache`（`(goal, current)` でキャッシュ）の
 * 「同じ盤面なら同じヒント」が壊れ、開き直すたびに探し直しになり、人によって並びも変わる。
 * **盤面を種にした決定的な並べ替え**にすることで両方を満たす。
 */
function shuffleForDisplay(hints: readonly Hint[], goal: string, current: string): Hint[] {
  return deterministicShuffle(hints, `${goal}\u0000${current}`)
}

/**
 * 候補を実際に混ぜて検証し、**ゴールに近づく手だけ**を残す。
 * 並びは (結果のゴール類似度降順, 語の昇順) で決定論。
 */
async function keepUsefulHints(
  db: Db,
  goal: string,
  current: string,
  candidates: readonly Hint[],
  limit: number,
): Promise<Hint[]> {
  if (candidates.length === 0) return []
  const ratioOf = new Map(candidates.map((h) => [h.word, h.ratio]))
  const verified = await verifyMixes(db, goal, current, candidates)
  const improving = verified
    // 効く手であることだけを見る。強さの上限は設けない。
    // ヒントの使用はランキングの最優先キー（SPEC §5.8）で課金されるので、
    // ヒントそのものを弱める必要はない。
    .filter((v) => v.goalSimilarity > v.currentGoalSimilarity)
    .sort((a, b) => b.goalSimilarity - a.goalSimilarity || (a.input < b.input ? -1 : 1))

  const hints: Hint[] = []
  for (const v of improving) {
    if (hints.length >= limit) break
    if (hints.some((h) => isMorphologicalVariant(v.input, h.word))) continue
    const ratio = ratioOf.get(v.input)
    if (ratio === undefined) continue
    hints.push({ word: v.input, ratio })
  }
  return hints
}

/** 外挿の候補が全滅したときの second pool。禁止語・表記揺れを除いたゴール近傍。 */
async function goalNeighborCandidates(
  db: Db,
  goal: string,
  current: string,
  currentVec: Float32Array,
  goalVec: Float32Array,
  banned: ReadonlySet<string>,
): Promise<Hint[]> {
  const rows = await db.execute<{ word: string }>(sql`
    SELECT v.word FROM vocab v
    WHERE v.is_output AND v.word <> ${goal}
    ORDER BY v.w2v <=> ${vectorOf(goal)}
    LIMIT ${HINT_EXTRAPOLATION_NEIGHBORS}
  `)
  const words = rows.rows
    .map((r) => r.word)
    .filter(
      (w) =>
        !banned.has(w) && !isMorphologicalVariant(w, current) && !isMorphologicalVariant(w, goal),
    )
  const vectors = await wordVectors(db, words)
  const out: Hint[] = []
  for (const word of words) {
    const v = vectors.get(word)
    if (!v) continue
    out.push({ word, ratio: bestRatioForCandidate(currentVec, v, goalVec, RATIOS).ratio })
  }
  return out.slice(0, HINT_VERIFY_LIMIT)
}

export interface VocabInfo {
  word: string
  isInput: boolean
  isOutput: boolean
  freqRank: number
}

/** 語が入力語彙にあるか。正規化済みの語を渡すこと。 */
export async function lookupWord(db: Db, word: string): Promise<VocabInfo | null> {
  const rows = await db.execute<{
    word: string
    is_input: boolean
    is_output: boolean
    freq_rank: number
  }>(sql`SELECT word, is_input, is_output, freq_rank FROM vocab WHERE word = ${word}`)
  const r = rows.rows[0]
  return r
    ? { word: r.word, isInput: r.is_input, isOutput: r.is_output, freqRank: Number(r.freq_rank) }
    : null
}

/** 所持語の中でその語に近い上位 n 件（実コサイン類似度）。図鑑の詳細シート用。 */
export async function nearestAmong(
  db: Db,
  word: string,
  among: string[],
  limit: number,
): Promise<{ word: string; similarity: number }[]> {
  if (among.length === 0) return []
  const rows = await db.execute<{ word: string; similarity: number }>(sql`
    SELECT v.word, (1 - (v.w2v <=> ${vectorOf(word)}))::real AS similarity
    FROM vocab v
    WHERE v.word = ANY(${sql.param(among)}::text[]) AND v.word <> ${word}
    ORDER BY v.w2v <=> ${vectorOf(word)}
    LIMIT ${limit}
  `)
  return rows.rows.map((r) => ({ word: r.word, similarity: Number(r.similarity) }))
}

/**
 * スタート語の抽選（SPEC §6.3）。
 * 出力語彙・**単独トークンの具体名詞**・freq_rank <= maxFreqRank で、
 * （複合語を許すと「共同通信」「ベストアルバム」、サ変名詞を許すと「対応」「浮遊」のような
 *  語が出てゲームの入り口として弱い。is_concrete は 02_prune が判定する）
 * goal から見たランクが [minRank, maxRank] に入る語からランダムに選ぶ。
 * 漢字の共有チェックは呼び出し側（JS）で行う。
 */
export async function sampleStartWord(
  db: Db,
  goal: string,
  maxFreqRank: number,
  minRank: number,
  maxRank: number,
  sampleSize: number,
): Promise<string[]> {
  // ランクは出力語彙全体に対する順位で定義される（SPEC §5.2）ので、
  // 一般名詞に絞る前に順位を確定させること。goal 自身は順位から除く。
  const rows = await db.execute<{ word: string }>(sql`
    WITH ranked AS (
      SELECT v.word, v.is_common_noun, v.is_concrete, v.freq_rank, v.pos,
             row_number() OVER (ORDER BY v.w2v <=> ${vectorOf(goal)}) AS rk
      FROM vocab v
      WHERE v.is_output AND v.word <> ${goal}
    )
    SELECT word FROM ranked
    WHERE rk BETWEEN ${minRank} AND ${maxRank}
      AND is_common_noun
      AND is_concrete
      AND pos = '名詞-普通名詞'
      AND freq_rank <= ${maxFreqRank}
    ORDER BY random()
    LIMIT ${sampleSize}
  `)
  return rows.rows.map((r) => r.word)
}

/**
 * ゴールに近すぎて「混ぜる語」に使えない語（入力語彙から上位 n 件）。
 * ゲーム作成時に 1 度だけ呼び、games.forbidden_inputs に保存する。
 * 出力語彙ではなく**入力語彙**から取ること（プレイヤーは入力語彙の語なら何でも打てる）。
 */
export async function goalNeighborhood(db: Db, goal: string, n: number): Promise<string[]> {
  if (n <= 0) return []
  const rows = await db.execute<{ word: string }>(sql`
    SELECT v.word
    FROM vocab v
    WHERE v.is_input AND v.word <> ${goal}
    ORDER BY v.w2v <=> ${vectorOf(goal)}
    LIMIT ${n}
  `)
  return rows.rows.map((r) => r.word)
}
