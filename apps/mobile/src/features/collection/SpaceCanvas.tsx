/**
 * 図鑑の 2.5D レンダラ（SPEC §9.2）。
 *
 * **主役は点群ではなく「選択中の経路」。** `start → 各手` を太い折れ線で描いて
 * 発光させ、節に輪を打つ。所持語・ゴースト点は背景に降格する（`paths.ts` の
 * `buildEmphasis` が点ごとの濃さとサイズの倍率を作る）。
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

import { SPACE_TAP_RADIUS } from '@coto2ba/contracts'
import {
  Atlas,
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
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
// 図鑑は宇宙なので、ライトモードでも暗いまま（意図的な例外、SPEC §4.3）。
// 色はダーク固定の互換シムから取る。
import { palette, tierPalettes } from '../../theme'
import type { SpaceCamera } from './camera'
import {
  SPACE_DOT_TEXTURE_SIZE,
  SPACE_GOAL_RING_SCALE,
  SPACE_GOAL_RING_WIDTH,
  SPACE_PATH_ACTIVE_WIDTH,
  SPACE_PATH_ALPHA,
  SPACE_PATH_END_RING_SCALE,
  SPACE_PATH_END_RING_WIDTH,
  SPACE_PATH_GLOW_ALPHA,
  SPACE_PATH_GLOW_BLUR,
  SPACE_PATH_GLOW_WIDTH,
  SPACE_PATH_NODE_RING_ALPHA,
  SPACE_PATH_NODE_RING_SCALE,
  SPACE_PATH_NODE_RING_WIDTH,
  SPACE_PATH_WIDTH,
  SPACE_RING_WIDTH,
  SPACE_SELECTED_RING_SCALE,
  SPACE_TAP_MAX_DISTANCE,
  SPACE_TAP_MAX_DURATION_MS,
  SPACE_TAP_SETTLE_MS,
  SPACE_TRAIL_COLOR_END,
  SPACE_TRAIL_COLOR_START,
  SPACE_WORLD_SCALE,
} from './constants'
import { buildEmphasis } from './paths'
import {
  DEPTH_BUCKETS,
  nearestIndex,
  orderByDepth,
  projectAll,
  projectOne,
  projectPoint,
} from './projection'
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
  /** 主役として描く経路（`scene.paths` の添字）。無ければ null。 */
  activePathIndex: number | null
  /** レイアウトが決まったら知らせる（ラベルの計算に使う）。 */
  onResize?: (width: number, height: number) => void
}

/**
 * 経路を「インデックスの列 + 区切り位置」に平たくする（worklet に渡すため）。
 * `steps` は元の経路での手数の添字。**飛んでいたらそこで線を切る**ために要る。
 */
function flattenPaths(scene: SpaceScene): {
  indices: Float32Array
  steps: Float32Array
  offsets: Float32Array
} {
  let total = 0
  for (const path of scene.paths) total += path.indices.length
  const indices = new Float32Array(total)
  const steps = new Float32Array(total)
  const offsets = new Float32Array(scene.paths.length + 1)
  let cursor = 0
  for (let p = 0; p < scene.paths.length; p += 1) {
    offsets[p] = cursor
    const path = scene.paths[p]
    if (path === undefined) continue
    for (let k = 0; k < path.indices.length; k += 1) {
      indices[cursor] = path.indices[k] as number
      steps[cursor] = path.steps[k] as number
      cursor += 1
    }
  }
  offsets[scene.paths.length] = cursor
  return { indices, steps, offsets }
}

