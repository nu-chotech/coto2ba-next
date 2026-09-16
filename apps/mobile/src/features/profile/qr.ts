/**
 * QR コードの生成（バイトモード、バージョン 1〜10）。
 *
 * **なぜ自前なのか**: `react-native-svg` も QR ライブラリも apps/mobile の依存に無く、
 * 依存を増やさないのが担当範囲の制約。引き継ぎ QR は展示ブースで実際に使うので、
 * ISO/IEC 18004 のバイトモードだけを素直に実装してある（描画は Skia の矩形）。
 *
 * 対応範囲：
 * - モード: バイト（8bit）のみ。日本語も UTF-8 のバイト列として通る。
 * - バージョン: 1〜10（バイトモード EC=M で最大 213 バイト）。引き継ぎ URL には十分。
 * - 誤り訂正: L / M / Q / H。
 * - マスク: 0〜7 を全部試して ISO のペナルティ規則で最良を選ぶ。
 *
 * 出力は `size × size` の `Uint8Array`（1 = 黒）。描画側は好きな矩形で塗ればよい。
 */

// ── 公開型 ──────────────────────────────────────────────────

export const QR_EC_LEVELS = ['L', 'M', 'Q', 'H'] as const
export type QrEcLevel = (typeof QR_EC_LEVELS)[number]

export type QrMatrix = {
  /** 一辺のモジュール数（バージョン v なら 4v + 17）。 */
  size: number
  /** `size * size` 個。1 = 黒、0 = 白。index = row * size + col。 */
  modules: Uint8Array
  version: number
  ecLevel: QrEcLevel
  mask: number
}

// ── テーブル（ISO/IEC 18004）────────────────────────────────

/** バージョン 1〜10 の総コードワード数。 */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346] as const

/**
 * [EC コードワード数/ブロック, グループ1のブロック数, グループ1のデータ語数,
 *  グループ2のブロック数, グループ2のデータ語数]
 */
type EcBlockSpec = readonly [number, number, number, number, number]

const EC_BLOCKS: Record<QrEcLevel, readonly EcBlockSpec[]> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0],
    [22, 1, 22, 0, 0],
    [18, 2, 17, 0, 0],
    [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15],
    [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17],
    [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
  ],
}

/** 位置合わせパターンの中心座標（バージョン 1〜10）。 */
const ALIGNMENT_CENTERS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/** 誤り訂正レベルの 2 ビット表現（フォーマット情報用）。 */
const EC_LEVEL_BITS: Record<QrEcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }

export const QR_MAX_VERSION = TOTAL_CODEWORDS.length
const BYTE_MODE = 0b0100
/** バイトモードの文字数指示子は v1〜9 が 8 ビット、v10 以降が 16 ビット。 */
const COUNT_BITS_SMALL = 8
const COUNT_BITS_LARGE = 16
const LARGE_COUNT_FROM_VERSION = 10
const PAD_BYTES = [0xec, 0x11] as const

// ── GF(256) ─────────────────────────────────────────────────

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] as number
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[((GF_LOG[a] as number) + (GF_LOG[b] as number)) % 255] as number
}

/** 生成多項式 (x - α^0)(x - α^1)…(x - α^(degree-1))。 */
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ (poly[j] as number)
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, GF_EXP[i] as number)
    }
    poly = next
  }
  return poly
}

/** データ語列に対する EC 語列。 */
function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const generator = rsGeneratorPoly(ecCount)
  const remainder = new Uint8Array(ecCount)
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number)
    remainder.copyWithin(0, 1)
    remainder[ecCount - 1] = 0
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j += 1) {
        remainder[j] = (remainder[j] as number) ^ gfMul(generator[j + 1] as number, factor)
      }
    }
  }
  return remainder
}

// ── ビット列 ────────────────────────────────────────────────

class BitBuffer {
  private readonly bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1)
  }

  get length(): number {
    return this.bits.length
  }

  /** 8 ビット境界まで 0 を詰めてバイト列にする。 */
  toBytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8))
    for (let i = 0; i < this.bits.length; i += 1) {
      if (this.bits[i] === 1) out[i >>> 3] = (out[i >>> 3] as number) | (0x80 >>> (i & 7))
    }
    return out
  }
}

/** UTF-8 バイト列。`TextEncoder` に頼らない（Hermes の有無に左右されない）。 */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i)
    // サロゲートペア。
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        i += 1
      }
    }
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 0x3f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(out)
}

