/**
 * 文字の段（タイプスケール）と、画面のセーフエリアの足し方。
 *
 * iOS のシステム書体のメトリクスに合わせてある。Large Title 34 / 本文 17 /
 * 補足 15 / ラベル 13 という並びは、iOS 純正アプリと並べたときに
 * 「同じ言語で書かれている」と見えるための土台。
 *
 * **和文なので `letterSpacing` を負にしない。** 欧文の見出しは詰めると締まるが、
 * かなと漢字は詰めると字面が潰れて「安っぽい」印象になる。
 * 行間は本文で 1.3 前後、説明文はもう少し空ける。
 *
 * `fontFamily` は `Platform` が要るので `tokens.ts` 側で足す。
 * ここは **react-native に依存しない**（テストから読めるように）。
 */

import { spacing } from './metrics'

/** 文字の段。`tokens.ts` の `typography` がこれを元に組み立てる。 */
export const TYPE_SCALE = {
  /** 現在の語。画面の主役。ここだけ例外的に大きい。 */
  hero: {
    fontSize: 54,
    lineHeight: 64,
    fontWeight: '700',
    letterSpacing: 0,
  },
  /** 画面のタイトル。iOS の Large Title 相当。 */
  largeTitle: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: 0,
  },
  /** ゴール語、シートの見出し。 */
  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: 0,
  },
  /** 小見出し・ボタン・ランク数値。 */
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: 0,
  },
  /** 本文・行のタイトル。iOS の Body。 */
  body: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '400',
    letterSpacing: 0,
  },
  /** 説明文。iOS の Subheadline。複数行になるので行間を広めに取る。 */
  caption: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: 0,
  },
  /** ラベル・チップ。iOS の Footnote。小さいので僅かに空ける。 */
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
    letterSpacing: 0,
  },
} as const

export type TypeScaleToken = keyof typeof TYPE_SCALE

// ── 主役の語 ────────────────────────────────────────────────
/** 現在の語は字数で縮める。 */
export const HERO_FONT_SIZE_MAX = 56
export const HERO_FONT_SIZE_MIN = 28
export const HERO_COMFORTABLE_LENGTH = 5

export function heroFontSize(word: string): number {
  const length = [...word].length
  if (length <= HERO_COMFORTABLE_LENGTH) return HERO_FONT_SIZE_MAX
  const shrunk = Math.round((HERO_FONT_SIZE_MAX * HERO_COMFORTABLE_LENGTH) / length)
  return Math.max(HERO_FONT_SIZE_MIN, Math.min(HERO_FONT_SIZE_MAX, shrunk))
}

// ── セーフエリア ────────────────────────────────────────────
/**
 * 画面の中身とセーフエリアの間に必ず取る余白。
 * **全画面でこれを使う。** 画面ごとに足し方が違うと、タブを切り替えたときに
 * 見出しの位置が跳ねて、それだけで作りが粗く見える。
 */
export const SCREEN_PADDING_TOP = spacing.lg
/** 下はタブバーのガラスに文字が潜らないよう、上より大きく取る。 */
export const SCREEN_PADDING_BOTTOM = spacing.xxxl

export type ScreenEdgeInsets = { top: number; bottom: number }

export function screenInsets(insets: ScreenEdgeInsets): {
  paddingTop: number
  paddingBottom: number
} {
  return {
    paddingTop: insets.top + SCREEN_PADDING_TOP,
    paddingBottom: insets.bottom + SCREEN_PADDING_BOTTOM,
  }
}
