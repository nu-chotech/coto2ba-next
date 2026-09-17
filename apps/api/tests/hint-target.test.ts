/**
 * 外挿ターゲットの算術（DB を使わない純粋な数値計算）。
 *
 * 「ヒントが効かない」の正体は、現在とゴールの**内挿**を返していたこと。
 * 混ぜる語に必要なのは外挿なので、その性質をここで固定する。
 */
import { describe, expect, it } from 'vitest'
import {
  bestRatioForCandidate,
  blendCosineToGoal,
  extrapolationTarget,
} from '../src/services/hint-target'

const vec = (...xs: number[]) => Float32Array.from(xs)
const cos = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number
    const bi = b[i] as number
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
const normOf = (v: Float32Array) => Math.sqrt(v.reduce((acc, x) => acc + x * x, 0))

describe('extrapolationTarget', () => {
  // これが本命の性質。外挿点そのものを ratio で混ぜると、ゴールに戻ってくる。
  it('外挿点を同じ比率で混ぜるとゴールに一致する', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    for (const ratio of [0.2, 0.5, 0.8]) {
      const target = extrapolationTarget(current, goal, ratio)
      expect(blendCosineToGoal(current, target, goal, ratio)).toBeCloseTo(1, 5)
    }
  })

  // 内挿（現在とゴールの中間）を混ぜても、ゴールには全く届かない。
  // これが「ヒントが効かない」の正体なので、対比をテストで固定する。
  it('内挿点より外挿点のほうがゴールに近づく', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    const ratio = 0.4
    const interpolated = vec(0.8, 0.2, 0)
    const target = extrapolationTarget(current, goal, ratio)
    expect(blendCosineToGoal(current, target, goal, ratio)).toBeGreaterThan(
      blendCosineToGoal(current, interpolated, goal, ratio),
    )
  })

  // 正規化はしない（正規化すると上の「ゴールに一致する」性質が壊れる）。
  // 比率が小さいほど、必要な語はゴールの向こう側へ遠のく。
  it('比率が小さいほど遠くを指す', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    const near = extrapolationTarget(current, goal, 0.8)
    const far = extrapolationTarget(current, goal, 0.2)
    expect(cos(far, far)).toBeCloseTo(1, 6)
    expect(normOf(far)).toBeGreaterThan(normOf(near))
  })

  it('ratio が 0 なら投げる（0 除算になるため）', () => {
    expect(() => extrapolationTarget(vec(1, 0, 0), vec(0, 1, 0), 0)).toThrow(RangeError)
  })

  it('長さが違えば投げる', () => {
    expect(() => extrapolationTarget(vec(1, 0, 0), vec(0, 1), 0.5)).toThrow(TypeError)
  })
})

describe('bestRatioForCandidate', () => {
  it('候補に対して最良の比率を選ぶ', () => {
    const current = vec(1, 0, 0)
    const goal = vec(0, 1, 0)
    const candidate = vec(0, 1, 0) // ゴールそのもの
    const best = bestRatioForCandidate(current, candidate, goal, [0.1, 0.5, 0.8])
    // ゴールそのものを混ぜるなら、比率が大きいほどゴールに近い
    expect(best.ratio).toBe(0.8)
    expect(best.cosine).toBeGreaterThan(0.9)
  })

  it('同値なら小さい比率を選ぶ（キャッシュが決定論であるため）', () => {
    // candidate === current なので、どの比率でも混合結果は current のまま。
    const current = vec(1, 0, 0)
    const best = bestRatioForCandidate(current, vec(1, 0, 0), vec(0, 1, 0), [0.8, 0.1, 0.5])
    expect(best.ratio).toBe(0.1)
  })

  it('候補が空の比率配列なら投げる', () => {
    expect(() => bestRatioForCandidate(vec(1, 0, 0), vec(0, 1, 0), vec(0, 1, 0), [])).toThrow(
      RangeError,
    )
  })
})