// ── 構成 ────────────────────────────────────────────────────

function blockSpec(version: number, ecLevel: QrEcLevel): EcBlockSpec {
  const table = EC_BLOCKS[ecLevel]
  const spec = table[version - 1] ?? table[0]
  return spec as EcBlockSpec
}

function dataCodewordCount(version: number, ecLevel: QrEcLevel): number {
  const spec = blockSpec(version, ecLevel)
  return spec[1] * spec[2] + spec[3] * spec[4]
}

function countBits(version: number): number {
  return version < LARGE_COUNT_FROM_VERSION ? COUNT_BITS_SMALL : COUNT_BITS_LARGE
}

/** バイト列が収まる最小のバージョン。収まらなければ null。 */
export function pickVersion(byteLength: number, ecLevel: QrEcLevel): number | null {
  for (let version = 1; version <= QR_MAX_VERSION; version += 1) {
    const capacityBits = dataCodewordCount(version, ecLevel) * 8
    const neededBits = 4 + countBits(version) + byteLength * 8
    if (neededBits <= capacityBits) return version
  }
  return null
}

/** データ + EC をインターリーブした最終コードワード列。 */
function buildCodewords(bytes: Uint8Array, version: number, ecLevel: QrEcLevel): Uint8Array {
  const [ecPerBlock, blocks1, data1, blocks2, data2] = blockSpec(version, ecLevel)
  const totalData = dataCodewordCount(version, ecLevel)

  const buffer = new BitBuffer()
  buffer.push(BYTE_MODE, 4)
  buffer.push(bytes.length, countBits(version))
  for (const byte of bytes) buffer.push(byte, 8)
  // 終端子（最大 4 ビット）。
  const terminator = Math.min(4, totalData * 8 - buffer.length)
  if (terminator > 0) buffer.push(0, terminator)

  const padded = buffer.toBytes()
  const data = new Uint8Array(totalData)
  data.set(padded.subarray(0, Math.min(padded.length, totalData)))
  for (let i = padded.length; i < totalData; i += 1) {
    data[i] = PAD_BYTES[(i - padded.length) % PAD_BYTES.length] as number
  }

  // ブロックに割る。
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (let b = 0; b < blocks1 + blocks2; b += 1) {
    const size = b < blocks1 ? data1 : data2
    const block = data.subarray(offset, offset + size)
    offset += size
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, ecPerBlock))
  }

  // インターリーブ（データ → EC）。
  const out = new Uint8Array(TOTAL_CODEWORDS[version - 1] as number)
  let cursor = 0
  const maxData = Math.max(data1, data2)
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) out[cursor++] = block[i] as number
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out[cursor++] = block[i] as number
  }
  return out
}

// ── BCH（フォーマット情報 / バージョン情報）────────────────

/** 最上位ビットの位置（1 始まり）。0 なら 0。 */
function bitLength(value: number): number {
  let length = 0
  let rest = value
  while (rest !== 0) {
    length += 1
    rest >>>= 1
  }
  return length
}

/** (value << shift) を generator で割った剰余（GF(2) 上の多項式除算）。 */
function bchRemainder(value: number, generator: number, shift: number): number {
  let rest = value << shift
  const generatorLength = bitLength(generator)
  while (bitLength(rest) >= generatorLength) {
    rest ^= generator << (bitLength(rest) - generatorLength)
  }
  return rest
}

/** G(15, 5) の生成多項式 x^10+x^8+x^5+x^4+x^2+x+1。 */
const FORMAT_GENERATOR = 0b101_0011_0111
/** フォーマット情報に重ねる固定マスク 101010000010010。 */
const FORMAT_MASK = 0b101_0100_0001_0010
/** G(18, 6) の生成多項式 x^12+x^11+x^10+x^9+x^8+x^5+x^2+1。 */
const VERSION_GENERATOR = 0b1_1111_0010_0101

export function formatInfoBits(ecLevel: QrEcLevel, mask: number): number {
  const value = ((EC_LEVEL_BITS[ecLevel] << 3) | mask) & 0b11111
  return (((value << 10) | bchRemainder(value, FORMAT_GENERATOR, 10)) ^ FORMAT_MASK) & 0x7fff
}

export function versionInfoBits(version: number): number {
  return ((version << 12) | bchRemainder(version, VERSION_GENERATOR, 12)) & 0x3ffff
}

// ── マトリクスの組み立て ────────────────────────────────────

