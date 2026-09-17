import { CLEAR_RANK } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import {
  attachRanks,
  compareMixCandidates,
  goalAwareScore,
  matchesProduction,
  rankMixCandidates,
  summarizeMixComparisons,
} from '../src/services/mix-scoring'

describe('goal-aware mix comparison', () => {
  const candidate = (word: string, blendSimilarity: number, goalSimilarity: number) => ({
    word,
    blendSimilarity,
    goalSimilarity,
  })

  it('beta=0 chooses the highest blend similarity', () => {
    expect(rankMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.8, 1)], 0)[0]?.word).toBe(
      'a',
    )
  })

  it('beta=1 chooses the highest goal similarity', () => {
    expect(rankMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.8, 1)], 1)[0]?.word).toBe(
      'b',
    )
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
    expect(rankMixCandidates([...rows].reverse(), 0.5).map((row) => row.word)).toEqual([
      'm',
      'a',
      'z',
    ])
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
    const summary = summarizeMixComparisons([
      attachRanks(
        result,
        new Map([
          ['a', 41_000],
          ['b', 39_500],
        ]),
      ),
    ])
    expect(summary.caseCount).toBe(1)
    expect(summary.variants.find((row) => row.beta === 0.02)?.goalImprovementRate).toBe(1)
  })
})

describe('rank-aware mix comparison', () => {
  const candidate = (word: string, blendSimilarity: number, goalSimilarity: number) => ({
    word,
    blendSimilarity,
    goalSimilarity,
  })

  /** a=classic（blend最優先）、b=beta>0 が選ぶ語。 */
  const twoWayComparison = () =>
    compareMixCandidates([candidate('a', 0.9, 0.1), candidate('b', 0.899, 0.9)], [0, 0.02])

  it('reports the rank of the classic pick and of every variant', () => {
    const ranked = attachRanks(
      twoWayComparison(),
      new Map([
        ['a', 41_000],
        ['b', 39_500],
      ]),
    )
    expect(ranked.classic?.rank).toBe(41_000)
    expect(ranked.variants.map((v) => [v.beta, v.rank])).toEqual([
      [0, 41_000],
      [0.02, 39_500],
    ])
  })

  it('measures improvement as ranks gained over the classic pick', () => {
    const ranked = attachRanks(
      twoWayComparison(),
      new Map([
        ['a', 41_000],
        ['b', 39_500],
      ]),
    )
    expect(ranked.variants.find((v) => v.beta === 0.02)?.rankImprovement).toBe(1_500)
    expect(ranked.variants.find((v) => v.beta === 0)?.rankImprovement).toBe(0)
  })

  it(`marks a pick cleared only at rank <= ${CLEAR_RANK}`, () => {
    const ranked = attachRanks(
      twoWayComparison(),
      new Map([
        ['a', CLEAR_RANK + 1],
        ['b', CLEAR_RANK],
      ]),
    )
    expect(ranked.classic?.cleared).toBe(false)
    expect(ranked.variants.find((v) => v.beta === 0.02)?.cleared).toBe(true)
  })

  it('rejects a missing rank instead of assuming one', () => {
    expect(() => attachRanks(twoWayComparison(), new Map([['a', 41_000]]))).toThrow(/b/)
  })

  it('separates "goal similarity went up" from "the game got winnable"', () => {
    // 現行の goalImprovementRate は満点でも、rank は 40,000 位圏内のまま。
    // CLEAR_RANK に届いていないことは clearRate でしか見えない。
    const summary = summarizeMixComparisons([
      attachRanks(
        twoWayComparison(),
        new Map([
          ['a', 41_000],
          ['b', 39_500],
        ]),
      ),
    ])
    const variant = summary.variants.find((row) => row.beta === 0.02)
    expect(variant?.goalImprovementRate).toBe(1)
    expect(variant?.meanRankImprovement).toBe(1_500)
    expect(variant?.clearRate).toBe(0)
  })

  it('averages rank metrics across cases', () => {
    const summary = summarizeMixComparisons([
      attachRanks(
        twoWayComparison(),
        new Map([
          ['a', 100],
          ['b', 50],
        ]),
      ),
      attachRanks(
        twoWayComparison(),
        new Map([
          ['a', 100],
          ['b', 100],
        ]),
      ),
    ])
    const variant = summary.variants.find((row) => row.beta === 0.02)
    expect(variant?.meanRankImprovement).toBe(25)
    expect(variant?.rankImprovementRate).toBe(0.5)
  })
})

describe('production equivalence flag', () => {
  it('is false when neither side produced a word', () => {
    expect(matchesProduction(null, null)).toBe(false)
  })

  it('is false when only one side produced a word', () => {
    expect(matchesProduction({ word: 'a' }, null)).toBe(false)
    expect(matchesProduction(null, 'a')).toBe(false)
  })

  it('compares the words when both sides produced one', () => {
    expect(matchesProduction({ word: 'a' }, 'a')).toBe(true)
    expect(matchesProduction({ word: 'a' }, 'b')).toBe(false)
  })
})
