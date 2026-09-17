/**
 * 図鑑の「経路を画面に収める」算術。
 *
 * この 3 つは worklet（UI スレッド）から呼ぶが、**純粋な数値計算なので
 * ここで固定する**。カメラの挙動はテストできないが、フレーミングが
 * 「空の経路で落ちる」「1 点でカメラがめり込む」といった壊れ方はここで止まる。
 */

import { describe, expect, it } from 'vitest'
import {
  SPACE_DISTANCE_MAX,
  SPACE_DISTANCE_MIN,
  SPACE_WORLD_SCALE,
} from '../src/features/collection/constants'
import {
  boundingSphere,
  framePoints,
  framingDistance,
  yawPitchToFace,
} from '../src/features/collection/framing'
import { projectAll } from '../src/features/collection/projection'

type P = readonly [number, number, number]

describe('boundingSphere', () => {
  it('1 点なら半径 0 でその点が中心', () => {
    const s = boundingSphere([[1, 2, 3]])
    expect(s.center).toEqual([1, 2, 3])
    expect(s.radius).toBeCloseTo(0, 6)
  })

  it('全部の点を含む', () => {
    const points: P[] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]
    const s = boundingSphere(points)
    for (const p of points) {
      const d = Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2])
      expect(d).toBeLessThanOrEqual(s.radius + 1e-6)
    }
  })

  it('空配列は原点・半径 0（落ちないこと）', () => {
    const s = boundingSphere([])
    expect(s.center).toEqual([0, 0, 0])
    expect(s.radius).toBe(0)
  })
})

describe('framingDistance', () => {
  it('半径が大きいほど離れる', () => {
    const fov = Math.PI / 3
    expect(framingDistance(2, fov, 1.2)).toBeGreaterThan(framingDistance(1, fov, 1.2))
  })

  it('余白が大きいほど離れる', () => {
    const fov = Math.PI / 3
    expect(framingDistance(1, fov, 1.5)).toBeGreaterThan(framingDistance(1, fov, 1.0))
  })

  // 半径 0（1 点だけの経路）でも 0 距離にならないこと。カメラがめり込む。
  it('半径 0 でも正の距離を返す', () => {
    expect(framingDistance(0, Math.PI / 3, 1.2)).toBeGreaterThan(0)
  })
})

describe('yawPitchToFace', () => {
  it('有限の角度を返す', () => {
    const points: P[] = [
      [0, 0, 0],
      [1, 1, 1],
      [2, 0, 1],
    ]
    const { yaw, pitch } = yawPitchToFace(boundingSphere(points).center, points)
    expect(Number.isFinite(yaw)).toBe(true)
    expect(Number.isFinite(pitch)).toBe(true)
  })

  it('同じ入力なら同じ向き（決定論）', () => {
    const points: P[] = [
      [0, 0, 0],
      [1, 1, 1],
    ]
    const c = boundingSphere(points).center
    expect(yawPitchToFace(c, points)).toEqual(yawPitchToFace(c, points))
  })
})

// ── 計画の 3 つに加えて、「何のための角度か」を固定する ──────────
describe('yawPitchToFace（広がりが画面の中で寝ること）', () => {
  /** その向きで見たときの「奥行きが伸びる方向」。depth = この向きとの内積 + distance。 */
  function viewAxis(yaw: number, pitch: number): [number, number, number] {
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]
  }

  const CASES: { name: string; points: P[] }[] = [
    {
      name: 'X 軸に伸びる経路',
      points: [
        [-0.8, 0.1, 0.2],
        [0, 0.1, 0.2],
        [0.8, 0.1, 0.2],
      ],
    },
    {
      name: 'Z 軸に伸びる経路',
      points: [
        [0.1, -0.2, -0.7],
        [0.1, -0.2, 0.7],
      ],
    },
    {
      name: '斜めに伸びる経路',
      points: [
        [-0.5, 0.3, -0.5],
        [0.5, -0.3, 0.5],
      ],
    },
  ]

  for (const { name, points } of CASES) {
    it(`${name}：いちばん離れた 2 点を結ぶ軸が、奥行き方向とほぼ直交する`, () => {
      const { yaw, pitch } = yawPitchToFace(boundingSphere(points).center, points)
      const first = points[0] as P
      const last = points[points.length - 1] as P
      const axis: P = [last[0] - first[0], last[1] - first[1], last[2] - first[2]]
      const length = Math.hypot(axis[0], axis[1], axis[2])
      const v = viewAxis(yaw, pitch)
      const dot = (axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]) / length
      // 完全な 0 にはしない（わずかに見下ろす傾きを足しているため）。
      // それでも軸の 3 割以上が奥行きに逃げたらフレーミングの意味が無い。
      expect(Math.abs(dot)).toBeLessThan(0.3)
    })
  }

  it('点が 1 つでも 0 でも落ちない', () => {
    expect(Number.isFinite(yawPitchToFace([0, 0, 0], []).yaw)).toBe(true)
    expect(Number.isFinite(yawPitchToFace([1, 1, 1], [[1, 1, 1]]).pitch)).toBe(true)
  })

  it('同じ点だけが並んでいても落ちない（0 除算）', () => {
    const points: P[] = [
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ]
    const { yaw, pitch } = yawPitchToFace([0.5, 0.5, 0.5], points)
    expect(Number.isFinite(yaw)).toBe(true)
    expect(Number.isFinite(pitch)).toBe(true)
  })
})

