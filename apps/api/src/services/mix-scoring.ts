/** 本番の結果選択から独立した、混合候補の比較用採点。 */
import { CLEAR_RANK } from '@coto2ba/contracts'

export type MixCandidateScore = {
  word: string
  blendSimilarity: number
  goalSimilarity: number
}

export const EXPERIMENT_BETAS = [0, 0.02, 0.05, 0.1, 0.2] as const

export function goalAwareScore(candidate: MixCandidateScore, beta: number): number {
  if (!Number.isFinite(beta) || beta < 0 || beta > 1) {
    throw new RangeError('beta must be in [0, 1]')
  }
  if (!Number.isFinite(candidate.blendSimilarity) || !Number.isFinite(candidate.goalSimilarity)) {
    throw new TypeError('candidate similarities must be finite')
  }
  const score = (1 - beta) * candidate.blendSimilarity + beta * candidate.goalSimilarity
  if (!Number.isFinite(score)) throw new TypeError('candidate score must be finite')
  return score
}

export type ScoredMixCandidate = MixCandidateScore & { score: number }

export function rankMixCandidates(
  candidates: readonly MixCandidateScore[],
  beta: number,
): ScoredMixCandidate[] {
  // Empty lists still validate beta; callers should not silently accept invalid settings.
  if (!Number.isFinite(beta) || beta < 0 || beta > 1) {
    throw new RangeError('beta must be in [0, 1]')
  }
  return candidates
    .map((candidate) => ({ ...candidate, score: goalAwareScore(candidate, beta) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.blendSimilarity - a.blendSimilarity ||
        // UTF-16 code unit order is locale-independent; vocab.word is unique in DB.
        (a.word < b.word ? -1 : a.word > b.word ? 1 : 0) ||
        b.goalSimilarity - a.goalSimilarity,
    )
}

export type MixComparison = {
  classic: ScoredMixCandidate | null
  variants: Array<{
    beta: number
    word: string
    blendSimilarity: number
    goalSimilarity: number
    score: number
    changedFromClassic: boolean
    blendDifference: number
    goalDifference: number
  }>
}

export function compareMixCandidates(
  candidates: readonly MixCandidateScore[],
  betas: readonly number[] = EXPERIMENT_BETAS,
): MixComparison {
  const classic = rankMixCandidates(candidates, 0)[0] ?? null
  const variants = betas.map((beta) => {
    const selected = rankMixCandidates(candidates, beta)[0]
    if (!selected || !classic) return null
    return {
      beta,
      ...selected,
      changedFromClassic: selected.word !== classic.word,
      blendDifference: selected.blendSimilarity - classic.blendSimilarity,
      goalDifference: selected.goalSimilarity - classic.goalSimilarity,
    }
  })
  return { classic, variants: variants.filter((v): v is NonNullable<typeof v> => v !== null) }
}

/**
 * ゴール類似度は rank の単調関数なので「上がったか」は一致するが、
 * どれだけクリア（rank <= CLEAR_RANK）に近づいたかは cos 値からは読めない。
 * 実際の勝敗条件で読めるように rank を併せて持たせる。
 */
export type RankedMixCandidate = ScoredMixCandidate & { rank: number; cleared: boolean }

export type RankedMixVariant = MixComparison['variants'][number] & {
  rank: number
  cleared: boolean
  /** rank は小さいほどゴールに近いので、改善を正の数で表す。 */
  rankImprovement: number
}

export type RankedMixComparison = {
  classic: RankedMixCandidate | null
  variants: RankedMixVariant[]
}

function rankFor(rankByWord: ReadonlyMap<string, number>, word: string): number {
  const rank = rankByWord.get(word)
  // rank 取得に失敗した語を 0 などで埋めると、実験結果が静かに壊れる。
  if (rank === undefined) throw new Error(`rank missing for ${word}`)
  return rank
}

export function attachRanks(
  comparison: MixComparison,
  rankByWord: ReadonlyMap<string, number>,
): RankedMixComparison {
  if (!comparison.classic) return { classic: null, variants: [] }
  const classicRank = rankFor(rankByWord, comparison.classic.word)
  return {
    classic: { ...comparison.classic, rank: classicRank, cleared: classicRank <= CLEAR_RANK },
    variants: comparison.variants.map((variant) => {
      const rank = rankFor(rankByWord, variant.word)
      return { ...variant, rank, cleared: rank <= CLEAR_RANK, rankImprovement: classicRank - rank }
    }),
  }
}

/**
 * 比較用の選択が本番 mixAndRank と一致したか。
 * どちらかが語を出していない場合は「一致」ではなく「比較していない」なので false。
 */
export function matchesProduction(
  classic: { word: string } | null,
  productionResult: string | null,
): boolean {
  if (!classic || productionResult === null) return false
  return classic.word === productionResult
}

export function summarizeMixComparisons(comparisons: readonly RankedMixComparison[]) {
  const cases = comparisons.filter((comparison) => comparison.classic !== null)
  const betas = cases[0]?.variants.map((variant) => variant.beta) ?? []
  return {
    caseCount: cases.length,
    variants: betas.map((beta) => {
      const rows = cases.map((comparison) => comparison.variants.find((v) => v.beta === beta)!)
      const words = new Map<string, number>()
      for (const row of rows) words.set(row.word, (words.get(row.word) ?? 0) + 1)
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / rows.length
      return {
        beta,
        changeRate: mean(rows.map((row) => Number(row.changedFromClassic))),
        meanBlendSimilarity: mean(rows.map((row) => row.blendSimilarity)),
        meanGoalSimilarity: mean(rows.map((row) => row.goalSimilarity)),
        meanBlendLoss: mean(rows.map((row) => -row.blendDifference)),
        meanGoalGain: mean(rows.map((row) => row.goalDifference)),
        goalImprovementRate: mean(rows.map((row) => Number(row.goalDifference > 0))),
        meanRankImprovement: mean(rows.map((row) => row.rankImprovement)),
        rankImprovementRate: mean(rows.map((row) => Number(row.rankImprovement > 0))),
        clearRate: mean(rows.map((row) => Number(row.cleared))),
        distinctResults: words.size,
        topWordConcentration: Math.max(...words.values()) / rows.length,
      }
    }),
  }
}
