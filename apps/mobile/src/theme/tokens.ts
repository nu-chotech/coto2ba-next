/**
 * デザイントークン。
 *
 * 方向性（SPEC §8.5）：暗い宇宙の底のような地。和文タイポグラフィが主役。
 * 装飾は少なく、余白と字面で見せる。角丸は大きめ。
 * ここに無い色・寸法をコンポーネント側に直書きしないこと。
 */

import type { TextStyle } from 'react-native'
import { Platform } from 'react-native'
import { tierPalettes } from './tiers'

// ── 余白 ────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const
export type SpacingToken = keyof typeof spacing

// ── 角丸 ────────────────────────────────────────────────────
export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const
export type RadiusToken = keyof typeof radius

// ── モーション ──────────────────────────────────────────────
export const duration = {
  fast: 160,
  base: 260,
  slow: 420,
} as const
export type DurationToken = keyof typeof duration

/** Reanimated の withSpring に渡す基調。強い跳ねは作らない。 */
export const spring = {
  gentle: { damping: 18, stiffness: 140, mass: 1 },
  snappy: { damping: 14, stiffness: 220, mass: 0.9 },
} as const

// ── 線・影 ──────────────────────────────────────────────────
export const hairline = 1
export const borderWidth = {
  hairline,
  thick: 2,
} as const

/** ガラスの縁。tier に依存しない中立の白。 */
export const glassEdge = 'rgba(255, 255, 255, 0.14)'
/** ガラスのフォールバック（expo-blur）に重ねる地の色。 */
export const glassFallbackFill = 'rgba(255, 255, 255, 0.06)'
export const blurIntensity = {
  card: 28,
  sheet: 44,
} as const

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
 * tier に依存しない固定色 + tier パレット。
 * 画面の地・文字・アクセントは基本的に tier から取る（`tierPalettes`）。
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

// ── レイアウト ──────────────────────────────────────────────
export const layout = {
  /** 画面の左右パディング。 */
  screenPaddingHorizontal: spacing.xl,
  /** カードの内側パディング。 */
  cardPadding: spacing.lg,
  /** 主要ボタンの高さ。 */
  buttonHeight: 56,
  /** 入力欄の高さ。 */
  inputHeight: 52,
  /** ratio スライダーのトラック高さ。 */
  sliderTrackHeight: 6,
  sliderThumbSize: 28,
  /** 全画面 Skia 粒子の最大数。 */
  particleCount: 120,
} as const

export const opacity = {
  disabled: 0.35,
  muted: 0.6,
  full: 1,
} as const

// ── アイコン ────────────────────────────────────────────────
/**
 * SF Symbols の大きさ。**隣に置く文字の光学サイズに合わせる**のが Apple の作法なので、
 * typography のフォントサイズと対になっている。
 */
export const iconSize = {
  /** label（13pt）と並べる。 */
  sm: 15,
  /** body（17pt）と並べる。 */
  md: 20,
  /** 単独で押せるアイコン。 */
  lg: 24,
  /** subtitle（20pt）以上の見出しと並べる。 */
  xl: 28,
} as const
export type IconSizeToken = keyof typeof iconSize

/** アイコンの既定値。`SymbolIcon` が何も指定されなかったときに使う。 */
export const ICON_DEFAULT_SIZE = iconSize.lg
export const ICON_DEFAULT_WEIGHT = 'regular'
/** 台帳に無い名前が来たときに描く点の直径（アイコン寸法に対する比）。 */
export const ICON_UNKNOWN_DOT_RATIO = 0.34
