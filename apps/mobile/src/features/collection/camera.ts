/**
 * 図鑑のオービットカメラ（yaw / pitch / distance / target）。
 *
 * **原点ではなく `target`（選択中の経路の中心）のまわりを回る。**
 * 主役は「自分の軌跡」なので、回しても経路が画面の真ん中から逃げないようにする。
 * 原点を回るカメラだと少し回しただけで経路が画面外に振られ、迷子になる。
 *
 * - パン（1 本指）→ yaw / pitch。離すと `withDecay` で滑る。
 * - ピンチ → distance。行き過ぎを許してバネで戻す。
 * - **二本指タップ → 選択中の経路へ戻す**（迷子からの復帰。画面下の
 *   「経路にもどす」ボタンと同じ働きで、こちらは指だけで完結する）。
 * - `Gesture.Simultaneous` で同時に効く。
 *
 * 注意（docs/research/rn-game-ui.md）：
 * - `.onBegin` の自己代入で **走っている慣性を打ち切る**。無いと掴んだときに二重に動く。
 * - パンは `.minPointers(1).maxPointers(1)`。しないと 2 本目の指の動きがパンに漏れる。
 */

import { type MutableRefObject, useCallback, useMemo, useRef } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import {
  clamp,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import {
  SPACE_CAMERA_SPRING,
  SPACE_DECELERATION,
  SPACE_DISTANCE_DEFAULT,
  SPACE_DISTANCE_MAX,
  SPACE_DISTANCE_MIN,
  SPACE_DISTANCE_OVERSHOOT,
  SPACE_FOCUS_DISTANCE,
  SPACE_FRAME_DURATION_MS,
  SPACE_PITCH_INITIAL,
  SPACE_PITCH_MAX,
  SPACE_PITCH_MIN,
  SPACE_PITCH_PER_PX,
  SPACE_ROTATE_GAIN_MAX,
  SPACE_ROTATE_GAIN_MIN,
  SPACE_TAP_MAX_DISTANCE,
  SPACE_TAP_MAX_DURATION_MS,
  SPACE_YAW_PER_PX,
} from './constants'
import { framePoints, type Vec3 } from './framing'

export type SpaceCamera = {
  yaw: SharedValue<number>
  pitch: SharedValue<number>
  distance: SharedValue<number>
  /** 注視点（回転の中心）。選択中の経路の中心に置く。 */
  targetX: SharedValue<number>
  targetY: SharedValue<number>
  targetZ: SharedValue<number>
  /** 触っている間だけ 1。ラベルの薄さなどに使う。 */
  interacting: SharedValue<number>
  /**
   * カメラが最後に動いた時刻（UI スレッドの `Date.now()`）。
   * 指を離したあとも慣性（`withDecay`）やバネで動き続けるので、
   * 「まだ流れているか」はこれを見て判断する。
   * タップで語を開くかどうかの判定に使う（SpaceCanvas）。
   */
  lastMovedAt: SharedValue<number>
}

const TWO_PI = Math.PI * 2

/** `target` を `current` にいちばん近い等価な角度に寄せる（一周まわらないように）。 */
export function nearestAngle(current: number, target: number): number {
  'worklet'
  return target + TWO_PI * Math.round((current - target) / TWO_PI)
}

export type UseSpaceCameraResult = {
  camera: SpaceCamera
  gesture: ReturnType<typeof Gesture.Simultaneous>
  /** 初期姿勢（注視点は原点）に戻す。 */
  reset: () => void
  /** その語が画面の真ん中に来るように注視点を移す（検索・近傍から呼ぶ）。 */
  focusOn: (pos: readonly [number, number, number]) => void
  /** 経路が画面に収まる位置へ。`immediate` なら待たせずにその位置から始める。 */
  frameTo: (points: readonly Vec3[], immediate: boolean) => void
  /**
   * 二本指タップで呼ぶ処理。画面側が「選択中の経路に戻す」を入れる。
   * どの経路が選ばれているかはカメラの知るところではないので ref で受け取る。
   */
  onRecenterRef: MutableRefObject<() => void>
}

export function useSpaceCamera(): UseSpaceCameraResult {
  const yaw = useSharedValue(0)
  const pitch = useSharedValue(SPACE_PITCH_INITIAL)
  const distance = useSharedValue(SPACE_DISTANCE_DEFAULT)
  const targetX = useSharedValue(0)
  const targetY = useSharedValue(0)
  const targetZ = useSharedValue(0)
  const interacting = useSharedValue(0)
  const distanceStart = useSharedValue(SPACE_DISTANCE_DEFAULT)
  const lastMovedAt = useSharedValue(0)

  const onRecenterRef = useRef<() => void>(() => undefined)
  // ジェスチャの依存に入れるので、毎回作り直さない包みを 1 つだけ持つ。
  const callRecenter = useCallback(() => {
    onRecenterRef.current()
  }, [])

  // カメラが動いたフレームだけ時刻を刻む。値の和で見る（同時に打ち消し合って
  // 和が変わらないことは実質起きない）。UI スレッド内で完結するので安い。
  // 注視点も含める：寄っている最中のタップを「止める」操作として捨てるため。
  useAnimatedReaction(
    () => yaw.value + pitch.value + distance.value + targetX.value + targetY.value + targetZ.value,
    (current, previous) => {
      if (previous !== null && current !== previous) lastMovedAt.value = Date.now()
    },
  )

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .onBegin(() => {
        // 自己代入で、走っている withDecay を打ち切る（Reanimated の作法）。
        // これが無いと慣性の途中で掴んだときに二重に動く。
        // biome-ignore lint/correctness/noSelfAssign: 進行中のアニメーションを止めるための意図的な自己代入
        yaw.value = yaw.value
        // biome-ignore lint/correctness/noSelfAssign: 同上
        pitch.value = pitch.value
        interacting.value = 1
      })
      .onChange((event) => {
        // 寄るほど速く回す補正。経路に寄せたときに暴れないよう上下限で丸める。
        const gain = rotateGain(distance.value)
        yaw.value -= event.changeX * SPACE_YAW_PER_PX * gain
        pitch.value = clamp(
          pitch.value + event.changeY * SPACE_PITCH_PER_PX * gain,
          SPACE_PITCH_MIN,
          SPACE_PITCH_MAX,
        )
      })
      .onEnd((event) => {
        const gain = rotateGain(distance.value)
        yaw.value = withDecay({
          velocity: -event.velocityX * SPACE_YAW_PER_PX * gain,
          deceleration: SPACE_DECELERATION,
        })
        pitch.value = withDecay({
          velocity: event.velocityY * SPACE_PITCH_PER_PX * gain,
          deceleration: SPACE_DECELERATION,
          rubberBandEffect: true,
          clamp: [SPACE_PITCH_MIN, SPACE_PITCH_MAX],
        })
      })
      .onFinalize(() => {
        interacting.value = 0
      })

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        // biome-ignore lint/correctness/noSelfAssign: 戻りのバネを打ち切るための意図的な自己代入
        distance.value = distance.value
        distanceStart.value = distance.value
        interacting.value = 1
      })
      .onUpdate((event) => {
        // ピンチを広げる = 寄る = distance を縮める。
        const scale = event.scale <= 0 ? 1 : event.scale
        distance.value = clamp(
          distanceStart.value / scale,
          SPACE_DISTANCE_MIN / SPACE_DISTANCE_OVERSHOOT,
          SPACE_DISTANCE_MAX * SPACE_DISTANCE_OVERSHOOT,
        )
      })
      .onEnd(() => {
        const target = clamp(distance.value, SPACE_DISTANCE_MIN, SPACE_DISTANCE_MAX)
        if (target !== distance.value) distance.value = withSpring(target, SPACE_CAMERA_SPRING)
      })
      .onFinalize(() => {
        interacting.value = 0
      })

    // 二本指タップ＝「経路にもどす」。パン（1 本指）とは指の本数で分かれ、
    // ピンチとは同時に走るが、少しでも広げ／縮めれば距離の判定で落ちる。
    const recenterTap = Gesture.Tap()
      .minPointers(2)
      .maxDistance(SPACE_TAP_MAX_DISTANCE)
      .maxDuration(SPACE_TAP_MAX_DURATION_MS)
      .onEnd(() => {
        runOnJS(callRecenter)()
      })

    return Gesture.Simultaneous(pan, pinch, recenterTap)
  }, [yaw, pitch, distance, distanceStart, interacting, callRecenter])

  const reset = useCallback(() => {
    yaw.value = withSpring(nearestAngle(yaw.value, 0), SPACE_CAMERA_SPRING)
    pitch.value = withSpring(SPACE_PITCH_INITIAL, SPACE_CAMERA_SPRING)
    distance.value = withSpring(SPACE_DISTANCE_DEFAULT, SPACE_CAMERA_SPRING)
    targetX.value = withSpring(0, SPACE_CAMERA_SPRING)
    targetY.value = withSpring(0, SPACE_CAMERA_SPRING)
    targetZ.value = withSpring(0, SPACE_CAMERA_SPRING)
  }, [yaw, pitch, distance, targetX, targetY, targetZ])

  /**
   * その語を画面の真ん中に置く。
   *
   * **回さずに注視点を移す。** 以前は「その点が正面に来るようにカメラを回す」
   * だったが、宇宙ごと回るので何が起きたのか分からなくなっていた。
   */
  const focusOn = useCallback(
    (pos: readonly [number, number, number]) => {
      const [x, y, z] = pos
      targetX.value = withSpring(x, SPACE_CAMERA_SPRING)
      targetY.value = withSpring(y, SPACE_CAMERA_SPRING)
      targetZ.value = withSpring(z, SPACE_CAMERA_SPRING)
      // 引きすぎているときだけ寄る（すでに近ければそのまま）。
      if (distance.value > SPACE_FOCUS_DISTANCE) {
        distance.value = withSpring(SPACE_FOCUS_DISTANCE, SPACE_CAMERA_SPRING)
      }
    },
    [distance, targetX, targetY, targetZ],
  )

  /**
   * 経路が画面に収まる位置へカメラを置く。
   *
   * `immediate` は **図鑑を開いた最初の 1 回**に使う。アニメーションで寄せると
   * 「まず放り出されて、それから連れて行かれる」ことになり、
   * 「これは自分の軌跡だ」と分かるまでが一拍遅れる。
   */
  const frameTo = useCallback(
    (points: readonly Vec3[], immediate: boolean) => {
      const framing = framePoints(points)
      if (immediate) {
        yaw.value = framing.yaw
        pitch.value = framing.pitch
        distance.value = framing.distance
        targetX.value = framing.target[0]
        targetY.value = framing.target[1]
        targetZ.value = framing.target[2]
        return
      }
      const timing = { duration: SPACE_FRAME_DURATION_MS }
      yaw.value = withTiming(nearestAngle(yaw.value, framing.yaw), timing)
      pitch.value = withTiming(framing.pitch, timing)
      distance.value = withTiming(framing.distance, timing)
      targetX.value = withTiming(framing.target[0], timing)
      targetY.value = withTiming(framing.target[1], timing)
      targetZ.value = withTiming(framing.target[2], timing)
    },
    [yaw, pitch, distance, targetX, targetY, targetZ],
  )

  return {
    camera: { yaw, pitch, distance, targetX, targetY, targetZ, interacting, lastMovedAt },
    gesture,
    reset,
    focusOn,
    frameTo,
    onRecenterRef,
  }
}

/** 寄り具合に応じた回転の倍率。上下限で丸める（寄せたときに暴れさせない）。 */
function rotateGain(distance: number): number {
  'worklet'
  return clamp(SPACE_DISTANCE_DEFAULT / distance, SPACE_ROTATE_GAIN_MIN, SPACE_ROTATE_GAIN_MAX)
}
