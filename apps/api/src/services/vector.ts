/**
 * ベクトル演算（SQL ラッパ）。
 *
 * 設計上の要点（docs/ARCHITECTURE.md §3）:
 * - 1 手の処理は **1 本の SQL** に畳む。Vercel(sin1) ↔ Neon(sin1) でも往復は効くし、
 *   もし別リージョンになったら 1 往復 70〜90ms が 4〜5 回のしかかる。
 * - 最近傍は HNSW インデックス、**ランクは厳密な全走査**。HNSW は近似なので
 *   同じ盤面で rank が揺れてスコアが再現しなくなる。
 * - 除外リストは必ず `sql.param(list)` + 明示 `::text[]`。
 *   `sql`... <> ALL(${jsArray})`` はパラメータ列にコンパイルされて 42809 になる。
 * - halfvec のスカラー倍は演算子が無いので `array_fill(s, ARRAY[dim])::vector` との
 *   要素ごと積で表現する。
 */
import { NEAREST_CANDIDATES, VECTOR_DIM } from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/client'

export interface MixResult {
  result: string
  rank: number
}

/** (1-ratio)*current + ratio*input の混合ベクトルを表す SQL 断片。 */
function mixedVectorSql(ratio: number) {
  const a = 1 - ratio
  return sql`(
    (c.w2v::vector * array_fill(${a}::real, ARRAY[${sql.raw(String(VECTOR_DIM))}])::vector)
    + (i.w2v::vector * array_fill(${ratio}::real, ARRAY[${sql.raw(String(VECTOR_DIM))}])::vector)
  )::halfvec(${sql.raw(String(VECTOR_DIM))})`
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
  const rows = await db.execute<{ result: string; rank: number }>(sql`
    WITH
      g AS (SELECT w2v FROM vocab WHERE word = ${goal}),
      c AS (SELECT w2v FROM vocab WHERE word = ${current}),
      i AS (SELECT w2v FROM vocab WHERE word = ${input}),
      mixed AS (SELECT ${mixedVectorSql(ratio)} AS v FROM c, i),
      cand AS (
        SELECT v.word, v.w2v
        FROM vocab v, mixed
        WHERE v.is_output
        ORDER BY v.w2v <=> mixed.v
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
          FROM vocab v2, g
          WHERE v2.is_output
            AND v2.word <> ${goal}
            AND (v2.w2v <=> g.w2v) < (p.w2v <=> g.w2v)
        )
      END AS rank
    FROM picked p, g
  `)
  const row = rows.rows[0]
  return row ? { result: row.result, rank: Number(row.rank) } : null
}

/**
 * ゴールから見た語のランク。
 * rank = 1 + |{ w ∈ 出力語彙 : w ≠ goal, cos(w, goal) > cos(word, goal) }|
 * word === goal のときは 0（完全錬成）。
 */
export async function rankOf(db: Db, goal: string, word: string): Promise<number | null> {
  if (word === goal) return 0
  const rows = await db.execute<{ rank: number }>(sql`
    WITH g AS (SELECT w2v FROM vocab WHERE word = ${goal}),
         r AS (SELECT w2v FROM vocab WHERE word = ${word})
    SELECT 1 + count(*)::int AS rank
    FROM vocab v, g, r
    WHERE v.is_output AND v.word <> ${goal}
      AND (v.w2v <=> g.w2v) < (r.w2v <=> g.w2v)
  `)
  const row = rows.rows[0]
  return row ? Number(row.rank) : null
}

/**
 * ヒント語。v_hint = (1 - hintRatio) * v_current + hintRatio * v_goal の近傍から
 * 除外語を抜いた先頭 n 件。
 */
export async function hintWords(
  db: Db,
  goal: string,
  current: string,
  exclude: string[],
  hintRatio: number,
  candidates: number,
  limit: number,
): Promise<string[]> {
  const a = 1 - hintRatio
  const dim = sql.raw(String(VECTOR_DIM))
  const rows = await db.execute<{ word: string }>(sql`
    WITH
      c AS (SELECT w2v FROM vocab WHERE word = ${current}),
      g AS (SELECT w2v FROM vocab WHERE word = ${goal}),
      hint AS (
        SELECT (
          (c.w2v::vector * array_fill(${a}::real, ARRAY[${dim}])::vector)
          + (g.w2v::vector * array_fill(${hintRatio}::real, ARRAY[${dim}])::vector)
        )::halfvec(${dim}) AS v
        FROM c, g
      ),
      cand AS (
        SELECT v.word
        FROM vocab v, hint
        WHERE v.is_output
        ORDER BY v.w2v <=> hint.v
        LIMIT ${candidates}
      )
    SELECT word FROM cand
    WHERE word <> ALL(${sql.param(exclude)}::text[])
    LIMIT ${limit}
  `)
  return rows.rows.map((r) => r.word)
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
    WITH t AS (SELECT w2v FROM vocab WHERE word = ${word})
    SELECT v.word, (1 - (v.w2v <=> t.w2v))::real AS similarity
    FROM vocab v, t
    WHERE v.word = ANY(${sql.param(among)}::text[]) AND v.word <> ${word}
    ORDER BY v.w2v <=> t.w2v
    LIMIT ${limit}
  `)
  return rows.rows.map((r) => ({ word: r.word, similarity: Number(r.similarity) }))
}

/**
 * スタート語の抽選（SPEC §6.3）。
 * 出力語彙・一般名詞・freq_rank <= maxFreqRank・NG 外（vocab 構築時に除外済み）で、
 * goal から見た rank が [minRank, maxRank] に入る語からランダムに 1 つ。
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
    WITH
      g AS (SELECT w2v FROM vocab WHERE word = ${goal}),
      ranked AS (
        SELECT v.word, v.is_common_noun, v.freq_rank,
               row_number() OVER (ORDER BY v.w2v <=> g.w2v) AS rk
        FROM vocab v, g
        WHERE v.is_output AND v.word <> ${goal}
      )
    SELECT word FROM ranked
    WHERE rk BETWEEN ${minRank} AND ${maxRank}
      AND is_common_noun
      AND freq_rank <= ${maxFreqRank}
    ORDER BY random()
    LIMIT ${sampleSize}
  `)
  return rows.rows.map((r) => r.word)
}
