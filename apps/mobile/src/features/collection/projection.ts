/**
 * 図鑑の投影（回転 → 透視投影 → 画面座標）。
 *
 * **worklet でも JS でも同じ関数を使う。** ラベルの配置（JS）とタップ判定・
 * Atlas の変換（UI スレッド）が 1pt でもずれると「見えている点を押しても当たらない」
 * ことになるので、実装は 1 つだけにする。
 *
 * 性能のために **オブジェクトを返さない**。呼び出し側が用意した `Float32Array` に
 * 書き込む（1 フレームに 2,500 点 × 数回走るので、1 点ごとの確保は許されない）。
 *
 * 座標系：
 * - `pos3` は各軸 [-1, 1]（SPEC §9.1）。
 * - yaw は Y 軸まわり、pitch は X 軸まわり。カメラは -Z 側から原点を見る。
 * - depth = 回転後の z + distance。小さいほど手前。
 */

import { SPACE_FOCAL } from '@coto2ba/contracts'
import {
  SPACE_DEPTH_ALPHA_MAX,
  SPACE_DEPTH_ALPHA_MIN,
  SPACE_DEPTH_SIZE_MAX,
  SPACE_DEPTH_SIZE_MIN,
  SPACE_NEAR_PLANE,
  SPACE_WORLD_RADIUS,
} from './constants'

/** 深度ソートのバケット数（計数ソート）。 */
export const DEPTH_BUCKETS = 256

/**
 * 全点を投影する。
 *
 * @param screen `count * 2`。画面座標 x, y。
 * @param sizeMul `count`。深度によるサイズ倍率。**0 なら画面外/背後**。
 * @param alphaMul `count`。深度によるアルファ倍率。
 * @param depth `count`。カメラからの深さ（ソート用）。
 */
export function projectAll(
  xyz: Float32Array,
  count: number,
  yaw: number,
  pitch: number,
  distance: number,
  centerX: number,
  centerY: number,
  worldScale: number,
  screen: Float32Array,
  sizeMul: Float32Array,
  alphaMul: Float32Array,
  depth: Float32Array,
): void {
  'worklet'
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)

  const near = distance - SPACE_WORLD_RADIUS
  const span = SPACE_WORLD_RADIUS * 2

  for (let i = 0; i < count; i += 1) {
    const x = xyz[i * 3]
    const y = xyz[i * 3 + 1]
    const z = xyz[i * 3 + 2]

    // yaw（Y 軸） → pitch（X 軸）。
    const x1 = x * cosYaw + z * sinYaw
    const z1 = -x * sinYaw + z * cosYaw
    const y1 = y * cosPitch - z1 * sinPitch
    const z2 = y * sinPitch + z1 * cosPitch

    const d = z2 + distance
    depth[i] = d

    if (d <= SPACE_NEAR_PLANE) {
      screen[i * 2] = centerX
      screen[i * 2 + 1] = centerY
      sizeMul[i] = 0
      alphaMul[i] = 0
      continue
    }

    const k = (SPACE_FOCAL / d) * worldScale
    screen[i * 2] = centerX + x1 * k
    // 画面の y は下向き。
    screen[i * 2 + 1] = centerY - y1 * k

    // 0（手前）〜 1（奥）。
    let t = (d - near) / span
    if (t < 0) t = 0
    else if (t > 1) t = 1
    sizeMul[i] = SPACE_DEPTH_SIZE_MAX + (SPACE_DEPTH_SIZE_MIN - SPACE_DEPTH_SIZE_MAX) * t
    alphaMul[i] = SPACE_DEPTH_ALPHA_MAX + (SPACE_DEPTH_ALPHA_MIN - SPACE_DEPTH_ALPHA_MAX) * t
  }
}

/**
 * 深度で並べ替える（**奥 → 手前**。後に描いたものが上に乗る）。
 *
 * 比較ソートではなく計数ソートにしてある。毎フレーム 2,500 点を UI スレッドで
 * 並べるので O(n log n) の比較ソートは避ける。
 *
 * @param buckets 長さ `DEPTH_BUCKETS` の作業領域（毎回上書きする）。
 * @param order `count`。並べ替えた **点のインデックス**。
 */
export function orderByDepth(
  depth: Float32Array,
  count: number,
  distance: number,
  buckets: Float32Array,
  order: Float32Array,
): void {
  'worklet'
  const near = distance - SPACE_WORLD_RADIUS
  const span = SPACE_WORLD_RADIUS * 2
  const last = DEPTH_BUCKETS - 1

  for (let b = 0; b < DEPTH_BUCKETS; b += 1) buckets[b] = 0

  for (let i = 0; i < count; i += 1) {
    let t = (depth[i] - near) / span
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const b = Math.min(last, Math.floor(t * last))
    buckets[b] = buckets[b] + 1
  }

  // 奥（大きい depth）から先に並べる。
  let acc = 0
  for (let b = last; b >= 0; b -= 1) {
    const c = buckets[b]
    buckets[b] = acc
    acc += c
  }

  for (let i = 0; i < count; i += 1) {
    let t = (depth[i] - near) / span
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const b = Math.min(last, Math.floor(t * last))
    const slot = buckets[b]
    buckets[b] = slot + 1
    order[slot] = i
  }
}

/**
 * 画面座標から最近傍の点を探す（タップ判定）。
 * `limit` 件目までしか見ない（所持語だけを対象にするため）。
 * 見つからなければ -1。
 */
export function nearestIndex(
  screen: Float32Array,
  sizeMul: Float32Array,
  limit: number,
  tapX: number,
  tapY: number,
  radius: number,
): number {
  'worklet'
  let best = -1
  let bestDistance = radius * radius
  for (let i = 0; i < limit; i += 1) {
    if (sizeMul[i] <= 0) continue
    const dx = screen[i * 2] - tapX
    const dy = screen[i * 2 + 1] - tapY
    const d2 = dx * dx + dy * dy
    if (d2 <= bestDistance) {
      bestDistance = d2
      best = i
    }
  }
  return best
}

/**
 * 1 点だけ投影する（選択中の輪など）。
 * `out` は長さ 4：[画面 x, 画面 y, サイズ倍率（0 なら不可視）, 深さ]。
 */
export function projectOne(
  xyz: Float32Array,
  index: number,
  yaw: number,
  pitch: number,
  distance: number,
  centerX: number,
  centerY: number,
  worldScale: number,
  out: Float32Array,
): void {
  'worklet'
  out[0] = centerX
  out[1] = centerY
  out[2] = 0
  out[3] = 0
  if (index < 0 || (index + 1) * 3 > xyz.length) return

  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)

  const x = xyz[index * 3]
  const y = xyz[index * 3 + 1]
  const z = xyz[index * 3 + 2]
  const x1 = x * cosYaw + z * sinYaw
  const z1 = -x * sinYaw + z * cosYaw
  const y1 = y * cosPitch - z1 * sinPitch
  const z2 = y * sinPitch + z1 * cosPitch
  const d = z2 + distance
  out[3] = d
  if (d <= SPACE_NEAR_PLANE) return

  const k = (SPACE_FOCAL / d) * worldScale
  out[0] = centerX + x1 * k
  out[1] = centerY - y1 * k

  let t = (d - (distance - SPACE_WORLD_RADIUS)) / (SPACE_WORLD_RADIUS * 2)
  if (t < 0) t = 0
  else if (t > 1) t = 1
  out[2] = SPACE_DEPTH_SIZE_MAX + (SPACE_DEPTH_SIZE_MIN - SPACE_DEPTH_SIZE_MAX) * t
}