// ── 「開いた瞬間に経路が画面に収まっている」を機械で固定する ──
// 図鑑の唯一にして最大の要件なので、実機を見なくても壊れたら分かるようにする。
describe('framePoints（経路が画面に収まること）', () => {
  const WIDTH = 414
  const HEIGHT = 896
  const SHORT = Math.min(WIDTH, HEIGHT)

  function projectWithFraming(points: readonly P[]) {
    const framing = framePoints(points)
    const xyz = new Float32Array(points.length * 3)
    points.forEach((p, i) => {
      xyz[i * 3] = p[0]
      xyz[i * 3 + 1] = p[1]
      xyz[i * 3 + 2] = p[2]
    })
    const screen = new Float32Array(points.length * 2)
    const sizeMul = new Float32Array(points.length)
    const alphaMul = new Float32Array(points.length)
    const depth = new Float32Array(points.length)
    projectAll(
      xyz,
      points.length,
      framing.yaw,
      framing.pitch,
      framing.distance,
      framing.target[0],
      framing.target[1],
      framing.target[2],
      WIDTH / 2,
      HEIGHT / 2,
      SHORT * SPACE_WORLD_SCALE,
      screen,
      sizeMul,
      alphaMul,
      depth,
    )
    return { framing, screen, sizeMul }
  }

  const CASES: { name: string; points: P[] }[] = [
    {
      // 本番 DB の実データ（投影 → 広角レンズ → レンズ → ガラス）。
      // **実際の軌跡は空間全体に対してとても小さい**（半径 0.15 ほど）。
      // ここを作り話の座標で固定すると、実機で「点の塊」になっていても気づけない。
      name: '実データの経路（デイリー 3 手）',
      points: [
        [-0.35195744, 0.29206252, 0.7735214],
        [-0.2940532, 0.28930414, 0.8850682],
        [-0.3024522, 0.296543, 0.8811785],
        [-0.35258317, 0.41743922, 0.61661863],
      ],
    },
    {
      name: '空間の端から端まで伸びる経路',
      points: [
        [-0.95, -0.9, -0.9],
        [-0.2, 0.1, 0.3],
        [0.9, 0.88, 0.95],
      ],
    },
    {
      name: '中心から離れたところの経路（カメラが原点を回っていた頃に画面外へ逃げた形）',
      points: [
        [0.7, -0.75, 0.8],
        [0.82, -0.6, 0.9],
        [0.9, -0.7, 0.72],
        [0.75, -0.82, 0.85],
      ],
    },
    {
      name: '1 手だけの経路（2 点）',
      points: [
        [-0.4, 0.3, 0.2],
        [-0.1, 0.35, 0.25],
      ],
    },
  ]

  for (const { name, points } of CASES) {
    it(`${name}：全部の節が画面の中に入る`, () => {
      const { screen, sizeMul } = projectWithFraming(points)
      for (let i = 0; i < points.length; i += 1) {
        expect(sizeMul[i]).toBeGreaterThan(0)
        expect(screen[i * 2]).toBeGreaterThanOrEqual(0)
        expect(screen[i * 2]).toBeLessThanOrEqual(WIDTH)
        expect(screen[i * 2 + 1]).toBeGreaterThanOrEqual(0)
        expect(screen[i * 2 + 1]).toBeLessThanOrEqual(HEIGHT)
      }
    })

    it(`${name}：点の塊にならない（短辺の 3 割以上に広がる）`, () => {
      const { screen } = projectWithFraming(points)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (let i = 0; i < points.length; i += 1) {
        minX = Math.min(minX, screen[i * 2] as number)
        maxX = Math.max(maxX, screen[i * 2] as number)
        minY = Math.min(minY, screen[i * 2 + 1] as number)
        maxY = Math.max(maxY, screen[i * 2 + 1] as number)
      }
      expect(Math.max(maxX - minX, maxY - minY)).toBeGreaterThan(SHORT * 0.3)
    })
  }

  it('経路が空でも壊れない（距離は正、角度は有限）', () => {
    const framing = framePoints([])
    expect(framing.distance).toBeGreaterThan(0)
    expect(Number.isFinite(framing.yaw)).toBe(true)
    expect(Number.isFinite(framing.pitch)).toBe(true)
    expect(framing.target).toEqual([0, 0, 0])
  })

  it('距離はカメラの上下限に収まる（フレーミングだけ別世界に行かない）', () => {
    for (const { points } of CASES) {
      const { distance } = framePoints(points)
      expect(distance).toBeGreaterThanOrEqual(SPACE_DISTANCE_MIN)
      expect(distance).toBeLessThanOrEqual(SPACE_DISTANCE_MAX)
    }
  })
})
