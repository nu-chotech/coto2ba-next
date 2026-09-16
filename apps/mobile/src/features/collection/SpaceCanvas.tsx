/**
 * 図鑑の 2.5D レンダラ（SPEC §9.2）。
 *
 * - 全画面 Skia Canvas。点は **`Atlas` で 1 ドロー**（1 点 1 コンポーネントにしない）。
 *   白いドットのテクスチャ 1 枚を `colors` + `BlendMode.SrcIn` で点ごとに着色する。
 * - 変換は `useRSXformBuffer`、色は `useColorBuffer`。どちらも UI スレッドで
 *   あらかじめ確保されたネイティブバッファを書き換えるだけ（毎フレーム確保しない）。
 * - **worklet に JS の配列/オブジェクトを取り込まない。** 座標は `Float32Array` を
 *   共有値に入れて渡す（取り込むと worklet を作り直すたびにディープコピーされる）。
 * - 深度ソートは毎フレーム。比較ソートではなく計数ソート（`orderByDepth`）。
 *   変換用と色用の 2 つの mapper はそれぞれ独立に並べ替えるが、Reanimated は
 *   dirty な mapper を **1 回の走査でまとめて実行する**ので、同じフレームでは
 *   同じカメラ値を読む＝順序は必ず一致する（色と位置がずれない）。
 *
 * ラベルは Skia では描かない。Skia のフォント登録には Noto Sans JP が要るが
 * 依存に無いため、RN の `<Text>` を Canvas の上に絶対配置する（`SpaceLabels`）。
 *
 * **このコンポーネントは `scene` の識別子で key を付けて使うこと。**
 * 点の数が変わると共有値・バッファ・作業領域の長さが食い違うので、
 * シーンが差し替わったら作り直すのがいちばん安全（差し替えは読み込み時の 1 回だけ）。
 */

