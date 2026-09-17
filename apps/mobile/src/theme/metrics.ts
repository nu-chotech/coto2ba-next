/**
 * 寸法のトークン（余白・角丸・時間・レイアウト）。
 *
 * **ここは react-native に依存しない。** 色と同じく、テストから素直に読めるようにするため
 * （`theme/tokens.ts` は `Platform` を使うので vitest からは読めない）。
 * 画面からは `theme` の index 経由で今までどおり取れる。
 *
 * マジックナンバーをコンポーネントに直書きしないこと。
 */

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

// ── 線 ──────────────────────────────────────────────────────
export const hairline = 1
export const borderWidth = {
  hairline,
  thick: 2,
} as const

export const blurIntensity = {
  card: 28,
  sheet: 44,
} as const

// ── レイアウト ──────────────────────────────────────────────
export const layout = {
  /** 画面の左右パディング。iOS のリスト・フォームの内寄せに合わせる。 */
  screenPaddingHorizontal: spacing.lg + spacing.xs,
  /**
   * セクション（カード）どうしの間隔。
   * **関連する要素同士は近く、違う塊は遠く。** その「遠く」のほう。
   */
  sectionGap: spacing.xl,
  /** カードの中の、関連する要素どうしの間隔。「近く」のほう。 */
  cardGap: spacing.md,
  /** カードの内側パディング。 */
  cardPadding: spacing.lg,
  /** 主要ボタンの高さ。Apple の「大きい」コントロール相当。 */
  buttonHeight: 50,
  /** 入力欄の高さ。最小タップ領域（44pt）を下回らない。 */
  inputHeight: 48,
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
