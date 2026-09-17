/**
 * スキーム（ライト / ダーク）ごとの役割色。
 *
 * **画面には生の色リテラルを残さない。** 画面は「役割の名前」だけを参照し、
 * どのスキームの値を取るかは `useTheme()`（`theme/scheme.tsx`）が決める。
 *
 * ## ダーク — 宇宙の底
 * 既に実機で評価されている見た目なので、**値をそのまま持ってきている**。動かさない。
 *
 * ## ライト — 紙とインク
 * 単純な反転はしない。ダークが「暗い宇宙にひかりが灯る」なら、
 * ライトは **「紙の上にインクが載る」**。地は純白にせず僅かに暖色を含んだ白、
 * 文字は純黒にしない（和文の細い字画が潰れて汚くなる）。
 * tier の温度の物語は「紙の色みとインクの色み」で語る（詳細は `tiers.ts`）。
 *
 * ここは **react-native に依存しない**（テストから素直に読めるように）。
 */

export type Scheme = 'light' | 'dark'

/** 「色を塗らない」。スキームに依存しないのでパレットの外に置く。 */
export const TRANSPARENT = 'transparent'

export const SCHEMES = ['light', 'dark'] as const satisfies readonly Scheme[]

export type Palette = {
  /** 画面の地。tier を持たない場所（起動時・スプラッシュ）の地でもある。 */
  base: string
  /** カード・チップの面（ガラスの下に敷く半透明）。 */
  surface: string
  /** 主文字色。 */
  text: string
  /** 補助文字色。 */
  sub: string
  /** 区切り線・枠。 */
  border: string
  /** 強調色。 */
  accent: string
  /** accent の上に載る文字。 */
  onAccent: string
  /** 押下時の被膜。 */
  pressed: string
  /** ガラスの着色。null なら無着色（素のガラス）。 */
  glassTint: string | null

  /** モーダルの覆い。 */
  scrim: string
  /** 状態色。tier をまたいで意味が変わらないものだけ。 */
  positive: string
  negative: string
  warning: string
  /** 温度バー（rank → heat）の両端。 */
  heatCold: string
  heatHot: string

  /** ガラスの縁のハイライト。 */
  glassEdge: string
  /** ガラスのフォールバック（expo-blur）に重ねる地の色。 */
  glassFallbackFill: string
  /** `BlurView` の tint。 */
  blurTint: 'light' | 'dark'
  /** `expo-status-bar` の style。地が暗いなら文字は白。 */
  statusBar: 'light' | 'dark'
}

export const PALETTES = {
  dark: {
    base: '#0B0B10',
    surface: 'rgba(255, 255, 255, 0.06)',
    text: '#E8E8EC',
    sub: '#8A8A96',
    border: 'rgba(255, 255, 255, 0.08)',
    accent: '#B8B8C4',
    onAccent: '#0B0B10',
    pressed: 'rgba(255, 255, 255, 0.10)',
    glassTint: null,

    scrim: 'rgba(0, 0, 0, 0.55)',
    positive: '#7BE3A3',
    negative: '#FF7D7D',
    warning: '#F5C542',
    heatCold: '#5C6480',
    heatHot: '#F5C542',

    glassEdge: 'rgba(255, 255, 255, 0.14)',
    glassFallbackFill: 'rgba(255, 255, 255, 0.06)',
    blurTint: 'dark',
    statusBar: 'light',
  },
  light: {
    /** 純白にしない。僅かに暖色を含んだ紙の白。 */
    base: '#F5F4F1',
    surface: 'rgba(24, 22, 18, 0.05)',
    /** 純黒にしない（和文の細い字画が潰れる）。 */
    text: '#1A1A1E',
    sub: '#5C5C66',
    border: 'rgba(24, 22, 18, 0.12)',
    /** 黒鉛。ライトの primary ボタンは紙の上の黒いカプセルになる。 */
    accent: '#2B2B33',
    onAccent: '#F7F6F3',
    pressed: 'rgba(24, 22, 18, 0.07)',
    glassTint: null,

    scrim: 'rgba(20, 18, 16, 0.32)',
    positive: '#1B7F4B',
    negative: '#C0392F',
    warning: '#8A6000',
    heatCold: '#8A90A6',
    heatHot: '#B07C0C',

    /** 明るい地の上のガラスは、縁が白く光る。 */
    glassEdge: 'rgba(255, 255, 255, 0.55)',
    glassFallbackFill: 'rgba(255, 255, 255, 0.45)',
    blurTint: 'light',
    statusBar: 'dark',
  },
} as const satisfies Record<Scheme, Palette>

export function paletteFor(scheme: Scheme): Palette {
  return PALETTES[scheme]
}

/**
 * `useColorScheme()` は端末が決めかねているあいだ `null` を返す。
 * 起動直後に一瞬だけ白く光るのを避けたいので、**分からないうちはダーク**にする。
 */
export function normalizeScheme(scheme: string | null | undefined): Scheme {
  return scheme === 'light' ? 'light' : 'dark'
}

/**
 * サブツリーに固定されたスキームがあればそれを、無ければ端末のものを使う。
 *
 * `ThemeProvider` の中身そのもの。**react-native を要らない形でここに置く**ので、
 * 「端末がライトでも図鑑はダーク」をテストから同じ関数で確かめられる
 * （画面と違う経路で測ると、通っているのに現地で読めない、という嘘のテストになる）。
 */
export function resolveScheme(fixed: Scheme | undefined, system: Scheme): Scheme {
  return fixed ?? system
}
