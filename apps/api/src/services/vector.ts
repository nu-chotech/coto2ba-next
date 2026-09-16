/**
 * ベクトル演算（SQL ラッパ）。
 *
 * 設計上の要点（docs/ARCHITECTURE.md §3）:
 * - 1 手の処理は **1 本の SQL** に畳む。Vercel(sin1) ↔ Neon(sin1) でも 1 往復 ≈ 70ms かかる。
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
import { NEAREST_CANDIDATES, VECTOR_DIM } from '@coto2ba/contracts'
import { type SQL, sql } from 'drizzle-orm'
import type { Db } from '../db/client'

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
  const hint = blend(vectorOf(current), 1 - hintRatio, vectorOf(goal), hintRatio)
  const rows = await db.execute<{ word: string }>(sql`
    WITH cand AS (
      SELECT v.word
      FROM vocab v
      WHERE v.is_output
      ORDER BY v.w2v <=> ${hint}
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
 * 出力語彙・**単独トークンの一般名詞**・freq_rank <= maxFreqRank で、
 * （複合語を許すと「共同通信」「ベストアルバム」のような語が出てゲームの入り口として弱い。
 *  単独名詞に絞ると 8,091 語あり、プラチナ / 器官 / 人質 / 気温 / 磁気 のような語になる）
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
      SELECT v.word, v.is_common_noun, v.freq_rank, v.pos,
             row_number() OVER (ORDER BY v.w2v <=> ${vectorOf(goal)}) AS rk
      FROM vocab v
      WHERE v.is_output AND v.word <> ${goal}
    )
    SELECT word FROM ranked
    WHERE rk BETWEEN ${minRank} AND ${maxRank}
      AND is_common_noun
      AND pos = '名詞-普通名詞'
      AND freq_rank <= ${maxFreqRank}
    ORDER BY random()
    LIMIT ${sampleSize}
  `)
  return rows.rows.map((r) => r.word)
}
