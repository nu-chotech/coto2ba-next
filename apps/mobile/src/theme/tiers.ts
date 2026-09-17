/**
 * 演出帯（tier）ごとのパレット。
 *
 * ゴールに近づくほど画面が「温まる」：白黒 → 淡い暖色 → 宇宙 → 黄金。
 * tier 遷移は **再マウントせずにパラメータ補間**する（SPEC §8.5）ので、
 * 色は文字列だけでなく数値配列・ランプ配列でも取り出せるようにしてある。
 *
 * - Reanimated: `interpolateColor(progress, TIER_INPUT_RANGE, tierColorRamp('bg'))`
 * - Skia:       `tierSkiaRamp('particle')` が 0〜1 の 4 成分配列を返す
 *
 * ライトとダークで別の値を持つ（`TIER_PALETTES`）。**単純な反転はしない。**
 * ダークは「暗い宇宙にひかりが灯る」、ライトは「紙の上にインクが載る」。
 * ランプ系の関数はスキームを取り、既定はダーク（既存の呼び出しを壊さないため）。
 */

import { TIER_IDS, TIER_ORDER, type TierId } from '@coto2ba/contracts'
import { parseColor, type Rgba, type SkiaColor, toSkiaColor } from './color'
import type { Scheme } from './palettes'

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
  /** accent の上に載る文字（primary ボタンのラベル）。地に沈む色を選ぶ。 */
  onAccent: string
  /** GlassView の tintColor。null なら無着色（素のガラス）。 */
  glassTint: string | null
  /** 粒子の色。 */
  particle: string
}

/**
 * tier パレットの確定値。
 *
 * ## ダーク — 暗い宇宙にひかりが灯る
 * **この値を勝手に変えない。** 実機で評価されている見た目そのもの。
 *
 * ## ライト — 紙とインク
 * 温度の物語（mono → 暖色 → 宇宙 → 黄金）を「紙の色みとインクの色み」で語る。
 *
 * - `mono`   ふつうの紙に黒鉛。いちばん静か
 * - `color`  紙が温まって赤みが差し、インクが焦げ茶（ダークの淡い琥珀を濃くした同系色）
 * - `cosmos` 青みの紙に群青のインク。**面（カードの地）は 4 つの中でいちばん深い** ——
 *            仕様の「宇宙をライトでも暗い面として残しつつ周囲を明るくする」はここ。
 *            地まで暗くすると、ライトを選んだ人の画面がゲーム中に突然夜になってしまう。
 *            本当に暗い宇宙は図鑑タブが持つ（そちらはライトでも暗いまま）
 * - `gold`   生成りの紙に古金。箔の質感を濃い金茶で出す
 */
