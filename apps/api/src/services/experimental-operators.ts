import { createHash } from 'node:crypto'
import type { ExperimentOperation } from '@coto2ba/contracts'

export type { ExperimentOperation }

const TARGET_WEIGHT = 6800
const COHERENCE_WEIGHT = 1300
const RARITY_WEIGHT = 1900
const NOVELTY_WEIGHT = 900
const RISK_PENALTY = 1700
const TEMPERATURE = 0.18

export function normalizeVector(vector: readonly number[]): number[] {
  const norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('zero or invalid vector')
  return vector.map((value) => value / norm)
}

export function cosineVector(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('vector dimensions differ')
  const a = normalizeVector(left)
  const b = normalizeVector(right)
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0)
}

/** semantic_alchemy.py の operate と同じベクトル式。DB に保存された正規化済み語彙を使う。 */
export function operateVector(
  current: readonly number[],
  ingredient: readonly number[],
  goal: readonly number[],
  operation: ExperimentOperation,
  strength: number,
): number[] {
  if (current.length !== ingredient.length || current.length !== goal.length) {
    throw new Error('vector dimensions differ')
  }
  const a = normalizeVector(current)
  const b = normalizeVector(ingredient)
  const g = normalizeVector(goal)
  if (operation === 'slerp') {
    const dot = Math.max(-1, Math.min(1, cosineVector(a, b)))
    const omega = Math.acos(dot)
    const sine = Math.sin(omega)
    if (Math.abs(sine) > 1e-6) {
      return normalizeVector(
        a.map(
          (value, index) =>
            (Math.sin((1 - strength) * omega) / sine) * value +
            (Math.sin(strength * omega) / sine) * b[index]!,
        ),
      )
    }
  }
  const projection = cosineVector(a, b)
  return normalizeVector(
    a.map((value, index) => {
      const other = b[index]!
      switch (operation) {
        case 'mix':
        case 'slerp':
          return (1 - strength) * value + strength * other
        case 'subtract':
          return value - strength * other
        case 'repel':
          return value + strength * g[index]! - strength * 0.78 * other
        case 'purify':
          return value + strength * (other - projection * value)
        default:
          throw new Error('unknown operation')
      }
    }),
  )
}

export function pickExperimentalWord(
  candidates: readonly { word: string; similarity: number }[],
  seed: string,
): string | null {
  if (candidates.length === 0) return null
  const maximum = Math.max(...candidates.map((item) => item.similarity))
  const weights = candidates.map((item) => Math.exp((item.similarity - maximum) / TEMPERATURE))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const random = createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000
  let threshold = random * total
  for (let index = 0; index < candidates.length; index++) {
    threshold -= weights[index]!
    if (threshold < 0) return candidates[index]!.word
  }
  return candidates.at(-1)!.word
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Python の評価内訳。既存 rank / tier やランキングには使わない実験用スコア。 */
export function scoreExperimentalWord(input: {
  current: readonly number[]
  ingredient: readonly number[]
  goal: readonly number[]
  result: readonly number[]
  neighborSimilarities: readonly number[]
  operation: ExperimentOperation
  previousCombo: number
  comboEnabled: boolean
}) {
  const currentSimilarity = cosineVector(input.current, input.goal)
  const nextSimilarity = cosineVector(input.result, input.goal)
  const deltaSimilarity = nextSimilarity - currentSimilarity
  const target = clamp01((nextSimilarity + 1) / 2)
  const coherence = clamp01(
    ((cosineVector(input.result, input.current) + 1) / 2 +
      (cosineVector(input.result, input.ingredient) + 1) / 2) /
      2,
  )
  const density =
    input.neighborSimilarities.length === 0
      ? 0
      : input.neighborSimilarities.reduce((sum, value) => sum + value, 0) /
        input.neighborSimilarities.length
  const rarity = clamp01(1 - density)
  const novelty = clamp01(1 - (cosineVector(input.result, input.current) + 1) / 2)
  const baseRisk = { mix: 0.05, slerp: 0.08, purify: 0.16, repel: 0.28, subtract: 0.34 }[
    input.operation
  ]
  const risk = clamp01(
    baseRisk + Math.max(0, 0.55 - coherence) * 0.9 + Math.max(0, target - 0.82) ** 2,
  )
  const combo = !input.comboEnabled
    ? 0
    : deltaSimilarity >= 0.03
      ? input.previousCombo + 1
      : deltaSimilarity >= 0
        ? input.previousCombo
        : 0
  const multiplier = 1 + Math.min(combo * 0.12, 0.6) + (risk >= 0.28 ? 0.08 : 0)
  const baseScore = Math.max(
    0,
    TARGET_WEIGHT * target +
      COHERENCE_WEIGHT * coherence +
      RARITY_WEIGHT * rarity +
      NOVELTY_WEIGHT * novelty -
      RISK_PENALTY * risk,
  )
  return {
    target_similarity: nextSimilarity,
    delta_similarity: deltaSimilarity,
    combo,
    score: baseScore * multiplier,
    multiplier,
    breakdown: { target, coherence, rarity, novelty, risk },
  }
}
