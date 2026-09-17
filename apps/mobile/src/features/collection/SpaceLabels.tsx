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
import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { spacing, typography } from '../../theme'
import type { SpaceCamera } from './camera'
import {
  SPACE_LABEL_MARGIN,
  SPACE_LABEL_MAX_WIDTH,
  SPACE_LABEL_OFFSET_Y,
  SPACE_LABEL_UPDATE_MS,
  SPACE_PATH_LABEL_MIN_OPACITY,
  SPACE_WORLD_SCALE,
} from './constants'
import { stackLabelY, stepLabel } from './paths'
import { projectAll } from './projection'
import type { SpaceScene } from './scene'

type CameraSnapshot = {
  yaw: number
  pitch: number
  distance: number
  targetX: number
  targetY: number
  targetZ: number
}

/** JS 側の作業領域（毎回確保しない）。 */
type Scratch = {
  screen: Float32Array
  sizeMul: Float32Array
  alphaMul: Float32Array
  depth: Float32Array
}

type PlacedLabel = {
  id: string
  word: string
  /** 経路の節なら「スタート」「2手目」「到達」。それ以外は null。 */
  step: string | null
  x: number
  y: number
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
  /** 選択中の経路の点のインデックス列。無ければ null。 */
  activePath: Int32Array | null
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
  const [snapshot, setSnapshot] = useState<CameraSnapshot>({
    yaw: 0,
    pitch: 0,
    distance: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  })
  const lastPushedAt = useSharedValue(0)

  const scratch = useMemo<Scratch>(
    () => ({
      screen: new Float32Array(limit * 2),
      sizeMul: new Float32Array(limit),
      alphaMul: new Float32Array(limit),
      depth: new Float32Array(limit),
    }),
    [limit],
  )

  useAnimatedReaction(
    () => ({
      yaw: camera.yaw.value,
      pitch: camera.pitch.value,
      distance: camera.distance.value,
      targetX: camera.targetX.value,
      targetY: camera.targetY.value,
      targetZ: camera.targetZ.value,
    }),
    (current) => {
      const now = Date.now()
      if (now - lastPushedAt.value < SPACE_LABEL_UPDATE_MS) return
      lastPushedAt.value = now
      runOnJS(setSnapshot)(current)
    },
  )

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
    if (activePath !== null && activePath.length > 0) {
      const placed: PlacedLabel[] = []
      for (let k = 0; k < activePath.length; k += 1) {
        const index = activePath[k] as number
        if (index < 0 || index >= limit) continue
        if (scratch.sizeMul[index] <= 0) continue
        const node = scene.nodes[index]
        if (node === undefined || node.word.length === 0) continue
        const x = scratch.screen[index * 2] as number
        placed.push({
          // 同じ語を 2 度通る経路があるので、順番も鍵に混ぜる。
          id: `${k}:${node.word}`,
          word: node.word,
          step: stepLabel(k, activePath.length),
          x,
          y: stackLabelY(
            placed,
            x,
            (scratch.screen[index * 2 + 1] as number) + SPACE_LABEL_OFFSET_Y,
          ),
          // 主役なので、奥に回っても読める下限を持たせる。
          opacity: Math.max(scratch.alphaMul[index] as number, SPACE_PATH_LABEL_MIN_OPACITY),
        })
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
      opacity: scratch.alphaMul[index] as number,
    }))
  }, [scene, limit, snapshot, width, height, scratch, activePath])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
})