import { SPACE_FOCAL, SPACE_TAP_RADIUS } from '@coto2ba/contracts'
import {
  Atlas,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  rect,
  Skia,
  type SkPath,
  useColorBuffer,
  useRSXformBuffer,
  useTexture,
  vec,
} from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { type ComposedGesture, Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated'
import { palette, tierPalettes } from '../../theme'
import type { SpaceCamera } from './camera'
import {
  SPACE_DOT_TEXTURE_SIZE,
  SPACE_GOAL_RING_SCALE,
  SPACE_NEAR_PLANE,
  SPACE_PATH_ALPHA,
  SPACE_PATH_HIGHLIGHT_WIDTH,
  SPACE_PATH_WIDTH,
  SPACE_RING_WIDTH,
  SPACE_WORLD_SCALE,
} from './constants'
import { DEPTH_BUCKETS, nearestIndex, orderByDepth, projectAll, projectOne } from './projection'
import type { SpaceScene } from './scene'

const DOT = SPACE_DOT_TEXTURE_SIZE
const DOT_RADIUS = DOT / 2
/** 画面外に逃がすときの座標。 */
const OFFSCREEN = -DOT * 4

export type SpaceCanvasProps = {
  scene: SpaceScene
  camera: SpaceCamera
  /** パン + ピンチ（`useSpaceCamera` が返すもの）。タップはここで足す。 */
  gesture: ComposedGesture
  /** 点に当たったときに呼ばれる。外れたら -1。 */
  onHit: (index: number) => void
  /** 強調する点（シートで開いている語）。-1 なら無し。 */
  selectedIndex: number
  /** レイアウトが決まったら知らせる（ラベルの計算に使う）。 */
  onResize?: (width: number, height: number) => void
}

/** 経路を「インデックスの列 + 区切り位置」に平たくする（worklet に渡すため）。 */
function flattenPaths(scene: SpaceScene): { indices: Float32Array; offsets: Float32Array } {
  let total = 0
  for (const path of scene.paths) total += path.indices.length
  const indices = new Float32Array(total)
  const offsets = new Float32Array(scene.paths.length + 1)
  let cursor = 0
  for (let p = 0; p < scene.paths.length; p += 1) {
    offsets[p] = cursor
    const source = scene.paths[p]?.indices
    if (source === undefined) continue
    for (let k = 0; k < source.length; k += 1) {
      indices[cursor] = source[k] as number
      cursor += 1
    }
  }
  offsets[scene.paths.length] = cursor
  return { indices, offsets }
}

export function SpaceCanvas({
  scene,
  camera,
  gesture,
  onHit,
  selectedIndex,
  onResize,
}: SpaceCanvasProps) {
  const count = scene.count

  // ── 画面サイズ ────────────────────────────────────────────
  const viewWidth = useSharedValue(0)
  const viewHeight = useSharedValue(0)

  // ── 点のデータ（マウント時に固定。scene が変わったら key で作り直す）──
  const xyz = useSharedValue(scene.xyz)
  const rgb = useSharedValue(scene.rgb)
  const baseAlpha = useSharedValue(scene.baseAlpha)
  const sizePt = useSharedValue(scene.sizePt)

  const paths = useMemo(() => flattenPaths(scene), [scene])
  const pathIndices = useSharedValue(paths.indices)
  const pathOffsets = useSharedValue(paths.offsets)

  const selected = useSharedValue(selectedIndex)
  useEffect(() => {
    selected.value = selectedIndex
  }, [selectedIndex, selected])
  const goal = useSharedValue(scene.goalIndex)
  const interactiveCount = useSharedValue(scene.interactiveCount)

  // ── 毎フレームの作業領域（mapper ごとに別々に持つ）──────────
  const transformScratch = useFrameScratch(count)
  const colorScratch = useFrameScratch(count)

  // ── ドットのテクスチャ（白 + 放射グラデーション）────────────
  const texture = useTexture(
    <Group>
      <Circle cx={DOT_RADIUS} cy={DOT_RADIUS} r={DOT_RADIUS}>
        <RadialGradient
          c={vec(DOT_RADIUS, DOT_RADIUS)}
          r={DOT_RADIUS}
          colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
          positions={[0, 0.5, 1]}
        />
      </Circle>
    </Group>,
    { width: DOT, height: DOT },
  )

  // 全インスタンスが同じ矩形を見る。オブジェクトは 1 つで足りる。
  const sprites = useMemo(() => new Array(count).fill(rect(0, 0, DOT, DOT)), [count])

  // ── 変換バッファ（ホットパス）──────────────────────────────
  const transforms = useRSXformBuffer(count, (val, index) => {
    'worklet'
    const width = viewWidth.value
    const height = viewHeight.value
    if (width <= 0 || height <= 0) {
      val.set(0, 0, OFFSCREEN, OFFSCREEN)
      return
    }
    // index 0 で 1 フレームぶんまとめて計算する（点ごとに再計算しない）。
    if (index === 0) {
      projectAll(
        xyz.value,
        count,
        camera.yaw.value,
        camera.pitch.value,
        camera.distance.value,
        width / 2,
        height / 2,
        Math.min(width, height) * SPACE_WORLD_SCALE,
        transformScratch.screen.value,
        transformScratch.sizeMul.value,
        transformScratch.alphaMul.value,
        transformScratch.depth.value,
      )
      orderByDepth(
        transformScratch.depth.value,
        count,
        camera.distance.value,
        transformScratch.buckets.value,
        transformScratch.order.value,
      )
    }

    const point = transformScratch.order.value[index]
    const depthScale = transformScratch.sizeMul.value[point]
    if (depthScale <= 0) {
      val.set(0, 0, OFFSCREEN, OFFSCREEN)
      return
    }
    const scale = (sizePt.value[point] * depthScale) / DOT
    const half = DOT_RADIUS * scale
    val.set(
      scale,
      0,
      transformScratch.screen.value[point * 2] - half,
      transformScratch.screen.value[point * 2 + 1] - half,
    )
  })

  // ── 色バッファ（深度でアルファを落とす）────────────────────
  const colors = useColorBuffer(count, (val, index) => {
    'worklet'
    const width = viewWidth.value
    const height = viewHeight.value
    if (width <= 0 || height <= 0) {
      val[3] = 0
      return
    }
    if (index === 0) {
      projectAll(
        xyz.value,
        count,
        camera.yaw.value,
        camera.pitch.value,
        camera.distance.value,
        width / 2,
        height / 2,
        Math.min(width, height) * SPACE_WORLD_SCALE,
        colorScratch.screen.value,
        colorScratch.sizeMul.value,
        colorScratch.alphaMul.value,
        colorScratch.depth.value,
      )
      orderByDepth(
        colorScratch.depth.value,
        count,
        camera.distance.value,
        colorScratch.buckets.value,
        colorScratch.order.value,
      )
    }

    const point = colorScratch.order.value[index]
    val[0] = rgb.value[point * 3]
    val[1] = rgb.value[point * 3 + 1]
    val[2] = rgb.value[point * 3 + 2]
    val[3] = baseAlpha.value[point] * colorScratch.alphaMul.value[point]
  })

  // ── 経路（クリア済みゲームの start → result… → goal）────────
  const routePath = useDerivedValue<SkPath>(() => {
    const path = Skia.Path.Make()
    const width = viewWidth.value
    const height = viewHeight.value
    const offsets = pathOffsets.value
    if (width <= 0 || height <= 0 || offsets.length < 2) return path

    const points = xyz.value
    const indices = pathIndices.value
    const worldScale = Math.min(width, height) * SPACE_WORLD_SCALE
    const centerX = width / 2
    const centerY = height / 2
    const distance = camera.distance.value
    const cosYaw = Math.cos(camera.yaw.value)
    const sinYaw = Math.sin(camera.yaw.value)
    const cosPitch = Math.cos(camera.pitch.value)
    const sinPitch = Math.sin(camera.pitch.value)

    for (let p = 0; p + 1 < offsets.length; p += 1) {
      const from = offsets[p]
      const to = offsets[p + 1]
      let started = false
      for (let k = from; k < to; k += 1) {
        const index = indices[k]
        const x = points[index * 3]
        const y = points[index * 3 + 1]
        const z = points[index * 3 + 2]
        const x1 = x * cosYaw + z * sinYaw
        const z1 = -x * sinYaw + z * cosYaw
        const y1 = y * cosPitch - z1 * sinPitch
        const z2 = y * sinPitch + z1 * cosPitch
        const d = z2 + distance
        if (d <= SPACE_NEAR_PLANE) {
          started = false
          continue
        }
        const scale = (SPACE_FOCAL / d) * worldScale
        const sx = centerX + x1 * scale
        const sy = centerY - y1 * scale
        if (started) path.lineTo(sx, sy)
        else {
          path.moveTo(sx, sy)
          started = true
        }
      }
    }
    return path
  })

  // ── 強調する点（選択中 / 今日のゴール）──────────────────────
  const selectedRing = useRing(selected, xyz, sizePt, camera, viewWidth, viewHeight, 1.8)
  const goalRing = useRing(goal, xyz, sizePt, camera, viewWidth, viewHeight, SPACE_GOAL_RING_SCALE)

  // ── タップ ────────────────────────────────────────────────
  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd((event) => {
        'worklet'
        const hit = nearestIndex(
          transformScratch.screen.value,
          transformScratch.sizeMul.value,
          interactiveCount.value,
          event.x,
          event.y,
          SPACE_TAP_RADIUS,
        )
        runOnJS(onHit)(hit)
      }),
    [transformScratch, interactiveCount, onHit],
  )

  const composed = useMemo(() => Gesture.Simultaneous(gesture, tap), [gesture, tap])

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    viewWidth.value = width
    viewHeight.value = height
    onResize?.(width, height)
  }

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.root} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Path
            path={routePath}
            style="stroke"
            strokeWidth={SPACE_PATH_WIDTH}
            color={palette.tiers.cosmos.accent}
            opacity={SPACE_PATH_ALPHA}
          />
          {count > 0 ? (
            <Atlas
              image={texture}
              sprites={sprites}
              transforms={transforms}
              colors={colors}
              colorBlendMode="srcIn"
            />
          ) : null}
          <Circle
            cx={goalRing.cx}
            cy={goalRing.cy}
            r={goalRing.r}
            color={tierPalettes.gold.accent}
            style="stroke"
            strokeWidth={SPACE_PATH_HIGHLIGHT_WIDTH}
          />
          <Circle
            cx={selectedRing.cx}
            cy={selectedRing.cy}
            r={selectedRing.r}
            color={palette.white}
            style="stroke"
            strokeWidth={SPACE_RING_WIDTH}
          />
        </Canvas>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})

