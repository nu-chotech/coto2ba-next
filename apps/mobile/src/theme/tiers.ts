/**
 * 演出帯（tier）ごとのパレット。
 *
 * ゴールに近づくほど画面が「温まる」：白黒 → 淡い暖色 → 宇宙 → 黄金。
 * tier 遷移は **再マウントせずにパラメータ補間**する（SPEC §8.5）ので、
 * 色は文字列だけでなく数値配列・ランプ配列でも取り出せるようにしてある。
 *
 * - Reanimated: `interpolateColor(progress, TIER_INPUT_RANGE, tierColorRamp('bg'))`
 * - Skia:       `tierSkiaRamp('particle')` が 0〜1 の 4 成分配列を返す
 */

import { TIER_IDS, TIER_ORDER, type TierId } from '@coto2ba/contracts'
import { parseColor, type Rgba, type SkiaColor, toSkiaColor } from './color'

export type TierPalette = {
  /** 画面の地。全画面 Skia Canvas の背景。 */
  bg: string
  /** カード・チップの面（ガラスの下に敷く半透明）。 */
  surface: string
  /** 主文字色。 */
  text: string
  /** 補助文字色。 */
  sub: string
  /** 強調色（ランク、ボタン、下線）。 */
  accent: string
  /** GlassView の tintColor。null なら無着色（素のガラス）。 */
  glassTint: string | null
  /** 粒子の色。 */
  particle: string
}

/**
 * tier パレットの確定値。**この値を勝手に変えない。**
 */
export const tierPalettes = {
  mono: {
    bg: '#0B0B10',
    surface: 'rgba(255,255,255,0.06)',
    text: '#E8E8EC',
    sub: '#8A8A96',
    accent: '#B8B8C4',
    glassTint: null,
    particle: '#FFFFFF12',
  },
  color: {
    bg: '#141017',
    surface: 'rgba(255,230,200,0.07)',
    text: '#F2EAE2',
    sub: '#A08F80',
    accent: '#E8B98A',
    glassTint: '#E8B98A22',
    particle: '#E8B98A20',
  },
  cosmos: {
    bg: '#080A1C',
    surface: 'rgba(150,160,255,0.08)',
    text: '#E6E9FF',
    sub: '#7C85C4',
    accent: '#8B93FF',
    glassTint: '#6B76FF2A',
    particle: '#AEB6FF',
  },
  gold: {
    bg: '#14100A',
    surface: 'rgba(245,197,66,0.09)',
    text: '#FFF6E0',
    sub: '#BFA469',
    accent: '#F5C542',
    glassTint: '#F5C5422E',
    particle: '#FFD770',
  },
} as const satisfies Record<TierId, TierPalette>

export type TierPaletteKey = keyof TierPalette

/** 補間の入力に使う tier の並び（遠い → 近い）。TIER_ORDER と一致させる。 */
export const TIER_SEQUENCE: readonly TierId[] = [...TIER_IDS].sort(
  (a, b) => TIER_ORDER[a] - TIER_ORDER[b],
)

/** interpolateColor の inputRange。TIER_SEQUENCE のインデックス。 */
export const TIER_INPUT_RANGE: readonly number[] = TIER_SEQUENCE.map((_, i) => i)

/** tier → 補間の位置（0 = mono 〜 TIER_SEQUENCE.length - 1 = gold）。 */
export function tierToProgress(tier: TierId): number {
  return TIER_ORDER[tier]
}

/** tier → 0〜1 に正規化した温度。背景の明るさなどに使う。 */
export function tierToUnit(tier: TierId): number {
  const last = TIER_SEQUENCE.length - 1
  return last <= 0 ? 0 : TIER_ORDER[tier] / last
}

export function paletteForTier(tier: TierId): TierPalette {
  return tierPalettes[tier]
}

/**
 * ある役割の色を TIER_SEQUENCE 順に並べた配列。
 * `interpolateColor(progress, TIER_INPUT_RANGE, tierColorRamp('bg'))` で使う。
 * glassTint は null を透明色に置き換える（補間で欠番を作らないため）。
 */
export function tierColorRamp(key: TierPaletteKey): string[] {
  return TIER_SEQUENCE.map((tier) => tierPalettes[tier][key] ?? 'rgba(0,0,0,0)')
}

/** 同じランプを数値（r,g,b は 0〜255、a は 0〜1）で。 */
export function tierRgbaRamp(key: TierPaletteKey): Rgba[] {
  return TIER_SEQUENCE.map((tier) => parseColor(tierPalettes[tier][key]))
}

/** 同じランプを Skia の 0〜1 の 4 成分で。 */
export function tierSkiaRamp(key: TierPaletteKey): SkiaColor[] {
  return TIER_SEQUENCE.map((tier) => toSkiaColor(tierPalettes[tier][key]))
}

/** 単一 tier の色を数値で。 */
export function tierRgba(tier: TierId, key: TierPaletteKey): Rgba {
  return parseColor(tierPalettes[tier][key])
}

export function tierSkiaColor(tier: TierId, key: TierPaletteKey): SkiaColor {
  return toSkiaColor(tierPalettes[tier][key])
}

/**
 * 全役割をまとめた数値表。Skia の描画ループで毎フレーム parse しないための事前計算。
 */
export const tierRgbaTable: Record<TierId, Record<TierPaletteKey, Rgba>> = Object.fromEntries(
  TIER_SEQUENCE.map((tier) => [
    tier,
    Object.fromEntries(
      (Object.keys(tierPalettes[tier]) as TierPaletteKey[]).map((key) => [
        key,
        parseColor(tierPalettes[tier][key]),
      ]),
    ) as Record<TierPaletteKey, Rgba>,
  ]),
) as Record<TierId, Record<TierPaletteKey, Rgba>>
