/**
 * 図鑑の和文ラベル（SPEC §9.2）。
 *
 * **Skia では描かない。** Skia のフォントは expo-font とは別の登録が要り、
 * `@expo-google-fonts/noto-sans-jp` は依存に無い（増やさない方針）。
 * 代わりに RN の `<Text>` を Canvas の上に絶対配置する。システムフォントなので
 * 和文がいちばん綺麗に出る、という副作用もある。
 *
 * **経路を選んでいる間は、その経路の節だけを出す。** 図鑑の主役は自分の軌跡なので、
 * 語を撒き散らさずに「スタート → 1手目 → … → 到達」が読めることを優先する。
 * 経路を選んでいないときだけ、画面上でカメラに近い上位 `SPACE_LABEL_LIMIT`（40）語を出す。
 *
 * 位置は JS スレッドで計算するので、カメラの値は `SPACE_LABEL_UPDATE_MS` ごとに
 * 間引いて受け取る（毎フレーム JS に渡すと図鑑が重くなる）。回転中はラベルが
 * わずかに遅れて追いつくが、点の描画（UI スレッド）は 60fps のまま。
 */

import { SPACE_LABEL_LIMIT } from '@coto2ba/contracts'
import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { borderWidth, spacing, typography } from '../../theme'
import type { SpaceCamera } from './camera'
import {
  SPACE_LABEL_MARGIN,
  SPACE_LABEL_MAX_WIDTH,
  SPACE_LABEL_OFFSET_Y,
  SPACE_LABEL_UPDATE_MS,
  SPACE_PATH_LABEL_MIN_OPACITY,
  SPACE_WORLD_SCALE,
} from './constants'
import { type CameraSnapshot, labelWidth, sameCamera, stackLabelY, stepLabel } from './paths'
import { projectAll } from './projection'
import type { SpacePath, SpaceScene } from './scene'

/** JS 側の作業領域（毎回確保しない）。 */
type Scratch = {
  screen: Float32Array
  sizeMul: Float32Array
  alphaMul: Float32Array
  depth: Float32Array
}

/** まだ何も届いていない状態。`distance === 0` の間はラベルを出さない。 */
const STILL_CAMERA: CameraSnapshot = {
  yaw: 0,
  pitch: 0,
  distance: 0,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
}

type PlacedLabel = {
  id: string
  word: string
  /** 経路の節なら「スタート」「2手目」「到達」。それ以外は null。 */
  step: string | null
  x: number
  y: number
  /** 衝突判定に使う横幅。 */
  width: number
  /**
   * 重なりを避けて下にずらしたとき、引き出し線を引き始める y。
   * ずらしていなければ null（線は引かない）。
   */
  leaderTop: number | null
  opacity: number
}

export type SpaceLabelsProps = {
  scene: SpaceScene
  camera: SpaceCamera
  width: number
  height: number
  color: string
  /** 補助の文字色（手数の添え字）。 */
  subColor: string
  /** 選択中の経路。無ければ null。 */
  activePath: SpacePath | null
}

