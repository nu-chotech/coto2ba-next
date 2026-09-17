/**
 * 回転ホイール（`MixWheel`）の幾何計算。
 *
 * **ジェスチャの worklet から呼ぶので、すべて `'worklet'` 付きの純粋関数**にしてある。
 * 副作用も外部の状態も持たないので vitest からそのまま呼べる
 * （`tests/wheel-geometry.test.ts` が固定している）。
 *
 * 角度の約束:
 * - 単位はラジアン。**12 時を 0 とし、時計回りが正。**
 * - ホイールは無限に回らない。`RATIOS` は 8 段しか無いので、
 *   扇（sweep）の両端で止まる（`clampIndex`）。
 *
 * ここに ratio そのものは出てこない。段（index）と角度の対応だけを扱い、
 * index ↔ ratio の変換は contracts の `indexToRatio` / `ratioToIndex` に任せる。
 * **丸めた ratio を自分で作らないこと**（サーバーが 8 値と厳密一致で検証している）。
 *
 * ## このファイルの並び順は変えないこと
 *
 * worklet は **呼ぶより先に宣言しておく**。react-native-worklets の変換は
 * `function foo() { 'worklet' }` を実質 `const foo = …` に置き換えるので、
 * **後ろで宣言した worklet を前の worklet から呼ぶと TDZ になる**。
 * ネイティブでは気づかないが、`expo export --platform web` の静的レンダリング
 * （Node 実行）がモジュール評価の時点で
 * `Cannot access 'X' before initialization` を出して落ちる。
 * 同じ理由で **モジュール直下に `const` を置かない**（worklet がそれを取り込むと同じ事故になる）。
 */

// ── 下位の worklet（先に宣言する）────────────────────────────

/** 段と段のあいだの角度。段が 1 つしか無いときは 0 を返す（0 除算しない）。 */
function stepAngle(count: number, sweepRad: number): number {
  'worklet'
  return count <= 1 ? 0 : sweepRad / (count - 1)
}

/** 段を範囲内に収める（整数）。 */
export function clampIndex(index: number, count: number): number {
  'worklet'
  const last = Math.max(count - 1, 0)
  return Math.min(Math.max(Math.round(index), 0), last)
}

// ── 段 ↔ 角度 ───────────────────────────────────────────────

/**
 * 段 → 角度。扇の中央を 0 として、**index 0 が反時計回りの端**、
 * index count-1 が時計回りの端。
 */
export function indexToAngle(index: number, count: number, sweepRad: number): number {
  'worklet'
  if (count <= 1) return 0
  return -sweepRad / 2 + clampIndex(index, count) * stepAngle(count, sweepRad)
}

/**
 * 角度 → 最も近い段。**扇の外に出た角度は端に丸める**（回り続けない）。
 * 段の境界のちょうど真ん中で切り替わる。
 */
export function angleToIndex(angleRad: number, count: number, sweepRad: number): number {
  'worklet'
  if (count <= 1) return 0
  return clampIndex(Math.round((angleRad + sweepRad / 2) / stepAngle(count, sweepRad)), count)
}

// ── 指の動き ────────────────────────────────────────────────

/**
 * ±π をまたぐ差分を連続にする。
 *
 * `Math.atan2` は ±π で符号が飛ぶので、そのまま引き算すると 1 周ぶん（±2π）の
 * 差分が出てホイールが暴れる。**指の角度を累積するときは必ずこれを通す。**
 */
export function unwrapDelta(prevRad: number, nextRad: number): number {
  'worklet'
  const twoPi = Math.PI * 2
  let delta = (nextRad - prevRad) % twoPi
  if (delta > Math.PI) delta -= twoPi
  else if (delta < -Math.PI) delta += twoPi
  return delta
}

/**
 * ホイールの中心から指へ向かう角度。**12 時が 0、時計回りが正。**
 * `(x, y)` も `(cx, cy)` も画面座標（y は下向きが正）。
 */
export function pointerAngle(x: number, y: number, cx: number, cy: number): number {
  'worklet'
  return Math.atan2(x - cx, cy - y)
}

/**
 * 指の速度（px/秒）→ ホイールの角速度（rad/秒）。慣性の投げ幅に使う。
 *
 * `(dx, dy)` は中心から指へのベクトル。接線方向の成分だけを取り出して半径で割る
 * （外周を払うほど、同じ速さでも回り方はゆるやかになる ── 実物のダイヤルと同じ）。
 * 中心ちょうどでは 0 を返す（0 除算しない）。
 */
export function angularVelocity(vx: number, vy: number, dx: number, dy: number): number {
  'worklet'
  const rSquared = dx * dx + dy * dy
  if (rSquared === 0) return 0
  return (vy * dx - vx * dy) / rSquared
}