export function SpaceCanvas({
  scene,
  camera,
  gesture,
  onHit,
  selectedIndex,
  activePathIndex,
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
  const pathSteps = useSharedValue(paths.steps)
  const pathOffsets = useSharedValue(paths.offsets)

  const selected = useSharedValue(selectedIndex)
  useEffect(() => {
    selected.value = selectedIndex
  }, [selectedIndex, selected])
  const goal = useSharedValue(scene.goalIndex)
  const interactiveCount = useSharedValue(scene.interactiveCount)

  // ── 主役と背景の重みづけ ──────────────────────────────────
  // 経路を切り替えるたびに JS で作り直して差し替える（点の数ぶんの走査 1 回）。
  // 共有値に**新しい配列を代入する**ことで mapper が作り直される
  // （中身だけ書き換えても Reanimated は気づかない）。
  const emphasis = useMemo(() => buildEmphasis(scene, activePathIndex), [scene, activePathIndex])
  const emphasisAlpha = useSharedValue(emphasis.alpha)
  const emphasisSize = useSharedValue(emphasis.size)
  useEffect(() => {
    emphasisAlpha.value = emphasis.alpha
    emphasisSize.value = emphasis.size
  }, [emphasis, emphasisAlpha, emphasisSize])

  // ── 選択中の経路（平たい配列のどこからどこまでか）──────────
  const activeRange = useMemo(() => {
    if (activePathIndex === null) return { index: -1, from: 0, to: 0, start: -1, end: -1 }
    const indices = scene.paths[activePathIndex]?.indices
    if (indices === undefined || indices.length === 0) {
      return { index: -1, from: 0, to: 0, start: -1, end: -1 }
    }
    return {
      index: activePathIndex,
      from: paths.offsets[activePathIndex] ?? 0,
      to: paths.offsets[activePathIndex + 1] ?? 0,
      start: indices[0] as number,
      end: indices[indices.length - 1] as number,
    }
  }, [scene, paths, activePathIndex])

  const activeIndex = useSharedValue(activeRange.index)
  const activeFrom = useSharedValue(activeRange.from)
  const activeTo = useSharedValue(activeRange.to)
  const activeStart = useSharedValue(activeRange.start)
  const activeEnd = useSharedValue(activeRange.end)
  useEffect(() => {
    activeIndex.value = activeRange.index
    activeFrom.value = activeRange.from
    activeTo.value = activeRange.to
    activeStart.value = activeRange.start
    activeEnd.value = activeRange.end
  }, [activeRange, activeIndex, activeFrom, activeTo, activeStart, activeEnd])

  /** 経路を投影するときの作業領域（毎フレーム確保しない）。 */
  const routeScratch = useSharedValue(new Float32Array(4))

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
        camera.targetX.value,
        camera.targetY.value,
        camera.targetZ.value,
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
    const scale = (sizePt.value[point] * depthScale * emphasisSize.value[point]) / DOT
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
        camera.targetX.value,
        camera.targetY.value,
        camera.targetZ.value,
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
    const alpha =
      baseAlpha.value[point] * colorScratch.alphaMul.value[point] * emphasisAlpha.value[point]
    val[3] = alpha > 1 ? 1 : alpha
  })

  // ── 経路（この画面の主役）──────────────────────────────────
  /** 選んでいない経路。背景として薄く残す（自分の宇宙の地図）。 */
  const idleRoutePath = useDerivedValue<SkPath>(() => {
    const path = Skia.Path.Make()
    const width = viewWidth.value
    const height = viewHeight.value
    const offsets = pathOffsets.value
    if (width <= 0 || height <= 0 || offsets.length < 2) return path
    const worldScale = Math.min(width, height) * SPACE_WORLD_SCALE
    for (let p = 0; p + 1 < offsets.length; p += 1) {
      if (p === activeIndex.value) continue
      appendRoute(
        path,
        xyz.value,
        pathIndices.value,
        pathSteps.value,
        offsets[p] as number,
        offsets[p + 1] as number,
        camera.yaw.value,
        camera.pitch.value,
        camera.distance.value,
        camera.targetX.value,
        camera.targetY.value,
        camera.targetZ.value,
        width / 2,
        height / 2,
        worldScale,
        routeScratch.value,
      )
    }
    return path
  })

  /** 選択中の経路。太く描いて発光させる。 */
  const activeRoutePath = useDerivedValue<SkPath>(() => {
    const path = Skia.Path.Make()
    const width = viewWidth.value
    const height = viewHeight.value
    if (activeIndex.value < 0 || width <= 0 || height <= 0) return path
    appendRoute(
      path,
      xyz.value,
      pathIndices.value,
      pathSteps.value,
      activeFrom.value,
      activeTo.value,
      camera.yaw.value,
      camera.pitch.value,
      camera.distance.value,
      camera.targetX.value,
      camera.targetY.value,
      camera.targetZ.value,
      width / 2,
      height / 2,
      Math.min(width, height) * SPACE_WORLD_SCALE,
      routeScratch.value,
    )
    return path
  })

  /** 節（各手）の輪。何手目かは `SpaceLabels` が RN の Text で添える。 */
  const activeNodesPath = useDerivedValue<SkPath>(() => {
    const path = Skia.Path.Make()
    const width = viewWidth.value
    const height = viewHeight.value
    if (activeIndex.value < 0 || width <= 0 || height <= 0) return path
    appendNodeRings(
      path,
      xyz.value,
      pathIndices.value,
      sizePt.value,
      activeFrom.value,
      activeTo.value,
      camera.yaw.value,
      camera.pitch.value,
      camera.distance.value,
      camera.targetX.value,
      camera.targetY.value,
      camera.targetZ.value,
      width / 2,
      height / 2,
      Math.min(width, height) * SPACE_WORLD_SCALE,
      routeScratch.value,
    )
    return path
  })

  // ── 強調する点（経路の端 / 選択中 / 今日のゴール）────────────
  const selectedRing = useRing(
    selected,
    xyz,
    sizePt,
    camera,
    viewWidth,
    viewHeight,
    SPACE_SELECTED_RING_SCALE,
  )
  const goalRing = useRing(goal, xyz, sizePt, camera, viewWidth, viewHeight, SPACE_GOAL_RING_SCALE)
  const startRing = useRing(
    activeStart,
    xyz,
    sizePt,
    camera,
    viewWidth,
    viewHeight,
    SPACE_PATH_END_RING_SCALE,
  )
  const endRing = useRing(
    activeEnd,
    xyz,
    sizePt,
    camera,
    viewWidth,
    viewHeight,
    SPACE_PATH_END_RING_SCALE,
  )

  // 線の色は「灰（スタート）→ 金（到達）」。端が重なって勾配が潰れないよう、
  // 同じ点になったときだけ 1pt ずらす（Skia の勾配は始点と終点が同じだと死ぬ）。
  const trailFrom = useDerivedValue(() => vec(startRing.cx.value, startRing.cy.value))
  const trailTo = useDerivedValue(() => {
    const dx = endRing.cx.value - startRing.cx.value
    const dy = endRing.cy.value - startRing.cy.value
    if (dx * dx + dy * dy > 1) return vec(endRing.cx.value, endRing.cy.value)
    return vec(startRing.cx.value + 1, startRing.cy.value + 1)
  })

  // ── タップ ────────────────────────────────────────────────
  /**
   * 「宇宙を回す」が主操作。シートが開くのは、止まっている宇宙を
   * ちょんと突いたときだけにする。誤爆を 3 段で止める。
   *
   * 1. `maxDistance` / `maxDuration`: RNGH の既定は距離が **無制限**
   *    （iOS 実装は `_maxDistSq = NAN`）で、500ms 未満のフリックでも END になる。
   * 2. `Gesture.Exclusive(pan+pinch, tap)`: パンが活性化したらタップは起きない。
   *    ぐるっと回して出発点の近くで離す（＝移動距離の判定をすり抜ける）操作も潰せる。
   * 3. 慣性で流れている最中に触ったときは、そのタップは「止める」操作として捨てる
   *    （`camera.lastMovedAt` を触った瞬間に見る）。
   */
  const tapIgnored = useSharedValue(0)
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(SPACE_TAP_MAX_DISTANCE)
        .maxDuration(SPACE_TAP_MAX_DURATION_MS)
        .onBegin(() => {
          'worklet'
          // 触った瞬間に判定する。パンの onBegin が慣性を打ち切るより先でも後でも、
          // 「最後に動いた時刻」は変わらないので順序に依らない。
          tapIgnored.value = Date.now() - camera.lastMovedAt.value < SPACE_TAP_SETTLE_MS ? 1 : 0
        })
        .onEnd((event) => {
          'worklet'
          if (tapIgnored.value === 1) return
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
    [transformScratch, interactiveCount, onHit, camera, tapIgnored],
  )

  const composed = useMemo(() => Gesture.Exclusive(gesture, tap), [gesture, tap])

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
          {/* 1. 選んでいない経路（背景の地図）。 */}
          <Path
            path={idleRoutePath}
            style="stroke"
            strokeWidth={SPACE_PATH_WIDTH}
            strokeJoin="round"
            strokeCap="round"
            color={palette.tiers.cosmos.accent}
            opacity={SPACE_PATH_ALPHA}
          />

          {/* 2. 点。所持語・ゴール・ゴースト（主役の経路以外は背景に沈む）。 */}
          {count > 0 ? (
            <Atlas
              image={texture}
              sprites={sprites}
              transforms={transforms}
              colors={colors}
              colorBlendMode="srcIn"
            />
          ) : null}

          {/* 3. 主役の経路。発光 → 線 → 節の輪 → 端の輪 の順に重ねる。 */}
          <Path
            path={activeRoutePath}
            style="stroke"
            strokeWidth={SPACE_PATH_GLOW_WIDTH}
            strokeJoin="round"
            strokeCap="round"
            color={SPACE_TRAIL_COLOR_END}
            opacity={SPACE_PATH_GLOW_ALPHA}
          >
            <BlurMask blur={SPACE_PATH_GLOW_BLUR} style="normal" />
          </Path>
          <Path
            path={activeRoutePath}
            style="stroke"
            strokeWidth={SPACE_PATH_ACTIVE_WIDTH}
            strokeJoin="round"
            strokeCap="round"
          >
            <LinearGradient
              start={trailFrom}
              end={trailTo}
              colors={[SPACE_TRAIL_COLOR_START, SPACE_TRAIL_COLOR_END]}
            />
          </Path>
          <Path
            path={activeNodesPath}
            style="stroke"
            strokeWidth={SPACE_PATH_NODE_RING_WIDTH}
            color={palette.white}
            opacity={SPACE_PATH_NODE_RING_ALPHA}
          />
          <Circle
            cx={startRing.cx}
            cy={startRing.cy}
            r={startRing.r}
            color={SPACE_TRAIL_COLOR_START}
            style="stroke"
            strokeWidth={SPACE_PATH_END_RING_WIDTH}
          />
          <Circle
            cx={endRing.cx}
            cy={endRing.cy}
            r={endRing.r}
            color={SPACE_TRAIL_COLOR_END}
            style="stroke"
            strokeWidth={SPACE_PATH_END_RING_WIDTH}
          />

          {/* 4. 今日のゴールと、シートで開いている語。 */}
          <Circle
            cx={goalRing.cx}
            cy={goalRing.cy}
            r={goalRing.r}
            color={tierPalettes.gold.accent}
            style="stroke"
            strokeWidth={SPACE_GOAL_RING_WIDTH}
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

// ── 経路を積む worklet ──────────────────────────────────────

/**
 * 折れ線を 1 本ぶん積む。
 *
 * **線が繋がることを見せる**のがこの画面の目的だが、**通っていない線は引かない**。
 * 線を切るのは 2 つの場合だけ：
 * - near plane の向こうに出た点
 * - 手数の添字が飛んでいるところ（座標を持たない語が落ちた区間）
 *
 * `out` は長さ 4 の作業領域（毎フレーム確保しない）。
 */
function appendRoute(
  path: SkPath,
  points: Float32Array,
  indices: Float32Array,
  steps: Float32Array,
  from: number,
  to: number,
  yaw: number,
  pitch: number,
  distance: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  centerX: number,
  centerY: number,
  worldScale: number,
  out: Float32Array,
): void {
  'worklet'
  let started = false
  for (let k = from; k < to; k += 1) {
    // 手数が 1 つぶんより開いていたら、その間は歩いていない（座標の無い語が落ちた）。
    if (k > from && (steps[k] as number) - (steps[k - 1] as number) > 1) started = false
    const index = indices[k] as number
    projectPoint(
      points[index * 3] as number,
      points[index * 3 + 1] as number,
      points[index * 3 + 2] as number,
      yaw,
      pitch,
      distance,
      targetX,
      targetY,
      targetZ,
      centerX,
      centerY,
      worldScale,
      out,
    )
    if (out[2] === 0) {
      started = false
      continue
    }
    if (started) path.lineTo(out[0] as number, out[1] as number)
    else {
      path.moveTo(out[0] as number, out[1] as number)
      started = true
    }
  }
}

/** 節に打つ輪。深度でサイズが変わるので、点と同じ倍率を掛ける。 */
function appendNodeRings(
  path: SkPath,
  points: Float32Array,
  indices: Float32Array,
  sizePt: Float32Array,
  from: number,
  to: number,
  yaw: number,
  pitch: number,
  distance: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  centerX: number,
  centerY: number,
  worldScale: number,
  out: Float32Array,
): void {
  'worklet'
  for (let k = from; k < to; k += 1) {
    const index = indices[k] as number
    projectPoint(
      points[index * 3] as number,
      points[index * 3 + 1] as number,
      points[index * 3 + 2] as number,
      yaw,
      pitch,
      distance,
      targetX,
      targetY,
      targetZ,
      centerX,
      centerY,
      worldScale,
      out,
    )
    const depthScale = out[2] as number
    if (depthScale === 0) continue
    const radius = ((sizePt[index] as number) * depthScale * SPACE_PATH_NODE_RING_SCALE) / 2
    path.addCircle(out[0] as number, out[1] as number, radius)
  }
}

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
      camera.targetX.value,
      camera.targetY.value,
      camera.targetZ.value,
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
