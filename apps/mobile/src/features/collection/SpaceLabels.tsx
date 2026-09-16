/**
 * 図鑑の和文ラベル（SPEC §9.2）。
 *
 * **Skia では描かない。** Skia のフォントは expo-font とは別の登録が要り、
 * `@expo-google-fonts/noto-sans-jp` は依存に無い（増やさない方針）。
 * 代わりに RN の `<Text>` を Canvas の上に絶対配置する。システムフォントなので
 * 和文がいちばん綺麗に出る、という副作用もある。
 *
 * 出すのは **画面上でカメラに近い上位 `SPACE_LABEL_LIMIT`（40）語**だけ。
 * 位置は JS スレッドで計算するので、カメラの値は `SPACE_LABEL_UPDATE_MS` ごとに
 * 間引いて受け取る（毎フレーム JS に渡すと図鑑が重くなる）。回転中はラベルが
 * わずかに遅れて追いつくが、点の描画（UI スレッド）は 60fps のまま。
 */

import { SPACE_LABEL_LIMIT } from '@coto2ba/contracts'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { typography } from '../../theme'
import type { SpaceCamera } from './camera'
import {
  SPACE_LABEL_MARGIN,
  SPACE_LABEL_MAX_WIDTH,
  SPACE_LABEL_OFFSET_Y,
  SPACE_LABEL_UPDATE_MS,
  SPACE_WORLD_SCALE,
} from './constants'
import { projectAll } from './projection'
import type { SpaceScene } from './scene'

type CameraSnapshot = { yaw: number; pitch: number; distance: number }

type PlacedLabel = { word: string; x: number; y: number; opacity: number }

export type SpaceLabelsProps = {
  scene: SpaceScene
  camera: SpaceCamera
  width: number
  height: number
  color: string
}

export function SpaceLabels({ scene, camera, width, height, color }: SpaceLabelsProps) {
  const limit = scene.interactiveCount
  const [snapshot, setSnapshot] = useState<CameraSnapshot>({ yaw: 0, pitch: 0, distance: 0 })
  const lastPushedAt = useSharedValue(0)

  // JS 側の作業領域。毎回確保しない。
  const scratch = useMemo(
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
      width / 2,
      height / 2,
      Math.min(width, height) * SPACE_WORLD_SCALE,
      scratch.screen,
      scratch.sizeMul,
      scratch.alphaMul,
      scratch.depth,
    )

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
      word: scene.nodes[index]?.word ?? '',
      x: scratch.screen[index * 2] as number,
      y: (scratch.screen[index * 2 + 1] as number) + SPACE_LABEL_OFFSET_Y,
      opacity: scratch.alphaMul[index] as number,
    }))
  }, [scene, limit, snapshot, width, height, scratch])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {labels.map((label) => (
        <Text
          key={label.word}
          numberOfLines={1}
          style={[
            typography.label,
            styles.label,
            {
              color,
              opacity: label.opacity,
              left: label.x - SPACE_LABEL_MAX_WIDTH / 2,
              top: label.y,
            },
          ]}
        >
          {label.word}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    width: SPACE_LABEL_MAX_WIDTH,
    textAlign: 'center',
  },
})
