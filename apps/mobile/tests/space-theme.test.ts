/// <reference types="node" />
/**
 * 図鑑（宇宙）の色のテスト。
 *
 * 図鑑は**端末がライトでも暗いまま**にする意図的な例外。その例外を部品ごとに
 * 実装していたせいで、**暗い地の上にライトのガラス（紙色の面）が出て、
 * その上の補助文字が読めなくなっていた**（ライト端末で図鑑を開いた来場者が踏む）。
 *
 * 直し方は「境界を 1 箇所に置く」：`app/(tabs)/space/_layout.tsx` が
 * サブツリーごと `ThemeProvider` でダークに固定し、中の部品は `useTheme()` を
 * 素直に読む。ここでは **その境界（端末がライトでもダークのパレットになること）** と、
 * **実際に描画で使われる地に対するコントラスト**を固定する。
 *
 * **地は「実際に描画で使われるもの」で測る。** 面（`surface` / `glassTint`）も
 * 覆い（`scrim`）も半透明なので、重ねる前の値で測ると通っているのに現地で読めない、
 * という嘘のテストになる（`tabs.test.ts` で実際にそうなっていた）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buttonSurface } from '../src/components/buttonStyle'
import { compositeOver, contrastRatio } from '../src/theme/color'
import { PALETTES, resolveScheme, SCHEMES, type Scheme } from '../src/theme/palettes'
import { SPACE_SCHEME, SPACE_TIER } from '../src/theme/space'
import { TIER_PALETTES, tierPalettes } from '../src/theme/tiers'

/** WCAG AA。本文 4.5、補足（補助文字）3。 */
const READABLE = 4.5
const READABLE_SUB = 3

const APP_DIR = join(__dirname, '../src/app')

/** 端末のスキームが `device` のとき、図鑑のサブツリーが受け取るもの。 */
function spaceTheme(device: Scheme) {
  const scheme = resolveScheme(SPACE_SCHEME, device)
  return { scheme, palette: PALETTES[scheme], colors: TIER_PALETTES[scheme][SPACE_TIER] }
}

/**
 * 図鑑で**文字が実際に載る地**。名前は描いている場所に対応させる。
 *
 * - `screen` 全画面 Canvas の地（`(tabs)/space/index.tsx` の `styles.root`）。
 *   ラベル（`SpaceLabels`）と下の一言はここに直接載る
 * - `chip`   軌跡のチップ・検索ボタン・「視点をもどす」（`colors.surface` を地に重ねた面）
 * - `card`   `GlassCard`（`glassTint` を敷く。ぼかしの下に見えるのは同じ地）
 * - `sheet`  ボトムシート（覆い `scrim` の上にガラス）
 * - `row`    シートの中の行（近い語・検索の入力欄）。ガラスの上にさらに `surface`
 */
function spaceGrounds(device: Scheme) {
  const { palette, colors } = spaceTheme(device)
  const screen = colors.bg
  const sheet = compositeOver(
    colors.glassTint ?? palette.glassFallbackFill,
    compositeOver(palette.scrim, screen),
  )
  return {
    screen,
    chip: compositeOver(colors.surface, screen),
    card: compositeOver(colors.glassTint ?? palette.glassFallbackFill, screen),
    sheet,
    row: compositeOver(colors.surface, sheet),
  }
}

