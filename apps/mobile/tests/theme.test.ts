/**
 * パレットのテスト。
 *
 * 会場は照明が明るく屋外光も入る。コントラストが足りないと現地で読めないので、
 * **両スキーム・全 tier で読めること**を機械で固定する。
 * ダークは既に評価されている見た目なので、**値が変わっていないこと**も固定する。
 *
 * 計画では `src/theme/tokens.ts` から読む想定だったが、tokens.ts は `Platform` を
 * 使うため vitest からは読めない。色と寸法は react-native に依存しない
 * `palettes.ts` / `metrics.ts` / `tiers.ts` に分けてあるので、そこから読む。
 */

import { TIER_IDS, TIER_ORDER } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { compositeOver, contrastRatio } from '../src/theme/color'
import { PALETTES, SCHEMES, type Scheme } from '../src/theme/palettes'
import { TIER_PALETTES, tierPalettes } from '../src/theme/tiers'

const ROLES = [
  'base',
  'surface',
  'text',
  'sub',
  'border',
  'accent',
  'pressed',
  'glassTint',
] as const

/** WCAG AA。本文 4.5、補足（大きめ・補助）3。 */
const READABLE = 4.5
const READABLE_SUB = 3

describe('パレット', () => {
  it('light と dark の両方がある', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['dark', 'light'])
  })

  it('SCHEMES が PALETTES のキーと一致する', () => {
    expect([...SCHEMES].sort()).toEqual(Object.keys(PALETTES).sort())
  })

  // 片方にしか無い役割があると、その画面だけスキーム切替で破綻する。
  it('どちらのスキームも同じ役割を全部持つ', () => {
    for (const scheme of SCHEMES) {
      for (const role of ROLES) expect(PALETTES[scheme]).toHaveProperty(role)
    }
  })

  it('tier ごとに両スキームのパレットがある', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_IDS) expect(TIER_PALETTES[scheme]).toHaveProperty(tier)
    }
  })

  it('本文と背景のコントラスト比が 4.5 以上ある', () => {
    for (const scheme of SCHEMES) {
      expect(contrastRatio(PALETTES[scheme].text, PALETTES[scheme].base)).toBeGreaterThanOrEqual(
        READABLE,
      )
    }
  })

  it('補足文字と背景のコントラスト比が 3 以上ある', () => {
    for (const scheme of SCHEMES) {
      expect(contrastRatio(PALETTES[scheme].sub, PALETTES[scheme].base)).toBeGreaterThanOrEqual(
        READABLE_SUB,
      )
    }
  })
})

describe('tier パレット', () => {
  const each = (run: (scheme: Scheme, tier: (typeof TIER_IDS)[number]) => void) => {
    for (const scheme of SCHEMES) for (const tier of TIER_IDS) run(scheme, tier)
  }

  it('tier ごとの本文も読める', () => {
    each((scheme, tier) => {
      const p = TIER_PALETTES[scheme][tier]
      expect(contrastRatio(p.text, p.bg), `${scheme}/${tier}`).toBeGreaterThanOrEqual(READABLE)
    })
  })

  it('tier ごとの補足も読める', () => {
    each((scheme, tier) => {
      const p = TIER_PALETTES[scheme][tier]
      expect(contrastRatio(p.sub, p.bg), `${scheme}/${tier}`).toBeGreaterThanOrEqual(READABLE_SUB)
    })
  })

  // ghost ボタンは accent の文字だけで地に載る。
  it('accent が地に対して読める', () => {
    each((scheme, tier) => {
      const p = TIER_PALETTES[scheme][tier]
      expect(contrastRatio(p.accent, p.bg), `${scheme}/${tier}`).toBeGreaterThanOrEqual(READABLE)
    })
  })

  // primary ボタンは accent の上に onAccent の文字が載る。
  it('onAccent が accent の上で読める', () => {
    each((scheme, tier) => {
      const p = TIER_PALETTES[scheme][tier]
      expect(contrastRatio(p.onAccent, p.accent), `${scheme}/${tier}`).toBeGreaterThanOrEqual(
        READABLE,
      )
    })
  })

  // 「mono → 暖色 → 宇宙 → 黄金」の温度の物語をライトでも壊さない。
  // 単純反転ではないので、ライトでも地は「明るいまま」であることだけ固定しておく。
  it('ライトの地はどの tier でも明るい', () => {
    for (const tier of TIER_IDS) {
      const p = TIER_PALETTES.light[tier]
      expect(contrastRatio(p.bg, '#FFFFFF'), tier).toBeLessThan(1.6)
    }
  })

  // 宇宙は「暗い面」として残す。面（カードの地）がいちばん深いのは cosmos。
  // 面は半透明なので、地に重ねた結果で測る。
  it('ライトの cosmos の面が 4 つの中でいちばん深い', () => {
    const depth = (tier: (typeof TIER_IDS)[number]) => {
      const p = TIER_PALETTES.light[tier]
      return contrastRatio(compositeOver(p.surface, p.bg), p.bg)
    }
    for (const tier of TIER_IDS) {
      if (tier === 'cosmos') continue
      expect(depth('cosmos'), tier).toBeGreaterThan(depth(tier))
    }
  })
})

describe('ダークの値', () => {
  // 既に良い評価を得ている見た目なので、ここは動かさない。
  it('tierPalettes は TIER_PALETTES.dark と同じものを指す', () => {
    expect(tierPalettes).toBe(TIER_PALETTES.dark)
  })

  it('確定値が変わっていない', () => {
    expect(TIER_PALETTES.dark.mono.bg).toBe('#0B0B10')
    expect(TIER_PALETTES.dark.color.bg).toBe('#141017')
    expect(TIER_PALETTES.dark.cosmos.bg).toBe('#080A1C')
    expect(TIER_PALETTES.dark.gold.bg).toBe('#14100A')
    expect(PALETTES.dark.base).toBe('#0B0B10')
  })

  it('tier の並びは TIER_ORDER のまま', () => {
    expect(TIER_ORDER.mono).toBeLessThan(TIER_ORDER.gold)
  })
})

describe('contrastRatio', () => {
  it('白と黒は 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })

  it('同じ色は 1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })
})
