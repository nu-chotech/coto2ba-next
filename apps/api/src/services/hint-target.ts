/**
 * ヒントの外挿ターゲット（SPEC §3.3 / docs/superpowers/plans/2026-09-17-hint-extrapolation.md）。
 *
 * 1 手は `blend(v_current, 1 - r, v_input, r)` なので、
 * **現在とゴールの内挿**（従来のヒント）を混ぜても結果は現在からほとんど動かない。
 * 比率 `r` でゴールに着地させたい入力語のベクトルは外挿
 *
 *   v_W*(r) = (v_goal - (1 - r) * v_current) / r
 *
 * の方向にある。ここは DB に触らない純粋な算術だけを置く（テストしやすさのため）。
 * SQL 側の混合は `vector.ts` の `blend`（halfvec 用）が持っている。こちらは JS の数値計算。
 */

function assertSameLength(a: Float32Array, b: Float32Array): void {
  if (a.length !== b.length) throw new TypeError('vectors must have the same length')
  if (a.length === 0) throw new TypeError('vectors must not be empty')
}

/** L2 ノルム。0 なら余弦が定義できないので呼び出し側で弾く。 */
function norm(v: Float32Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number
    sum += x * x
  }
  return Math.sqrt(sum)
}

/**
 * 比率 `ratio` で混ぜたときにゴールへ着地する入力語のベクトル。
 *
 * **L2 正規化しない。** 正規化すると `(1 - r) * current + r * target` が
 * ゴールと一致しなくなり（球面上の別の点に落ちる）、この関数の定義的性質が壊れる。
 * 単位ベクトル化しても pgvector の `<=>` は余弦距離＝スケール不変なので
 * 近傍検索の結果は変わらない。よって性質の保存を優先する。
 * `ratio` が小さいほどノルムが大きい＝より極端な語が要る、という意味も残る。
 */
export function extrapolationTarget(
  current: Float32Array,
  goal: Float32Array,
  ratio: number,
): Float32Array {
  assertSameLength(current, goal)
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new RangeError('ratio must be in (0, 1]')
  }
  const rest = 1 - ratio
  const target = new Float32Array(current.length)
  for (let i = 0; i < target.length; i++) {
    target[i] = ((goal[i] as number) - rest * (current[i] as number)) / ratio
  }
  const n = norm(target)
  if (!Number.isFinite(n) || n === 0) {
    throw new TypeError('extrapolation target must have a non-zero norm')
  }
  return target
}

/** `(1 - ratio) * current + ratio * candidate` とゴールの余弦類似度。 */
export function blendCosineToGoal(
  current: Float32Array,
  candidate: Float32Array,
  goal: Float32Array,
  ratio: number,
): number {
  assertSameLength(current, candidate)
  assertSameLength(current, goal)
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError('ratio must be in [0, 1]')
  }
  const rest = 1 - ratio
  let dot = 0
  let blendSquared = 0
  let goalSquared = 0
  for (let i = 0; i < current.length; i++) {
    const blended = rest * (current[i] as number) + ratio * (candidate[i] as number)
    const g = goal[i] as number
    dot += blended * g
    blendSquared += blended * blended
    goalSquared += g * g
  }
  const denominator = Math.sqrt(blendSquared) * Math.sqrt(goalSquared)
  if (!Number.isFinite(denominator) || denominator === 0) {
    throw new TypeError('blend and goal must have a non-zero norm')
  }
  return dot / denominator
}

export interface RatioChoice {
  ratio: number
  cosine: number
}

/**
 * 候補語に対して最もゴールに近づく比率。
 * 同値のときは**小さい比率**を選ぶ（`hint_cache` が決定論である必要があるため。
 * 入力順に依存させない）。
 */
export function bestRatioForCandidate(
  current: Float32Array,
  candidate: Float32Array,
  goal: Float32Array,
  ratios: readonly number[],
): RatioChoice {
  if (ratios.length === 0) throw new RangeError('ratios must not be empty')
  let best: RatioChoice | null = null
  for (const ratio of ratios) {
    const cosine = blendCosineToGoal(current, candidate, goal, ratio)
    if (best === null || cosine > best.cosine || (cosine === best.cosine && ratio < best.ratio)) {
      best = { ratio, cosine }
    }
  }
  if (best === null) throw new RangeError('ratios must not be empty')
  return best
}
