/**
 * ボタンの「どの色をどこに置くか」だけを決める層。
 *
 * **描画からは切り離してある。** 会場は屋外光が入って明るく、ガラスの上の薄い文字は
 * 読めなくなるので、配色はテストでコントラストを固定できるところに置いておきたい
 * （`tests/button.test.ts`）。react-native には依存しない。
 */

import type { TierPalette } from '../theme/tiers'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost'] as const satisfies readonly [
  ButtonVariant,
  ...ButtonVariant[],
]

export type ButtonSurface = {
  /** ガラスの着色（`GlassView` の tintColor / フォールバックの地）。null なら無着色。 */
  fill: string | null
  /** 文字とアイコンの色。 */
  label: string
  /**
   * 文字が載る実際の地。**コントラストはここに対して測る。**
   * ガラスは半透明なので、透ける variant では tier の地がその値になる。
   */
  contrastAgainst: string
  /** ガラスを敷くか。ghost は敷かない（iOS の plain ボタン）。 */
  usesGlass: boolean
}

/**
 * variant と tier からボタンの面を決める。
 *
 * - `primary`: ガラスの上に tier の accent を乗せる。**ここだけ色が付く**ので、
 *   1 画面に 1 つしか置かない（主役を 1 つにする）
 * - `secondary`: 素のガラス（tier の glassTint）。文字は tier の地に対して読ませる
 * - `ghost`: ガラスを敷かず、色の付いた文字だけ。iOS の plain ボタン
 */
export function buttonSurface(variant: ButtonVariant, colors: TierPalette): ButtonSurface {
  if (variant === 'primary') {
    return {
      fill: colors.accent,
      label: colors.onAccent,
      contrastAgainst: colors.accent,
      usesGlass: true,
    }
  }
  if (variant === 'secondary') {
    return {
      fill: colors.glassTint,
      label: colors.text,
      contrastAgainst: colors.bg,
      usesGlass: true,
    }
  }
  return {
    fill: null,
    label: colors.accent,
    contrastAgainst: colors.bg,
    usesGlass: false,
  }
}
