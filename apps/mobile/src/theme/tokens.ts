/**
 * デザイントークンの入り口。
 *
 * 中身は役割ごとに分かれている（どれも **react-native に依存しない**ので、
 * テストから素直に読める）:
 *
 * - `palettes.ts` 色（ライト / ダークの役割色）
 * - `tiers.ts`    演出帯ごとの色
 * - `metrics.ts`  余白・角丸・時間・レイアウト
 * - `type.ts`     文字の段・セーフエリアの足し方
 * - `scheme.tsx`  `ThemeProvider` / `useTheme()`
 *
 * このファイルには `Platform` が要るもの（フォント）だけが残っている。
 *
 * 方向性（SPEC §8.5 / §4）: **静かな土台 + 演出で爆発。** レイアウト・ナビ・部品は
 * iOS 純正に徹して静かにし、「混ぜた瞬間」と「クリア」だけ派手にする。
 * 和文タイポグラフィが主役。装飾は少なく、余白と字面で見せる。
 *
 * **ここに無い色・寸法をコンポーネント側に直書きしないこと。**
 */

import type { TextStyle } from 'react-native'
import { Platform } from 'react-native'
import { tierPalettes } from './tiers'
import {
  SCREEN_PADDING_TOP,
  type ScreenEdgeInsets,
  screenInsets,
  TYPE_SCALE,
  WEB_SCREEN_PADDING_TOP,
} from './type'

/** 文字の段とセーフエリアの足し方は `type.ts`。ここからも取れる。 */
export * from './type'

// ── セーフエリア ────────────────────────────────────────────
/**
 * 画面の中身を始める高さ。
 *
 * ネイティブはタブバーが **下** なので、上はひと呼吸だけでよい。
 * Web は `NativeTabs` が画面の **上** に浮くバーになるので、その下端ぶんを空ける。
 */
export const SCREEN_TOP_PADDING =
  Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : SCREEN_PADDING_TOP

/**
 * 画面のセーフエリア余白。**全画面でこれを使う。**
 * 画面ごとに足し方が違うと、タブを切り替えたときに見出しの位置が跳ねる。
 */
export function screenPadding(insets: ScreenEdgeInsets): {
  paddingTop: number
  paddingBottom: number
} {
  return screenInsets(insets, SCREEN_TOP_PADDING)
}

// ── タイポグラフィ ──────────────────────────────────────────
/**
 * システムフォント（iOS は SF Pro + ヒラギノ、Android は Roboto + Noto Sans JP）。
 * 和文はシステムに任せるのがいちばん綺麗に出る。図鑑の Skia ラベルだけは別途
 * Noto Sans JP を登録する（ARCHITECTURE §5）。
 */
export const fontFamily = {
  system: Platform.select({ ios: undefined, default: undefined }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const

/**
 * 画面が使う文字のスタイル。段（寸法）は `type.ts`、ここでは
 * `Platform` が要るもの（等幅フォント・数字の字形）だけを足す。
 */
export const typography = {
  ...TYPE_SCALE,
  mono: {
    ...TYPE_SCALE.mono,
    fontFamily: fontFamily.mono,
    fontVariant: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']>,
  },
} as const satisfies Record<string, TextStyle>
export type TypographyToken = keyof typeof typography

// ── 色 ──────────────────────────────────────────────────────
/**
 * ダーク固定の色。**互換シム。**
 *
 * 触ってはいけないガラスのタブバー（`(tabs)/_layout.tsx`）と、
 * 地が常に暗い場所（図鑑・シェア画像）がここを読む。
 * **画面の新しいコードはこれを使わず、`useTheme().palette` を使うこと。**
 */
export const palette = {
  /** 起動時・tier 未確定のときの地。splash の backgroundColor と一致させること。 */
  base: '#0B0B10',
  /** 最前面の純白（ほとんど使わない）。 */
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  /** 状態色。tier をまたいで意味が変わらないものだけ。 */
  positive: '#7BE3A3',
  negative: '#FF7D7D',
  warning: '#F5C542',

  /** 温度バー（rank → heat）の両端。 */
  heatCold: '#5C6480',
  heatHot: '#F5C542',

  /** 区切り線・押下時の被膜。 */
  divider: 'rgba(255, 255, 255, 0.08)',
  pressed: 'rgba(255, 255, 255, 0.10)',
  scrim: 'rgba(0, 0, 0, 0.55)',

  /** tier パレット（詳細は theme/tiers.ts）。 */
  tiers: tierPalettes,
} as const
