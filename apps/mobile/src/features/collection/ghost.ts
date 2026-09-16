/**
 * ゴースト点（未取得語の薄い粒子、SPEC §9.1）。
 *
 * `assets/vocab/ghost.json`（`[{ word, pos3: [x, y, z] }]`、頻度上位 2,000 語）を使う。
 * **ファイルが空でも落ちない**：そのときは決定的な疑似乱数で球面上に
 * `SPACE_GHOST_COUNT` 点をばら撒く。サーバーも語彙も無い状態で図鑑を開いても
 * 「宇宙が見える」ことがこの画面の最低要件。
 */

import { SPACE_GHOST_COUNT } from '@coto2ba/contracts'

export type GhostPoint = {
  word: string
  pos3: readonly [number, number, number]
}

// Metro は require を静的に解決するので、ファイルは（空の配列でも）必ず存在させる。
const GHOST_MODULE: unknown = require('../../../assets/vocab/ghost.json')

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** JSON をそのまま信用しない（壊れた行は落とす）。 */
function parseGhostJson(input: unknown): GhostPoint[] {
  if (!Array.isArray(input)) return []
  const out: GhostPoint[] = []
  for (const row of input) {
    if (row === null || typeof row !== 'object') continue
    const word = (row as { word?: unknown }).word
    const pos3 = (row as { pos3?: unknown }).pos3
    if (typeof word !== 'string' || word.length === 0) continue
    if (!Array.isArray(pos3) || pos3.length !== 3) continue
    const [x, y, z] = pos3 as unknown[]
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue
    out.push({ word, pos3: [x, y, z] })
  }
  return out
}

/** mulberry32。**決定的**（毎回同じ宇宙が出る）。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FALLBACK_SEED = 0x63_6f_74_6f
/** 球の内側にも散らすための半径のゆらぎ。 */
const FALLBACK_RADIUS_MIN = 0.45

/**
 * `ghost.json` が空のときの代替。フィボナッチ球 + 半径のゆらぎで
 * 「均一すぎない球状の星雲」を作る。座標は各軸 [-1, 1] に収まる。
 */
export function generateFallbackGhosts(count: number = SPACE_GHOST_COUNT): GhostPoint[] {
  const random = makeRandom(FALLBACK_SEED)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: GhostPoint[] = []
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const radius = FALLBACK_RADIUS_MIN + (1 - FALLBACK_RADIUS_MIN) * random()
    out.push({
      word: '',
      pos3: [Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius],
    })
  }
  return out
}

let cached: GhostPoint[] | null = null

/**
 * ゴースト点。初回だけ JSON を読み、以後は使い回す。
 * JSON が空なら疑似乱数で作る（**必ず 1 点以上返る**）。
 */
export function getGhostPoints(): GhostPoint[] {
  if (cached !== null) return cached
  const parsed = parseGhostJson(GHOST_MODULE)
  cached = parsed.length > 0 ? parsed : generateFallbackGhosts()
  return cached
}

/** ゴースト点が本物の語彙か（疑似乱数のダミーか）。表示文言の出し分けに使う。 */
export function hasRealGhosts(): boolean {
  const points = getGhostPoints()
  return points.length > 0 && (points[0]?.word ?? '').length > 0
}