export const TIER_PALETTES = {
  dark: {
    mono: {
      bg: '#0B0B10',
      surface: 'rgba(255,255,255,0.06)',
      text: '#E8E8EC',
      sub: '#8A8A96',
      accent: '#B8B8C4',
      onAccent: '#0B0B10',
      glassTint: null,
      particle: '#FFFFFF12',
    },
    color: {
      bg: '#141017',
      surface: 'rgba(255,230,200,0.07)',
      text: '#F2EAE2',
      sub: '#A08F80',
      accent: '#E8B98A',
      onAccent: '#141017',
      glassTint: '#E8B98A22',
      particle: '#E8B98A20',
    },
    cosmos: {
      bg: '#080A1C',
      surface: 'rgba(150,160,255,0.08)',
      text: '#E6E9FF',
      sub: '#7C85C4',
      accent: '#8B93FF',
      onAccent: '#080A1C',
      glassTint: '#6B76FF2A',
      particle: '#AEB6FF',
    },
    gold: {
      bg: '#14100A',
      surface: 'rgba(245,197,66,0.09)',
      text: '#FFF6E0',
      sub: '#BFA469',
      accent: '#F5C542',
      onAccent: '#14100A',
      glassTint: '#F5C5422E',
      particle: '#FFD770',
    },
  },
  light: {
    mono: {
      bg: '#F5F4F1',
      surface: 'rgba(24,22,18,0.05)',
      text: '#1A1A1E',
      sub: '#5C5C66',
      accent: '#2B2B33',
      onAccent: '#F7F6F3',
      glassTint: null,
      particle: 'rgba(26,26,30,0.10)',
    },
    color: {
      bg: '#FAF1E6',
      surface: 'rgba(140,74,20,0.07)',
      text: '#2A1C11',
      sub: '#7A5836',
      accent: '#A8551B',
      onAccent: '#FFF6EC',
      glassTint: '#C9762E1F',
      particle: 'rgba(168,85,27,0.16)',
    },
    cosmos: {
      bg: '#EDEFF8',
      // 4 つの中でいちばん深い面。ライトでも「宇宙は暗い面」を残す。
      surface: 'rgba(22,27,61,0.14)',
      text: '#161B3D',
      sub: '#4A5288',
      accent: '#3A43A8',
      onAccent: '#F2F4FF',
      glassTint: '#3A43A824',
      particle: 'rgba(58,67,168,0.22)',
    },
    gold: {
      bg: '#FBF4E2',
      surface: 'rgba(150,108,10,0.10)',
      text: '#2C2208',
      sub: '#7A6320',
      accent: '#8A6410',
      onAccent: '#FFFBF0',
      glassTint: '#B78A1A26',
      particle: 'rgba(138,100,16,0.20)',
    },
  },
} as const satisfies Record<Scheme, Record<TierId, TierPalette>>

/**
 * ダークの tier パレット。
 *
 * **互換シム。** 触ってはいけないタブバー（`(tabs)/_layout.tsx`）や、
 * 地が常に暗い場所（図鑑・シェア画像）が参照する。
 * 新しいコードは `useTheme().paletteForTier(tier)` を使うこと。
 */
export const tierPalettes = TIER_PALETTES.dark

export function tierPaletteFor(scheme: Scheme, tier: TierId): TierPalette {
  return TIER_PALETTES[scheme][tier]
}

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

/**
 * ダーク固定の tier パレット。**互換シム。**
 * 地が常に暗い場所（図鑑・シェア画像）だけが使ってよい。
 * 画面は `useTheme().paletteForTier(tier)` を使うこと。
 */
export function paletteForTier(tier: TierId): TierPalette {
  return tierPalettes[tier]
}

/**
 * ある役割の色を TIER_SEQUENCE 順に並べた配列。
 * `interpolateColor(progress, TIER_INPUT_RANGE, tierColorRamp('bg'))` で使う。
 * glassTint は null を透明色に置き換える（補間で欠番を作らないため）。
 */
export function tierColorRamp(key: TierPaletteKey, scheme: Scheme = 'dark'): string[] {
  return TIER_SEQUENCE.map((tier) => TIER_PALETTES[scheme][tier][key] ?? 'rgba(0,0,0,0)')
}

/** 同じランプを数値（r,g,b は 0〜255、a は 0〜1）で。 */
export function tierRgbaRamp(key: TierPaletteKey, scheme: Scheme = 'dark'): Rgba[] {
  return TIER_SEQUENCE.map((tier) => parseColor(TIER_PALETTES[scheme][tier][key]))
}

/** 同じランプを Skia の 0〜1 の 4 成分で。 */
export function tierSkiaRamp(key: TierPaletteKey, scheme: Scheme = 'dark'): SkiaColor[] {
  return TIER_SEQUENCE.map((tier) => toSkiaColor(TIER_PALETTES[scheme][tier][key]))
}

/** 単一 tier の色を数値で。 */
export function tierRgba(tier: TierId, key: TierPaletteKey, scheme: Scheme = 'dark'): Rgba {
  return parseColor(TIER_PALETTES[scheme][tier][key])
}

export function tierSkiaColor(
  tier: TierId,
  key: TierPaletteKey,
  scheme: Scheme = 'dark',
): SkiaColor {
  return toSkiaColor(TIER_PALETTES[scheme][tier][key])
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
