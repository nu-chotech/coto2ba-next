/**
 * デザイントークン。
 *
 * 方向性（SPEC §8.5）：暗い宇宙の底のような地。和文タイポグラフィが主役。
 * 装飾は少なく、余白と字面で見せる。角丸は大きめ。
 * ここに無い色・寸法をコンポーネント側に直書きしないこと。
 */

import type { TextStyle } from 'react-native'
import { Platform } from 'react-native'
import { PALETTES } from './palettes'
import { tierPalettes } from './tiers'

/**
 * ガラスの縁と、フォールバックに重ねる地。**ダーク固定の互換シム。**
 * スキームに追従する値は `PALETTES[scheme].glassEdge` / `.glassFallbackFill`。
 */
export const glassEdge = PALETTES.dark.glassEdge
export const glassFallbackFill = PALETTES.dark.glassFallbackFill

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

export const typography = {
  /** 現在の語。画面の主役。 */
  hero: {
    fontSize: 54,
    lineHeight: 64,
    fontWeight: '700',
    letterSpacing: -1,
  },
  /** ゴール語、画面見出し。 */
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  /** 小見出し・ランク数値。 */
  subtitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  /** 本文・説明文。 */
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  /** 補助テキスト。 */
  caption: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  /** ラベル・チップ。 */
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  /** 手数・ランクなど桁が動く数値。等幅で揺れを止める。 */
  mono: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    fontFamily: fontFamily.mono,
    fontVariant: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']>,
  },
} as const satisfies Record<string, TextStyle>
export type TypographyToken = keyof typeof typography

/** 現在の語は字数で縮める（48〜56pt の帯に収める）。 */
export const HERO_FONT_SIZE_MAX = 56
export const HERO_FONT_SIZE_MIN = 28
export const HERO_COMFORTABLE_LENGTH = 5

export function heroFontSize(word: string): number {
  const length = [...word].length
  if (length <= HERO_COMFORTABLE_LENGTH) return HERO_FONT_SIZE_MAX
  const shrunk = Math.round((HERO_FONT_SIZE_MAX * HERO_COMFORTABLE_LENGTH) / length)
  return Math.max(HERO_FONT_SIZE_MIN, Math.min(HERO_FONT_SIZE_MAX, shrunk))
}

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