describe('図鑑のスキームの境界', () => {
  it('端末がライトでも、図鑑のサブツリーはダークになる', () => {
    for (const device of SCHEMES) {
      expect(resolveScheme(SPACE_SCHEME, device), device).toBe('dark')
    }
  })

  it('端末がライトでも、図鑑のパレットはダーク側の値になる', () => {
    for (const device of SCHEMES) {
      const theme = spaceTheme(device)
      expect(theme.palette, device).toBe(PALETTES.dark)
      // ガラスの見た目（ぼかしの tint・縁・フォールバックの地）もダーク側。
      // ここがライトだと、暗い図鑑の上に紙色の面が出る（これが壊れていた正体）。
      expect(theme.palette.blurTint, device).toBe('dark')
    }
  })

  // SkiaGate はダーク固定のシムを読んでいた。Provider に寄せても値が変わらないこと。
  it('図鑑の tier パレットは、ダーク固定のシムと同じものを指す', () => {
    for (const device of SCHEMES) {
      expect(spaceTheme(device).colors, device).toBe(tierPalettes.cosmos)
    }
  })

  // 境界はここ 1 箇所。消えると、中の部品が静かに端末のスキームに追従し始める。
  it('図鑑タブが ThemeProvider でサブツリーごと固定している', () => {
    const source = readFileSync(join(APP_DIR, '(tabs)/space/_layout.tsx'), 'utf8')
    expect(source).toContain('ThemeProvider')
    expect(source).toContain('scheme={SPACE_SCHEME}')
  })

  // 境界を間違えると全画面が暗くなる。根の Provider はスキームを固定しない。
  it('根の ThemeProvider はスキームを固定しない（図鑑以外は端末に追従する）', () => {
    const source = readFileSync(join(APP_DIR, '_layout.tsx'), 'utf8')
    expect(source).toContain('<ThemeProvider>')
  })
})

describe('図鑑のコントラスト', () => {
  // 端末のスキームが何であれ図鑑はダークなので、両方で同じ値になるはず。
  // 「両スキームで測る」ことに意味があるのは、そこが崩れたら落ちるから。
  const each = (run: (device: Scheme) => void) => {
    for (const device of SCHEMES) run(device)
  }

  it('本文が、実際に文字が載る地の上で 4.5 以上ある', () => {
    each((device) => {
      const { colors } = spaceTheme(device)
      for (const [where, ground] of Object.entries(spaceGrounds(device))) {
        expect(contrastRatio(colors.text, ground), `${device}/${where}`).toBeGreaterThanOrEqual(
          READABLE,
        )
      }
    })
  })

  it('補助文字が、実際に文字が載る地の上で 3 以上ある', () => {
    each((device) => {
      const { colors } = spaceTheme(device)
      for (const [where, ground] of Object.entries(spaceGrounds(device))) {
        expect(contrastRatio(colors.sub, ground), `${device}/${where}`).toBeGreaterThanOrEqual(
          READABLE_SUB,
        )
      }
    })
  })

  // 「この挑戦の軌跡は図鑑にありません」は accent の文字だけで地に載る。
  it('注意書き（accent の文字）が地の上で読める', () => {
    each((device) => {
      const { colors } = spaceTheme(device)
      expect(contrastRatio(colors.accent, colors.bg), device).toBeGreaterThanOrEqual(READABLE)
    })
  })

  // 選択中のチップは accent を地にして onAccent の文字が載る。
  it('選択中のチップの文字が読める', () => {
    each((device) => {
      const { colors } = spaceTheme(device)
      expect(contrastRatio(colors.onAccent, colors.accent), device).toBeGreaterThanOrEqual(READABLE)
    })
  })

  // シートの「閉じる」は secondary（素のガラス）。文字はシートの地の上に載る。
  it('シートのボタンの文字が、シートの地の上で読める', () => {
    each((device) => {
      const { colors } = spaceTheme(device)
      const surface = buttonSurface('secondary', colors)
      expect(
        contrastRatio(surface.label, spaceGrounds(device).sheet),
        device,
      ).toBeGreaterThanOrEqual(READABLE)
    })
  })

  /**
   * 壊れていたときの値。**ライトのガラスを図鑑の暗い地に敷くと読めない。**
   * 境界を外した誰かが「部品ごとに直す」に戻ったときに、ここが理由を語る。
   */
  it('ライトのガラスを図鑑の地に敷くと読めない（だから境界が要る）', () => {
    const colors = tierPalettes.cosmos
    const ground = compositeOver(PALETTES.light.glassFallbackFill, colors.bg)
    expect(contrastRatio(colors.text, ground)).toBeLessThan(READABLE)
    expect(contrastRatio(colors.sub, ground)).toBeLessThan(READABLE_SUB)
  })
})
