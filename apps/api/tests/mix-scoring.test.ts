import { describe, expect, it } from 'vitest'
import {
  compareMixCandidates,
  goalAwareScore,
  rankMixCandidates,
  summarizeMixComparisons,
} from '../src/services/mix-scoring'

describe('goal-aware mix comparison', () => {
  const candidate = (word: string, blendSimilarity: number, goalSimilarity: number) => ({
    word, blendSimilarity, goalSimilarity,
  })

  it('beta=0 chooses the highest blend similarity', () => {
    expect(rankMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.8, 1)], 0)[0]?.word).toBe('a')
  })

  it('beta=1 chooses the highest goal similarity', () => {
    expect(rankMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.8, 1)], 1)[0]?.word).toBe('b')
  })

  it('a small beta breaks a close blend race toward goal', () => {
    const rows = [candidate('a', 0.9, 0.1), candidate('b', 0.899, 0.9)]
    expect(rankMixCandidates(rows, 0.02)[0]?.word).toBe('b')
  })

  it('a large blend gap still favors material coherence', () => {
    const rows = [candidate('a', 0.9, 0.1), candidate('b', 0.7, 0.9)]
    expect(rankMixCandidates(rows, 0.02)[0]?.word).toBe('a')
  })

  it('uses score, then blend, then word for deterministic ties', () => {
    const rows = [candidate('z', 0.5, 0.5), candidate('a', 0.5, 0.5), candidate('m', 0.75, 0.25)]
    expect(rankMixCandidates(rows, 0.5).map((row) => row.word)).toEqual(['m', 'a', 'z'])
    expect(rankMixCandidates([...rows].reverse(), 0.5).map((row) => row.word)).toEqual(['m', 'a', 'z'])
  })

  it('rejects invalid beta, even for an empty list', () => {
    for (const beta of [-0.01, 1.01, Number.NaN, Infinity, -Infinity]) {
      expect(() => goalAwareScore(candidate('a', 0.5, 0.5), beta)).toThrow()
      expect(() => rankMixCandidates([], beta)).toThrow()
    }
  })

  it('rejects non-finite candidate values', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => goalAwareScore(candidate('a', bad, 0.5), 0.02)).toThrow()
      expect(() => goalAwareScore(candidate('a', 0.5, bad), 0.02)).toThrow()
    }
  })

  it('does not modify its input array or candidates', () => {
    const rows = Object.freeze([
      Object.freeze(candidate('b', 0.7, 0.8)),
      Object.freeze(candidate('a', 0.8, 0.1)),
    ])
    rankMixCandidates(rows, 0.02)
    expect(rows.map((row) => row.word)).toEqual(['b', 'a'])
  })

  it('handles empty arrays and summarizes comparison metrics', () => {
    expect(compareMixCandidates([])).toEqual({ classic: null, variants: [] })
    expect(summarizeMixComparisons([])).toEqual({ caseCount: 0, variants: [] })
    const result = compareMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.899, 0.9)])
    const summary = summarizeMixComparisons([result])
    expect(summary.caseCount).toBe(1)
    expect(summary.variants.find((row) => row.beta === 0.02)?.goalImprovementRate).toBe(1)
  })
})
