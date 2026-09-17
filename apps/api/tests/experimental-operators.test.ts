import { describe, expect, it } from 'vitest'
import {
  cosineVector,
  operateVector,
  pickExperimentalWord,
  scoreExperimentalWord,
} from '../src/services/experimental-operators'

const current = [1, 0, 0]
const ingredient = [0, 1, 0]
const goal = [0, 0, 1]

describe('Python-inspired experimental operators', () => {
  it('uses a distinct direction for each operation', () => {
    expect(operateVector(current, ingredient, goal, 'mix', 0.5)[0]).toBeCloseTo(Math.SQRT1_2)
    expect(operateVector(current, ingredient, goal, 'slerp', 0.5)[1]).toBeCloseTo(Math.SQRT1_2)
    expect(operateVector(current, ingredient, goal, 'subtract', 0.5)[1]).toBeLessThan(0)
    expect(operateVector(current, ingredient, goal, 'repel', 0.5)[2]).toBeGreaterThan(0)
    expect(operateVector(current, ingredient, goal, 'purify', 0.5)[1]).toBeGreaterThan(0)
  })

  it('normalizes outputs and deterministically samples near neighbors', () => {
    const result = operateVector([1, 0, 0], [1, 1, 0], goal, 'slerp', 0.4)
    expect(cosineVector(result, result)).toBeCloseTo(1)
    const candidates = [
      { word: 'A', similarity: 0.9 },
      { word: 'B', similarity: 0.8 },
    ]
    expect(pickExperimentalWord(candidates, 'game:turn')).toBe(
      pickExperimentalWord(candidates, 'game:turn'),
    )
  })

  it('returns extra score metrics without redefining rank or tier', () => {
    const result = scoreExperimentalWord({
      current,
      ingredient,
      goal,
      result: [0, 0.5, 1],
      neighborSimilarities: [0.8, 0.7],
      operation: 'repel',
      previousCombo: 0,
      comboEnabled: true,
    })
    expect(result.delta_similarity).toBeGreaterThan(0)
    expect(result.combo).toBe(1)
    expect(result.score).toBeGreaterThan(0)
    expect(result.breakdown.risk).toBeGreaterThanOrEqual(0.28)
  })
})
