/**
 * ボタンの色と寸法のテスト。
 *
 * 会場は屋外光が入る明るい照明で、ガラスの上の薄い文字は読めなくなる。
 * 「どの tier・どの variant でも文字が地に対して読めること」を機械で固定しておく。
 */

import { TIER_IDS } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { BUTTON_VARIANTS, buttonSurface } from '../src/components/buttonStyle'
import { MIN_TAP_SIZE } from '../src/components/constants'
import { contrastRatio } from '../src/theme/color'
import { layout } from '../src/theme/metrics'
import { SCHEMES } from '../src/theme/palettes'
import { TIER_PALETTES } from '../src/theme/tiers'

/** WCAG AA（本文）。 */
const READABLE = 4.5

describe('タップ領域', () => {
  it('Apple の最小タップ領域は 44pt', () => {
    expect(MIN_TAP_SIZE).toBe(44)
  })

  it('ボタンの高さが最小タップ領域を下回らない', () => {
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(MIN_TAP_SIZE)
  })

  it('入力欄の高さが最小タップ領域を下回らない', () => {
    expect(layout.inputHeight).toBeGreaterThanOrEqual(MIN_TAP_SIZE)
  })
})

describe('ボタンの配色', () => {
  it('variant は primary / secondary / ghost の 3 つ', () => {
    expect([...BUTTON_VARIANTS].sort()).toEqual(['ghost', 'primary', 'secondary'])
  })

  it('どのスキーム・どの tier・どの variant でも文字が地に対して読める', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_IDS) {
        for (const variant of BUTTON_VARIANTS) {
          const surface = buttonSurface(variant, TIER_PALETTES[scheme][tier])
          expect(
            contrastRatio(surface.label, surface.contrastAgainst),
            `${scheme} / ${tier} / ${variant}`,
          ).toBeGreaterThanOrEqual(READABLE)
        }
      }
    }
  })

  it('primary はガラスの上に tier の accent を乗せる', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_IDS) {
        const surface = buttonSurface('primary', TIER_PALETTES[scheme][tier])
        expect(surface.fill).toBe(TIER_PALETTES[scheme][tier].accent)
        expect(surface.usesGlass).toBe(true)
      }
    }
  })

  it('ghost はガラスを敷かない（iOS の plain ボタン）', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_IDS) {
        expect(buttonSurface('ghost', TIER_PALETTES[scheme][tier]).usesGlass).toBe(false)
      }
    }
  })
})
