/**
 * 図鑑のオービットカメラ（yaw / pitch / distance）。
 *
 * - パン（1 本指）→ yaw / pitch。離すと `withDecay` で滑る。
 * - ピンチ → distance。行き過ぎを許してバネで戻す。
 * - `Gesture.Simultaneous` で同時に効く。
 *
 * 注意（docs/research/rn-game-ui.md）：
 * - `.onBegin` の自己代入で **走っている慣性を打ち切る**。無いと掴んだときに二重に動く。
 * - パンは `.minPointers(1).maxPointers(1)`。しないと 2 本目の指の動きがパンに漏れる。
 */

import { useCallback, useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import {
  clamp,
  type SharedValue,
  useSharedValue,
  withDecay,
  withSpring,
} from 'react-native-reanimated'
import {
  SPACE_CAMERA_SPRING,
  SPACE_DECELERATION,
  SPACE_DISTANCE_DEFAULT,
  SPACE_DISTANCE_MAX,
  SPACE_DISTANCE_MIN,
  SPACE_DISTANCE_OVERSHOOT,
  SPACE_FOCUS_DISTANCE,
  SPACE_PITCH_INITIAL,
  SPACE_PITCH_MAX,
  SPACE_PITCH_MIN,
  SPACE_PITCH_PER_PX,
  SPACE_YAW_PER_PX,
} from './constants'

export type SpaceCamera = {
  yaw: SharedValue<number>
  pitch: SharedValue<number>
  distance: SharedValue<number>
  /** 触っている間だけ 1。ラベルの薄さなどに使う。 */
  interacting: SharedValue<number>
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
  /** 初期姿勢に戻す。 */
  reset: () => void
  /** その座標が正面かつ手前に来るようにカメラを回す（検索・選択から呼ぶ）。 */
  focusOn: (pos: readonly [number, number, number]) => void
}

export function useSpaceCamera(): UseSpaceCameraResult {
  const yaw = useSharedValue(0)
  const pitch = useSharedValue(SPACE_PITCH_INITIAL)
  const distance = useSharedValue(SPACE_DISTANCE_DEFAULT)
  const interacting = useSharedValue(0)
  const distanceStart = useSharedValue(SPACE_DISTANCE_DEFAULT)

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
        // distance で割ると、どの寄り具合でも指の動きと 1:1 に感じる。
        const gain = SPACE_DISTANCE_DEFAULT / distance.value
        yaw.value -= event.changeX * SPACE_YAW_PER_PX * gain
        pitch.value = clamp(
          pitch.value + event.changeY * SPACE_PITCH_PER_PX * gain,
          SPACE_PITCH_MIN,
          SPACE_PITCH_MAX,
        )
      })
      .onEnd((event) => {
        const gain = SPACE_DISTANCE_DEFAULT / distance.value
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

    return Gesture.Simultaneous(pan, pinch)
  }, [yaw, pitch, distance, distanceStart, interacting])

  const reset = useCallback(() => {
    yaw.value = withSpring(nearestAngle(yaw.value, 0), SPACE_CAMERA_SPRING)
    pitch.value = withSpring(SPACE_PITCH_INITIAL, SPACE_CAMERA_SPRING)
    distance.value = withSpring(SPACE_DISTANCE_DEFAULT, SPACE_CAMERA_SPRING)
  }, [yaw, pitch, distance])

  const focusOn = useCallback(
    (pos: readonly [number, number, number]) => {
      const [x, y, z] = pos
      const radial = Math.sqrt(x * x + z * z)
      // yaw = atan2(-x, z) + π で、その点が画面中央の **手前側** に来る。
      const targetYaw = Math.atan2(-x, z) + Math.PI
      const targetPitch = clamp(Math.atan2(-y, radial), SPACE_PITCH_MIN, SPACE_PITCH_MAX)
      yaw.value = withSpring(nearestAngle(yaw.value, targetYaw), SPACE_CAMERA_SPRING)
      pitch.value = withSpring(targetPitch, SPACE_CAMERA_SPRING)
      // 寄りすぎているときだけ引く（すでに近ければそのまま）。
      if (distance.value > SPACE_FOCUS_DISTANCE) {
        distance.value = withSpring(SPACE_FOCUS_DISTANCE, SPACE_CAMERA_SPRING)
      }
    },
    [yaw, pitch, distance],
  )

  return { camera: { yaw, pitch, distance, interacting }, gesture, reset, focusOn }
}