const FINDER_SIZE = 7
const TIMING_ROW = 6
const VERSION_INFO_FROM = 7

type Grid = {
  size: number
  modules: Uint8Array
  /** 1 = 機能パターン（データを置けない）。 */
  reserved: Uint8Array
}

function makeGrid(version: number): Grid {
  const size = version * 4 + 17
  return {
    size,
    modules: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  }
}

function setModule(grid: Grid, row: number, col: number, dark: boolean, reserve: boolean): void {
  if (row < 0 || col < 0 || row >= grid.size || col >= grid.size) return
  const index = row * grid.size + col
  grid.modules[index] = dark ? 1 : 0
  if (reserve) grid.reserved[index] = 1
}

function isReserved(grid: Grid, row: number, col: number): boolean {
  return grid.reserved[row * grid.size + col] === 1
}

function drawFinder(grid: Grid, row: number, col: number): void {
  for (let r = -1; r <= FINDER_SIZE; r += 1) {
    for (let c = -1; c <= FINDER_SIZE; c += 1) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || cc < 0 || rr >= grid.size || cc >= grid.size) continue
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      setModule(grid, rr, cc, inRing, true)
    }
  }
}

function drawAlignment(grid: Grid, version: number): void {
  const centers = ALIGNMENT_CENTERS[version - 1] ?? []
  for (const row of centers) {
    for (const col of centers) {
      // 3 つのファインダと重なる位置は置かない。
      const last = grid.size - 1 - TIMING_ROW - 1
      const atFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === last + 1) ||
        (row === last + 1 && col === 6)
      if (atFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1
          setModule(grid, row + r, col + c, dark, true)
        }
      }
    }
  }
}

function drawTiming(grid: Grid): void {
  for (let i = FINDER_SIZE + 1; i < grid.size - FINDER_SIZE - 1; i += 1) {
    const dark = i % 2 === 0
    if (!isReserved(grid, TIMING_ROW, i)) setModule(grid, TIMING_ROW, i, dark, true)
    if (!isReserved(grid, i, TIMING_ROW)) setModule(grid, i, TIMING_ROW, dark, true)
  }
}

function reserveFormatAreas(grid: Grid): void {
  const size = grid.size
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setModule(grid, 8, i, false, true)
      setModule(grid, i, 8, false, true)
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setModule(grid, 8, size - 1 - i, false, true)
    setModule(grid, size - 1 - i, 8, false, true)
  }
  // 常に黒のモジュール。
  setModule(grid, size - 8, 8, true, true)
}

function drawVersionInfo(grid: Grid, version: number): void {
  if (version < VERSION_INFO_FROM) return
  const bits = versionInfoBits(version)
  const size = grid.size
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1
    const row = Math.floor(i / 3)
    const col = (i % 3) + size - 11
    setModule(grid, row, col, dark, true)
    setModule(grid, col, row, dark, true)
  }
}

function drawFormatInfo(grid: Grid, ecLevel: QrEcLevel, mask: number): void {
  const bits = formatInfoBits(ecLevel, mask)
  const size = grid.size

  // 縦（左上の 8 列目 → 左下）。
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1
    if (i < 6) setModule(grid, i, 8, dark, true)
    else if (i < 8) setModule(grid, i + 1, 8, dark, true)
    else setModule(grid, size - 15 + i, 8, dark, true)
  }

  // 横（右上 → 左上の 8 行目）。
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1
    if (i < 8) setModule(grid, 8, size - 1 - i, dark, true)
    else if (i < 9) setModule(grid, 8, 15 - i, dark, true)
    else setModule(grid, 8, 14 - i, dark, true)
  }

  // 常に黒のモジュール。
  setModule(grid, size - 8, 8, true, true)
}

/** 2 列ずつジグザグにデータを置く。 */
function placeData(grid: Grid, codewords: Uint8Array): void {
  const size = grid.size
  let bitIndex = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    // 縦のタイミングパターン列は飛ばす。
    const col = right <= TIMING_ROW ? right - 1 : right
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (let offset = 0; offset < 2; offset += 1) {
        const c = col - offset
        if (c < 0) continue
        if (isReserved(grid, row, c)) continue
        const byte = codewords[bitIndex >>> 3]
        const dark = byte !== undefined && ((byte >>> (7 - (bitIndex & 7))) & 1) === 1
        setModule(grid, row, c, dark, false)
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let row = 0; row < grid.size; row += 1) {
    for (let col = 0; col < grid.size; col += 1) {
      if (isReserved(grid, row, col)) continue
      if (!maskAt(mask, row, col)) continue
      const index = row * grid.size + col
      grid.modules[index] = (grid.modules[index] as number) ^ 1
    }
  }
}

