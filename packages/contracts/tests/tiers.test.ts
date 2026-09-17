import { describe, expect, it } from 'vitest'
import { CLEAR_RANK, TIER_IDS, TIERS } from '../src/constants'
import { isTierDown, isTierUp, TIER_ORDER, tierForRank } from '../src/tiers'

describe('TIERS の構造', () => {
  it('maxRank は昇順（tierForRank が先頭一致で正しく効く前提）', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i]?.maxRank).toBeGreaterThan(TIERS[i - 1]?.maxRank as number)
    }
  })

  it('最後の帯はすべてを受け止める', () => {
    expect(TIERS.at(-1)?.maxRank).toBe(Number.POSITIVE_INFINITY)
  })

  it('TIER_ORDER はすべての帯を持ち、重複しない', () => {
    expect(Object.keys(TIER_ORDER).sort()).toEqual([...TIER_IDS].sort())
    expect(new Set(Object.values(TIER_ORDER)).size).toBe(TIER_IDS.length)
  })

  it('TIER_ORDER の並びは TIERS の逆順（近いほど大きい）', () => {
    const byOrder = [...TIER_IDS].sort((a, b) => TIER_ORDER[b] - TIER_ORDER[a])
    expect(byOrder).toEqual(TIERS.map((t) => t.id))
  })
})

describe('tierForRank', () => {
  it.each([
    [0, 'gold'],
    [1, 'gold'],
    [10, 'gold'],
    [11, 'cosmos'],
    [300, 'cosmos'],
    [301, 'color'],
    [3000, 'color'],
    [3001, 'mono'],
    [1_000_000, 'mono'],
  ])('rank %i は %s', (rank, expected) => {
    expect(tierForRank(rank)).toBe(expected)
  })

  it('クリアランクは gold（CLEAR_RANK と TIERS が食い違わないこと）', () => {
    expect(tierForRank(CLEAR_RANK)).toBe('gold')
    expect(tierForRank(CLEAR_RANK + 1)).not.toBe('gold')
  })

  it('ランクが上がるほど帯は下がる（単調）', () => {
    const ranks = [0, 5, 10, 50, 300, 1000, 3000, 10_000]
    const orders = ranks.map((r) => TIER_ORDER[tierForRank(r)])
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeLessThanOrEqual(orders[i - 1] as number)
    }
  })
})

describe('isTierUp / isTierDown', () => {
  it('上がった・下がったを正しく判定する', () => {
    expect(isTierUp('mono', 'color')).toBe(true)
    expect(isTierUp('color', 'mono')).toBe(false)
    expect(isTierDown('gold', 'cosmos')).toBe(true)
    expect(isTierDown('cosmos', 'gold')).toBe(false)
  })

  it('同じ帯なら上でも下でもない', () => {
    for (const id of TIER_IDS) {
      expect(isTierUp(id, id)).toBe(false)
      expect(isTierDown(id, id)).toBe(false)
    }
  })

  it('上と下が同時に成り立つことはない', () => {
    for (const a of TIER_IDS) {
      for (const b of TIER_IDS) {
        expect(isTierUp(a, b) && isTierDown(a, b)).toBe(false)
      }
    }
  })
})
