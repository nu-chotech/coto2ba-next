/**
 * ガラスのタブバーの色のテスト。
 *
 * タブバーは **iOS 26 では Liquid Glass がシステム側で地に追従する**ので
 * `backgroundColor` は無視される見込みだが、**フォールバック環境
 * （iOS 26 未満 / Android / Web）では効く**。そこが破綻しないことを機械で固定する。
 *
 * ラベルが読めないタブバーは、展示で「どのタブにいるか分からない」に直結する。
 *
 * **地は「実際に描画で使われるもの」で測ること。**
 * 選択中のタブは**バーの地ではなく選択中の帯（indicator）の上に載る**ので、
 * バーの地に対して測ると通ってしまうが実際には読めない、という嘘のテストになる
 * （実際にそうなっていた。Web のライトで 1.18:1、ダークでも 3.58:1 だった）。
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

  // 選択中のラベルが載るのは **選択中の帯の上**。バーの地ではない。
  it('選択中のラベルが、その帯の上で読める', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(contrastRatio(colors.tint, colors.indicator), scheme).toBeGreaterThanOrEqual(READABLE)
    }
  })

  // 選んでいないタブは帯を敷かない（CSS で transparent）ので、地はバーそのもの。
  it('選んでいないタブのラベルが、バーの地の上で読める', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(contrastRatio(colors.label, colors.background), scheme).toBeGreaterThanOrEqual(
        READABLE,
      )
    }
  })

  // 帯を指定しないと expo-router の既定（#444444）が出る。
  // ライトの画面に濃いグレーの帯が出て、その上の藍色のラベルが 1.18:1 になっていた。
  it('選択中の帯を自分で指定している（既定の #444444 に任せない）', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(colors.indicator.toLowerCase(), scheme).not.toBe('#444444')
      expect(
        contrastRatio(colors.tint, '#444444'),
        `${scheme} は既定の帯では読めない`,
      ).toBeLessThan(READABLE)
    }
  })

  // 帯が地と同じ色だと、どのタブにいるか分からない。
  it('選択中の帯がバーの地と違う色である', () => {
    for (const scheme of SCHEMES) {
      const colors = tabBarColors(scheme)
      expect(colors.indicator, scheme).not.toBe(colors.background)
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
