/**
 * タイポグラフィと余白のテスト。
 *
 * 「しょぼい」の残りの実体は余白とヒエラルキーの不足だった。
 * Apple のメトリクス（Large Title 34、本文 17、補足 15、ラベル 13、
 * 最小タップ 44、画面の左右 16〜20）から外れていないことを機械で固定する。
 *
 * **和文なので letterSpacing を負にしない。** 字面が詰まって汚くなる。
 */

import { describe, expect, it } from 'vitest'
import { MIN_TAP_SIZE } from '../src/components/constants'
import { layout, spacing } from '../src/theme/metrics'
import { heroFontSize, screenInsets, TYPE_SCALE } from '../src/theme/type'

describe('タイポグラフィ', () => {
  it('Apple の本文・補足・ラベルの寸法に合っている', () => {
    expect(TYPE_SCALE.largeTitle.fontSize).toBe(34)
    expect(TYPE_SCALE.body.fontSize).toBe(17)
    expect(TYPE_SCALE.caption.fontSize).toBe(15)
    expect(TYPE_SCALE.label.fontSize).toBe(13)
  })

  // 和文は字面が詰まって見えやすい。詰める方向には振らない。
  it('letterSpacing を負にしない', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      const tracking = 'letterSpacing' in style ? style.letterSpacing : 0
      expect(tracking, name).toBeGreaterThanOrEqual(0)
    }
  })

  it('本文の行間が 1.3 前後ある', () => {
    const ratio = TYPE_SCALE.body.lineHeight / TYPE_SCALE.body.fontSize
    expect(ratio).toBeGreaterThanOrEqual(1.25)
    expect(ratio).toBeLessThanOrEqual(1.5)
  })

  it('どの段も行間がフォントサイズを下回らない', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      expect(style.lineHeight, name).toBeGreaterThan(style.fontSize)
    }
  })

  // 主役が 1 つに見えること。語の表示だけは例外的に大きい。
  it('語の表示が見出しより大きい', () => {
    expect(heroFontSize('ねこ')).toBeGreaterThan(TYPE_SCALE.largeTitle.fontSize)
  })

  it('長い語は縮むが、ラベルより小さくはならない', () => {
    const long = heroFontSize('あいうえおかきくけこさしすせそ')
    expect(long).toBeLessThan(heroFontSize('ねこ'))
    expect(long).toBeGreaterThan(TYPE_SCALE.label.fontSize)
  })
})

describe('余白', () => {
  it('画面の左右余白が 16〜20pt に収まっている', () => {
    expect(layout.screenPaddingHorizontal).toBeGreaterThanOrEqual(16)
    expect(layout.screenPaddingHorizontal).toBeLessThanOrEqual(20)
  })

  it('セクション間が 24〜32pt', () => {
    expect(layout.sectionGap).toBeGreaterThanOrEqual(24)
    expect(layout.sectionGap).toBeLessThanOrEqual(32)
  })

  // 関連する要素同士は近く、違う塊は遠く。
  it('カードの中の間隔はセクション間より狭い', () => {
    expect(layout.cardGap).toBeLessThan(layout.sectionGap)
  })

  it('ボタンと入力欄が最小タップ領域を下回らない', () => {
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(MIN_TAP_SIZE)
    expect(layout.inputHeight).toBeGreaterThanOrEqual(MIN_TAP_SIZE)
  })
})

describe('セーフエリア', () => {
  // 画面ごとに足し方が違うと、タブを切り替えたときに見出しの位置が跳ねる。
  it('セーフエリアに一定の余白を足す', () => {
    const padding = screenInsets({ top: 59, bottom: 34 })
    expect(padding.paddingTop).toBe(59 + spacing.lg)
    expect(padding.paddingBottom).toBe(34 + spacing.xxxl)
  })

  it('セーフエリアが 0 でも余白は残る', () => {
    const padding = screenInsets({ top: 0, bottom: 0 })
    expect(padding.paddingTop).toBeGreaterThan(0)
    expect(padding.paddingBottom).toBeGreaterThan(0)
  })
})
