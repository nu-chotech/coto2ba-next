import { describe, expect, it } from 'vitest'
import { craftBeta } from '../src/services/craft-config'

describe('craft beta', () => {
  it('難易度・コンボ・目標補正の設定を反映する', () => {
    expect(craftBeta('normal', 0, true, true)).toBe(0.03)
    expect(craftBeta('easy', 0, true, true)).toBe(0.12)
    expect(craftBeta('normal', 2, true, true)).toBeCloseTo(0.08)
    expect(craftBeta('normal', 2, false, true)).toBe(0.03)
    expect(craftBeta('easy', 100, true, true)).toBe(0.22)
    expect(craftBeta('easy', 100, true, false)).toBe(0)
  })
})
