/**
 * 回転ホイール（MixWheel）の幾何計算のテスト。
 *
 * ジェスチャの中身は worklet なので実機でしか動かないが、**計算だけは純粋関数**に
 * 切り出してあるのでここで固定できる。ホイールが「1 周ぶん暴れる」「端を越えて回り続ける」
 * といった事故は、どれもこの層の計算違いで起きる。
 */

import { RATIOS } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import {
  angleToIndex,
  angularVelocity,
  clampIndex,
  indexToAngle,
  pointerAngle,
  unwrapDelta,
} from '../src/components/wheel-geometry'

/** ホイールが使う扇の角度。テストは実装の定数に依存しない値で回す。 */
const SWEEP = Math.PI * 1.5
const COUNT = 8

describe('angleToIndex / indexToAngle', () => {
  it('段の数は RATIOS と同じ 8 段で足りる', () => {
    expect(RATIOS.length).toBe(COUNT)
  })

  it('往復して同じ段に戻る', () => {
    for (let i = 0; i < COUNT; i++) {
      expect(angleToIndex(indexToAngle(i, COUNT, SWEEP), COUNT, SWEEP)).toBe(i)
    }
  })

  it('両端の角度は扇のちょうど端', () => {
    expect(indexToAngle(0, COUNT, SWEEP)).toBeCloseTo(-SWEEP / 2, 9)
    expect(indexToAngle(COUNT - 1, COUNT, SWEEP)).toBeCloseTo(SWEEP / 2, 9)
  })

  it('両端を超えた角度は端に丸める', () => {
    expect(angleToIndex(-10, COUNT, SWEEP)).toBe(0)
    expect(angleToIndex(10, COUNT, SWEEP)).toBe(COUNT - 1)
  })

  it('段の境界のちょうど真ん中で切り替わる', () => {
    const a = indexToAngle(3, COUNT, SWEEP)
    const b = indexToAngle(4, COUNT, SWEEP)
    const mid = (a + b) / 2
    // 真ん中より少しでも b 寄りなら 4 段目
    expect(angleToIndex(mid + 1e-4, COUNT, SWEEP)).toBe(4)
    expect(angleToIndex(mid - 1e-4, COUNT, SWEEP)).toBe(3)
  })

  it('段が 1 つしか無くても落ちない', () => {
    expect(indexToAngle(0, 1, SWEEP)).toBe(0)
    expect(angleToIndex(5, 1, SWEEP)).toBe(0)
  })
})

describe('unwrapDelta', () => {
  // atan2 は ±π をまたぐと符号が飛ぶ。そのまま差分を取ると
  // ホイールが 1 周ぶん暴れるので、ここで連続化する。
  it('π をまたいでも小さい差分になる', () => {
    expect(unwrapDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6)
    expect(unwrapDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6)
  })

  it('普通の差分はそのまま', () => {
    expect(unwrapDelta(0.1, 0.3)).toBeCloseTo(0.2, 6)
  })

  it('動いていなければ 0', () => {
    expect(unwrapDelta(1.2, 1.2)).toBe(0)
  })
})

describe('clampIndex', () => {
  it('範囲外を丸める', () => {
    expect(clampIndex(-1, COUNT)).toBe(0)
    expect(clampIndex(COUNT, COUNT)).toBe(COUNT - 1)
    expect(clampIndex(3, COUNT)).toBe(3)
  })
})

describe('pointerAngle', () => {
  // 12 時を 0 として時計回りが正。ホイールの上が「混ぜる語寄り」側に進む向き。
  it('真上は 0', () => {
    expect(pointerAngle(100, 20, 100, 100)).toBeCloseTo(0, 9)
  })

  it('右は +π/2、左は -π/2', () => {
    expect(pointerAngle(180, 100, 100, 100)).toBeCloseTo(Math.PI / 2, 9)
    expect(pointerAngle(20, 100, 100, 100)).toBeCloseTo(-Math.PI / 2, 9)
  })

  it('真下は ±π（unwrapDelta で連続化する前提）', () => {
    expect(Math.abs(pointerAngle(100, 180, 100, 100))).toBeCloseTo(Math.PI, 9)
  })
})

describe('angularVelocity', () => {
  // 指の速度（px/秒）を角速度（rad/秒）に直す。慣性の投げ幅に使う。
  it('上端を右に払うと時計回り（正）', () => {
    expect(angularVelocity(80, 0, 0, -80)).toBeCloseTo(1, 6)
  })

  it('下端を右に払うと反時計回り（負）', () => {
    expect(angularVelocity(80, 0, 0, 80)).toBeCloseTo(-1, 6)
  })

  it('中心では 0（0 除算しない）', () => {
    expect(angularVelocity(80, 80, 0, 0)).toBe(0)
  })

  it('半径が大きいほど角速度は小さい', () => {
    const near = angularVelocity(80, 0, 0, -40)
    const far = angularVelocity(80, 0, 0, -160)
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far))
  })
})