// ── ペナルティ（ISO/IEC 18004 の 4 規則）────────────────────

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10
const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0] as const

function lineRun(get: (i: number) => number, length: number): number {
  let score = 0
  let runLength = 1
  let runValue = get(0)
  for (let i = 1; i < length; i += 1) {
    const value = get(i)
    if (value === runValue) {
      runLength += 1
    } else {
      if (runLength >= 5) score += PENALTY_N1 + (runLength - 5)
      runValue = value
      runLength = 1
    }
  }
  if (runLength >= 5) score += PENALTY_N1 + (runLength - 5)
  return score
}

function finderLikeCount(get: (i: number) => number, length: number): number {
  let count = 0
  for (let start = 0; start + FINDER_LIKE.length <= length; start += 1) {
    let forward = true
    let backward = true
    for (let k = 0; k < FINDER_LIKE.length; k += 1) {
      const value = get(start + k)
      if (value !== FINDER_LIKE[k]) forward = false
      if (value !== FINDER_LIKE[FINDER_LIKE.length - 1 - k]) backward = false
    }
    if (forward) count += 1
    if (backward) count += 1
  }
  return count
}

function penalty(grid: Grid): number {
  const size = grid.size
  const at = (row: number, col: number) => grid.modules[row * size + col] as number
  let score = 0

  for (let i = 0; i < size; i += 1) {
    score += lineRun((k) => at(i, k), size)
    score += lineRun((k) => at(k, i), size)
    score += PENALTY_N3 * finderLikeCount((k) => at(i, k), size)
    score += PENALTY_N3 * finderLikeCount((k) => at(k, i), size)
  }

  for (let row = 0; row + 1 < size; row += 1) {
    for (let col = 0; col + 1 < size; col += 1) {
      const value = at(row, col)
      if (
        value === at(row, col + 1) &&
        value === at(row + 1, col) &&
        value === at(row + 1, col + 1)
      ) {
        score += PENALTY_N2
      }
    }
  }

  let dark = 0
  for (const value of grid.modules) dark += value
  const percent = (dark * 100) / (size * size)
  score += PENALTY_N4 * Math.floor(Math.abs(percent - 50) / 5)

  return score
}

// ── 入口 ────────────────────────────────────────────────────

function drawFunctionPatterns(grid: Grid, version: number): void {
  drawFinder(grid, 0, 0)
  drawFinder(grid, 0, grid.size - FINDER_SIZE)
  drawFinder(grid, grid.size - FINDER_SIZE, 0)
  drawAlignment(grid, version)
  drawTiming(grid)
  reserveFormatAreas(grid)
  drawVersionInfo(grid, version)
}

/**
 * テキストを QR に変換する。長すぎる（バージョン 10 に収まらない）場合は null。
 * **落とさない**（引き継ぎはトークン文字列のコピーでも成立するため）。
 */
export function encodeQr(text: string, ecLevel: QrEcLevel = 'M'): QrMatrix | null {
  if (text.length === 0) return null
  const bytes = utf8Bytes(text)
  const version = pickVersion(bytes.length, ecLevel)
  if (version === null) return null

  const codewords = buildCodewords(bytes, version, ecLevel)

  let best: { grid: Grid; mask: number; score: number } | null = null
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = makeGrid(version)
    drawFunctionPatterns(grid, version)
    placeData(grid, codewords)
    applyMask(grid, mask)
    drawFormatInfo(grid, ecLevel, mask)
    const score = penalty(grid)
    if (best === null || score < best.score) best = { grid, mask, score }
  }
  if (best === null) return null

  return {
    size: best.grid.size,
    modules: best.grid.modules,
    version,
    ecLevel,
    mask: best.mask,
  }
}

/** デバッグ用の文字列表現（テストから使う）。 */
export function qrToText(matrix: QrMatrix, darkChar = '#', lightChar = '.'): string {
  const rows: string[] = []
  for (let row = 0; row < matrix.size; row += 1) {
    let line = ''
    for (let col = 0; col < matrix.size; col += 1) {
      line += matrix.modules[row * matrix.size + col] === 1 ? darkChar : lightChar
    }
    rows.push(line)
  }
  return rows.join('\n')
}