// ── 補助フック ──────────────────────────────────────────────

/** 1 フレームぶんの作業領域。長さはマウント時の `count` で固定する。 */
function useFrameScratch(count: number) {
  const screen = useSharedValue(new Float32Array(count * 2))
  const sizeMul = useSharedValue(new Float32Array(count))
  const alphaMul = useSharedValue(new Float32Array(count))
  const depth = useSharedValue(new Float32Array(count))
  const order = useSharedValue(new Float32Array(count))
  const buckets = useSharedValue(new Float32Array(DEPTH_BUCKETS))
  return { screen, sizeMul, alphaMul, depth, order, buckets }
}

/**
 * 1 点だけを追いかける輪。
 * カメラの共有値を読むことで毎フレーム作り直される（`Float32Array` の中身を
 * 書き換えただけでは Reanimated は再計算しないため、トリガはカメラ側に置く）。
 */
function useRing(
  indexValue: SharedValue<number>,
  xyz: SharedValue<Float32Array>,
  sizePt: SharedValue<Float32Array>,
  camera: SpaceCamera,
  viewWidth: SharedValue<number>,
  viewHeight: SharedValue<number>,
  ringScale: number,
) {
  const projected = useDerivedValue(() => {
    const out = new Float32Array(4)
    const width = viewWidth.value
    const height = viewHeight.value
    if (width <= 0 || height <= 0) return out
    projectOne(
      xyz.value,
      indexValue.value,
      camera.yaw.value,
      camera.pitch.value,
      camera.distance.value,
      width / 2,
      height / 2,
      Math.min(width, height) * SPACE_WORLD_SCALE,
      out,
    )
    return out
  })

  const cx = useDerivedValue(() =>
    projected.value[2] > 0 ? (projected.value[0] as number) : OFFSCREEN,
  )
  const cy = useDerivedValue(() =>
    projected.value[2] > 0 ? (projected.value[1] as number) : OFFSCREEN,
  )
  const r = useDerivedValue(() => {
    const index = indexValue.value
    const depthScale = projected.value[2] as number
    if (index < 0 || depthScale <= 0) return 0
    return ((sizePt.value[index] as number) * depthScale * ringScale) / 2
  })

  return { cx, cy, r }
}
