/**
 * 「選択中の経路が画面に収まる」ためのカメラの算術（SPEC §7 / 図鑑の再設計）。
 *
 * 図鑑を開いた瞬間に**自分の軌跡が画面に収まっていること**がこの画面の要件なので、
 * その計算だけをここに切り出す。worklet（UI スレッド）からも JS からも呼ぶので
 * すべて `'worklet'` 付き・**オブジェクトの確保は戻り値だけ**にしてある。
 *
 * カメラの向きの決め方は `projection.ts` の座標系に従う：
 * - `yaw` は Y 軸まわり、`pitch` は X 軸まわり。カメラは -Z 側から `target` を見る。
 * - 奥行きが伸びる向きは `(-sin yaw · cos pitch, sin pitch, cos yaw · cos pitch)`。
 *   経路の広がりがこの向きに乗ってしまうと、軌跡が**点の塊にしか見えない**。
 *   `yawPitchToFace` はそれを避ける向きを返す。
 *
 * 厳密な最小包含球・共分散行列の固有ベクトルまではやらない。
 * **単純で決定論的であること**（同じ経路なら毎回同じ絵になること）を優先する。
 */

import {
  SPACE_DISTANCE_MAX,
  SPACE_DISTANCE_MIN,
  SPACE_FRAMING_DISTANCE_MIN,
  SPACE_FRAMING_FOV,
  SPACE_FRAMING_MARGIN,
  SPACE_FRAMING_NEAR_GAP,
  SPACE_FRAMING_PITCH_TILT,
  SPACE_PITCH_MAX,
  SPACE_PITCH_MIN,
} from './constants'

export type Vec3 = readonly [number, number, number]

export type BoundingSphere = {
  center: [number, number, number]
  radius: number
}

export type Orientation = {
  yaw: number
  pitch: number
}

/** 軸並行境界箱の中心と、そこからの最大距離。空配列なら原点・半径 0。 */
export function boundingSphere(points: readonly Vec3[]): BoundingSphere {
  'worklet'
  if (points.length === 0) return { center: [0, 0, 0], radius: 0 }

  const first = points[0] as Vec3
  let minX = first[0]
  let minY = first[1]
  let minZ = first[2]
  let maxX = minX
  let maxY = minY
  let maxZ = minZ

  for (let i = 1; i < points.length; i += 1) {
    const p = points[i] as Vec3
    if (p[0] < minX) minX = p[0]
    else if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    else if (p[1] > maxY) maxY = p[1]
    if (p[2] < minZ) minZ = p[2]
    else if (p[2] > maxZ) maxZ = p[2]
  }

  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]

  let radius = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i] as Vec3
    const d = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])
    if (d > radius) radius = d
  }

  return { center, radius }
}

/**
 * 半径 `radius` の球が画角 `fovRad` に `margin` の余白つきで収まる距離。
 *
 * 下限が 2 つある。
 * - `SPACE_FRAMING_DISTANCE_MIN`: 1 点だけの経路（`radius === 0`）でカメラが
 *   点にめり込まないため
 * - `radius + SPACE_FRAMING_NEAR_GAP`: 手前側の節が near plane の向こうに
 *   入って**線が途切れない**ため。画角だけで決めると半径の小さい経路で起きる
 */
export function framingDistance(radius: number, fovRad: number, margin: number): number {
  'worklet'
  const safe = Math.max(SPACE_FRAMING_DISTANCE_MIN, radius + SPACE_FRAMING_NEAR_GAP)
  const tangent = Math.tan(fovRad / 2)
  if (!(tangent > 0)) return safe
  const distance = (radius / tangent) * margin
  if (!Number.isFinite(distance)) return safe
  return Math.max(safe, distance)
}

/**
 * 経路がいちばん広く見える向き。
 *
 * **いちばん離れた 2 点を結ぶ軸**を画面の中で寝かせる（奥行き方向に逃がさない）。
 * 共分散行列まではやらない。同点は添字の小さいほうを採るので決定論的。
 * 経路は時系列で並んでいるので、この軸はだいたい「スタート → 到達」の向きになる。
 *
 * 第 1 引数の中心は **いまは使わない**（カメラが `target` を注視するので、
 * 中心は距離ではなく注視点として渡る）。呼び出し側が `boundingSphere` の結果を
 * そのまま渡せる形を保つために受け取っている。
 */
export function yawPitchToFace(_center: Vec3, points: readonly Vec3[]): Orientation {
  'worklet'
  const tilt = Math.min(Math.max(SPACE_FRAMING_PITCH_TILT, SPACE_PITCH_MIN), SPACE_PITCH_MAX)
  if (points.length < 2) return { yaw: 0, pitch: tilt }

  // いちばん離れた 2 点（同点は添字の小さいほう）。経路の点数は高々数十。
  let bestI = 0
  let bestJ = 1
  let bestDistance = -1
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec3
    for (let j = i + 1; j < points.length; j += 1) {
      const b = points[j] as Vec3
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      if (d > bestDistance) {
        bestDistance = d
        bestI = i
        bestJ = j
      }
    }
  }

  const from = points[bestI] as Vec3
  const to = points[bestJ] as Vec3
  const axisX = to[0] - from[0]
  const axisZ = to[2] - from[2]

  // 軸の水平成分が画面の横方向と揃う yaw。これで軸の奥行き成分が 0 になる。
  // 軸が真上を向いている（水平成分が無い）ときは yaw に意味が無いので 0。
  const horizontal = Math.hypot(axisX, axisZ)
  const yaw = horizontal > 0 ? Math.atan2(axisZ, axisX) : 0

  // pitch は 0 が厳密解だが、それだと絵が平たくなるのでわずかに見下ろす。
  return { yaw, pitch: tilt }
}

export type Framing = Orientation & {
  distance: number
  /** カメラが注視する点（経路の中心）。 */
  target: [number, number, number]
}

/**
 * 経路 →「それが画面に収まるカメラ」。図鑑を開いた瞬間に置く値。
 *
 * 距離はカメラの上下限に丸める。**フレーミングだけが操作の範囲外に
 * 行かないように**（寄りすぎて指で戻せない、という迷子を作らない）。
 */
export function framePoints(points: readonly Vec3[]): Framing {
  'worklet'
  const sphere = boundingSphere(points)
  const { yaw, pitch } = yawPitchToFace(sphere.center, points)
  const distance = framingDistance(sphere.radius, SPACE_FRAMING_FOV, SPACE_FRAMING_MARGIN)
  return {
    yaw,
    pitch,
    distance: Math.min(Math.max(distance, SPACE_DISTANCE_MIN), SPACE_DISTANCE_MAX),
    target: sphere.center,
  }
}