export function SpaceLabels({
  scene,
  camera,
  width,
  height,
  color,
  subColor,
  activePath,
}: SpaceLabelsProps) {
  const limit = scene.interactiveCount
  const [snapshot, setSnapshot] = useState<CameraSnapshot>(STILL_CAMERA)

  const scratch = useMemo<Scratch>(
    () => ({
      screen: new Float32Array(limit * 2),
      sizeMul: new Float32Array(limit),
      alphaMul: new Float32Array(limit),
      depth: new Float32Array(limit),
    }),
    [limit],
  )

  /**
   * カメラの購読。**UI スレッドのフレームループから間引いて送る。**
   *
   * 2 つ試してどちらも駄目だったので、この形に落ち着いた（実 Skia の Web で確認）:
   * - `useAnimatedReaction`：**mapper が最初の 1 回しか走らない**。経路を切り替えても
   *   指で回してもラベルが前の位置に固まる（この差分の前はこれで壊れていた）
   * - JS スレッドから `camera.yaw.value` を定期的に読む：**JS 側から書いた値しか見えない**。
   *   初回の `frameTo(immediate)`（JS からの代入）は反映されるが、`withTiming` や
   *   ジェスチャ（UI スレッドの書き込み）は届かない
   *
   * `useFrameCallback` は UI 側の `requestAnimationFrame` ループなので、
   * どちらの問題も踏まない。**間引きと trailing（最後の 1 回）を同時に満たす**のも大事で、
   * 「間引いて捨てる」実装だと慣性が止まった最後の 110ms ぶんが永久に届かず、
   * ラベルが恒常的に節からずれる。ここは毎フレーム見に行くので、
   * 動きが止まった直後のフレームで必ず最新が送られる。
   */
  const { yaw, pitch, distance, targetX, targetY, targetZ } = camera
  const lastPushedAt = useSharedValue(0)
  const pushed = useSharedValue<CameraSnapshot>(STILL_CAMERA)

  /**
   * **`useCallback` で包むこと。** `useFrameCallback` は
   * `useEffect(..., [callback])` で登録し直すので、包まないと**毎レンダで
   * 登録し直し**になる。実 Skia の Web では、経路を切り替えた直後の
   * 連続したレンダでフレームループが止まり、ラベルが更新されなくなった。
   */
  const pushCamera = useCallback(() => {
    'worklet'
    const now = Date.now()
    if (now - lastPushedAt.value < SPACE_LABEL_UPDATE_MS) return
    const next = {
      yaw: yaw.value,
      pitch: pitch.value,
      distance: distance.value,
      targetX: targetX.value,
      targetY: targetY.value,
      targetZ: targetZ.value,
    }
    if (sameCamera(pushed.value, next)) return
    lastPushedAt.value = now
    pushed.value = next
    runOnJS(setSnapshot)(next)
  }, [yaw, pitch, distance, targetX, targetY, targetZ, lastPushedAt, pushed])

  useFrameCallback(pushCamera)

  const labels = useMemo<PlacedLabel[]>(() => {
    if (limit === 0 || width <= 0 || height <= 0 || snapshot.distance <= 0) return []
    projectAll(
      scene.xyz,
      limit,
      snapshot.yaw,
      snapshot.pitch,
      snapshot.distance,
      snapshot.targetX,
      snapshot.targetY,
      snapshot.targetZ,
      width / 2,
      height / 2,
      Math.min(width, height) * SPACE_WORLD_SCALE,
      scratch.screen,
      scratch.sizeMul,
      scratch.alphaMul,
      scratch.depth,
    )

    // ── 経路を選んでいるとき：その節だけを、順番つきで出す ──
    if (activePath !== null && activePath.indices.length > 0) {
      const placed: PlacedLabel[] = []
      const place = (index: number, id: string, word: string, step: string | null) => {
        if (index < 0 || index >= limit) return
        if (scratch.sizeMul[index] <= 0) return
        const x = scratch.screen[index * 2] as number
        const y = scratch.screen[index * 2 + 1] as number
        // 画面の外に出た節のラベルは出さない（見えていない点の名前は邪魔なだけ）。
        if (x < -SPACE_LABEL_MARGIN || x > width + SPACE_LABEL_MARGIN) return
        if (y < -SPACE_LABEL_MARGIN || y > height + SPACE_LABEL_MARGIN) return
        const top = labelY(scene, scratch, index)
        const box = { x, y: top, width: labelWidth(word, step) }
        const stacked = stackLabelY(placed, box)
        placed.push({
          id,
          word,
          step,
          x,
          y: stacked,
          width: box.width,
          // ずらしたぶんは引き出し線で節と繋ぐ（浮いたラベルにしない）。
          leaderTop: stacked > top ? top : null,
          // 主役なので、奥に回っても読める下限を持たせる。
          opacity: Math.max(scratch.alphaMul[index] as number, SPACE_PATH_LABEL_MIN_OPACITY),
        })
      }

      for (let k = 0; k < activePath.indices.length; k += 1) {
        const index = activePath.indices[k] as number
        const node = scene.nodes[index]
        if (node === undefined || node.word.length === 0) continue
        // 手数は**元の経路での添字**で数える（座標の無い語が落ちてもずれない）。
        const step = stepLabel(activePath.steps[k] as number, activePath.totalSteps)
        place(index, `${k}:${node.word}`, node.word, step)
      }

      // 今日のゴールが経路の外にあるときだけ、金の輪が何なのかを添える。
      const goalWord = scene.nodes[scene.goalIndex]?.word
      if (
        scene.goalIndex >= 0 &&
        goalWord !== undefined &&
        goalWord.length > 0 &&
        !activePath.indices.includes(scene.goalIndex)
      ) {
        place(scene.goalIndex, `goal:${goalWord}`, goalWord, '今日のゴール')
      }
      return placed
    }

    // ── 経路を選んでいないとき：手前の語から数語 ──
    const visible: { index: number; depth: number }[] = []
    for (let i = 0; i < limit; i += 1) {
      if (scratch.sizeMul[i] <= 0) continue
      const node = scene.nodes[i]
      if (node === undefined || node.word.length === 0) continue
      const x = scratch.screen[i * 2] as number
      const y = scratch.screen[i * 2 + 1] as number
      if (x < -SPACE_LABEL_MARGIN || x > width + SPACE_LABEL_MARGIN) continue
      if (y < -SPACE_LABEL_MARGIN || y > height + SPACE_LABEL_MARGIN) continue
      visible.push({ index: i, depth: scratch.depth[i] as number })
    }
    visible.sort((a, b) => a.depth - b.depth)

    return visible.slice(0, SPACE_LABEL_LIMIT).map(({ index }) => ({
      id: `${index}`,
      word: scene.nodes[index]?.word ?? '',
      step: null,
      x: scratch.screen[index * 2] as number,
      y: labelY(scene, scratch, index),
      width: labelWidth(scene.nodes[index]?.word ?? '', null),
      leaderTop: null,
      opacity: scratch.alphaMul[index] as number,
    }))
  }, [scene, limit, snapshot, width, height, scratch, activePath])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* ずらしたラベルと節を繋ぐ細い線。節と同じ色なので主役の線には混ざらない。 */}
      {labels.map((label) =>
        label.leaderTop === null ? null : (
          <View
            key={`leader:${label.id}`}
            style={[
              styles.leader,
              {
                left: label.x,
                top: label.leaderTop,
                height: label.y - label.leaderTop,
                backgroundColor: subColor,
                opacity: label.opacity,
              },
            ]}
          />
        ),
      )}
      {labels.map((label) => (
        <View
          key={label.id}
          style={[
            styles.item,
            { opacity: label.opacity, left: label.x - SPACE_LABEL_MAX_WIDTH / 2, top: label.y },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              label.step === null ? typography.label : typography.body,
              styles.text,
              { color },
            ]}
          >
            {label.word}
          </Text>
          {label.step !== null ? (
            <Text numberOfLines={1} style={[typography.label, styles.text, { color: subColor }]}>
              {label.step}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/**
 * ラベルの上端。**点の半径ぶん下げる**。
 * 固定の値だけだと、大きい点（今日のゴール・経路の節）では文字が点に乗る。
 */
function labelY(scene: SpaceScene, scratch: Scratch, index: number): number {
  const radius = ((scene.sizePt[index] as number) * (scratch.sizeMul[index] as number)) / 2
  return (scratch.screen[index * 2 + 1] as number) + radius + SPACE_LABEL_OFFSET_Y
}

const styles = StyleSheet.create({
  item: {
    position: 'absolute',
    width: SPACE_LABEL_MAX_WIDTH,
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { textAlign: 'center' },
  leader: { position: 'absolute', width: borderWidth.hairline },
})
