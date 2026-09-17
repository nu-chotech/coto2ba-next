/**
 * ガラスのタブバーの色のテスト。
 *
 * タブバーは **iOS 26 では Liquid Glass がシステム側で地に追従する**ので
 * `backgroundColor` は無視される見込みだが、**フォールバック環境
 * （iOS 26 未満 / Android / Web）では効く**。そこが破綻しないことを機械で固定する。
 *
 * ラベルが読めないタブバーは、展示で「どのタブにいるか分からない」に直結する。
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../src/theme/color'
import { PALETTES, SCHEMES } from '../src/theme/palettes'
import { tabBarColors } from '../src/theme/tabs'
import { TIER_PALETTES } from '../src/theme/tiers'

/** WCAG AA（本文）。会場は照明が明るいので補足の 3 では足りない。 */
const READABLE = 4.5

describe('タブバーの色', () => {
  it('両スキームぶんある', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(colors.background, scheme).toBeTruthy()
      expect(colors.tint, scheme).toBeTruthy()
      expect(colors.label, scheme).toBeTruthy()
    }
  })

  it('地はその スキームの base', () => {
    for (const scheme of SCHEMES) {
      expect(tabBarColors(scheme).background).toBe(PALETTES[scheme].base)
    }
  })

  // 選んでいるタブが分からないと、展示で迷子になる。
  it('選択中のタブの色が地に対して読める', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(contrastRatio(colors.tint, colors.background), scheme).toBeGreaterThanOrEqual(READABLE)
    }
  })

  it('選んでいないタブのラベルが地に対して読める', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(contrastRatio(colors.label, colors.background), scheme).toBeGreaterThanOrEqual(
        READABLE,
      )
    }
  })

  // ダークは実機で評価されている見た目。値を動かさない。
  it('ダークの見た目は今までと同じ', () => {
    const colors = tabBarColors('dark')
    expect(colors.background).toBe('#0B0B10')
    expect(colors.tint).toBe(TIER_PALETTES.dark.cosmos.accent)
    expect(colors.label).toBe(TIER_PALETTES.dark.mono.sub)
  })

  // 選択中と非選択が同じ色だと、どちらにいるか分からない。
  it('選択中と非選択が別の色である', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(colors.tint, scheme).not.toBe(colors.label)
    }
  })
})
