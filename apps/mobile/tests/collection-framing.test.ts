/**
 * 図鑑の「経路を画面に収める」算術。
 *
 * この 3 つは worklet（UI スレッド）から呼ぶが、**純粋な数値計算なので
 * ここで固定する**。カメラの挙動はテストできないが、フレーミングが
 * 「空の経路で落ちる」「1 点でカメラがめり込む」といった壊れ方はここで止まる。
 */

import { describe, expect, it } from 'vitest'
import { boundingSphere, framingDistance, yawPitchToFace } from '../src/features/collection/framing'

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
