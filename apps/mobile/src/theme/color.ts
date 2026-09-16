/**
 * 色文字列 ↔ 数値の変換。
 * tier 遷移を再マウントせずに補間するため、パレットの色を
 * Reanimated / Skia に渡せる数値表現でも取り出せるようにする。
 */

/** r, g, b は 0〜255、a は 0〜1。 */
export type Rgba = readonly [number, number, number, number]

/** Skia の色（0〜1 の 4 成分）。`Skia.Color()` を通さずそのまま使える。 */
export type SkiaColor = readonly [number, number, number, number]

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i
const RGBA_PATTERN = /^rgba?\(([^)]+)\)$/i

const HEX_RADIX = 16
const BYTE_MAX = 255
const HEX_SHORT_RGB = 3
const HEX_SHORT_RGBA = 4
const HEX_RGB = 6
const HEX_RGBA = 8

const TRANSPARENT: Rgba = [0, 0, 0, 0]

function expandShortHex(hex: string): string {
  let out = ''
  for (const ch of hex) out += ch + ch
  return out
}

/** `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` / `rgb()` / `rgba()` を Rgba に。 */
export function parseColor(input: string | null | undefined): Rgba {
  if (!input) return TRANSPARENT

  const hexMatch = HEX_PATTERN.exec(input.trim())
  if (hexMatch) {
    let body = hexMatch[1] ?? ''
    if (body.length === HEX_SHORT_RGB || body.length === HEX_SHORT_RGBA) {
      body = expandShortHex(body)
    }
    if (body.length !== HEX_RGB && body.length !== HEX_RGBA) return TRANSPARENT
    const r = Number.parseInt(body.slice(0, 2), HEX_RADIX)
    const g = Number.parseInt(body.slice(2, 4), HEX_RADIX)
    const b = Number.parseInt(body.slice(4, 6), HEX_RADIX)
    const a = body.length === HEX_RGBA ? Number.parseInt(body.slice(6, 8), HEX_RADIX) / BYTE_MAX : 1
    return [r, g, b, a]
  }

  const rgbaMatch = RGBA_PATTERN.exec(input.trim())
  if (rgbaMatch) {
    const parts = (rgbaMatch[1] ?? '').split(',').map((p) => Number.parseFloat(p.trim()))
    const [r = 0, g = 0, b = 0, a = 1] = parts
    return [r, g, b, Number.isFinite(a) ? a : 1]
  }

  return TRANSPARENT
}

/** Rgba → `rgba(r, g, b, a)` 文字列。RN の style / Skia 双方で使える。 */
export function formatRgba([r, g, b, a]: Rgba): string {
  const round = (v: number) => Math.round(Math.min(Math.max(v, 0), BYTE_MAX))
  const alpha = Math.min(Math.max(a, 0), 1)
  return `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${alpha})`
}

/** Skia の `Float32Array` 相当（0〜1 の 4 成分）。 */
export function toSkiaColor(input: string | null | undefined): SkiaColor {
  const [r, g, b, a] = parseColor(input)
  return [r / BYTE_MAX, g / BYTE_MAX, b / BYTE_MAX, a]
}

/** 不透明度を差し替えた色文字列を返す（ガラスの上の淡い層などに使う）。 */
export function withAlpha(input: string | null | undefined, alpha: number): string {
  const [r, g, b] = parseColor(input)
  return formatRgba([r, g, b, alpha])
}

/** 2 色を線形補間する（JS スレッド用。worklet 側は interpolateColor を使う）。 */
export function mixColor(from: string, to: string, t: number): string {
  const a = parseColor(from)
  const b = parseColor(to)
  const clamped = Math.min(Math.max(t, 0), 1)
  return formatRgba([
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
    a[3] + (b[3] - a[3]) * clamped,
  ])
}
