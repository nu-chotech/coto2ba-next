/**
 * ratio を決める回転ホイール（SPEC §6 / §8.3-5）。
 *
 * **このアプリのこだわりの中心。** オリジナルは iPod のクリックホイールのように
 * 指をぐるりと回して比率を決める UI で、水平スライダーではない。
 *
 * - 値は contracts の `RATIOS`（0.1〜0.8 の 8 段階）。**連続値にしない。丸めない。**
 *   サーバーが 8 値との厳密一致で検証しているので、自分で ratio を計算せず
 *   `indexToRatio()` が返した値だけを渡す。
 * - 指の角度を `Math.atan2` で取り、前フレームとの差分を `unwrapDelta` で連続化して
 *   累積する（計算は `wheel-geometry.ts`。テストで固定してある）。
 * - 段をまたいだ瞬間だけ `slider_detent`（`selectionAsync` + クリック音）。
 *   **対応表は `lib/feedback` ただ 1 つ。ここで expo-haptics を直に呼ばない。**
 * - 離したら払った勢いのぶんだけ送り、最寄りの段にバネで収める。
 *   8 段しか無いので **端では止まる**（無限に回らない）。
 *
 * 外から値が変わったとき（ヒントを選ぶと語と比率が同時に載る）にも追従する。
 * `committed`（真の値）と `angle`（表示専用）を分ける設計は `MixSlider` から引き継いだ。
 *
 * **Skia は使っていない。** ここは Web プレビューでも実際に回して確かめる必要があり
 * （送信される ratio が 8 値と一致するかの確認）、Skia は Web で CanvasKit を
 * 別途読ませない限り描けない（`SkiaGate` 参照）。目盛りと針は矩形と円だけなので、
 * View の回転で同じ絵が出る。**ネイティブと Web で同じ 1 本の実装が動く**ほうを取った。
 */

import { indexToRatio, RATIOS, ratioMixLabel, ratioToIndex, type TierId } from '@coto2ba/contracts'
import { useCallback, useEffect } from 'react'
import {
  type AccessibilityActionEvent,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { feedback } from '../lib/feedback'
import { duration, opacity, radius, spacing, spring, typography, useTheme } from '../theme'
import {
  WHEEL_ACTIVATE_DISTANCE,
  WHEEL_GRIP_MIN_RADIUS,
  WHEEL_HUB_SIZE,
  WHEEL_INERTIA_SEC,
  WHEEL_KNOB_ACTIVE_SCALE,
  WHEEL_KNOB_SIZE,
  WHEEL_RING_INSET,
  WHEEL_RING_WIDTH,
  WHEEL_SIZE,
  WHEEL_SWEEP,
  WHEEL_TICK_ACTIVE_LENGTH,
  WHEEL_TICK_ACTIVE_WIDTH,
  WHEEL_TICK_INSET,
  WHEEL_TICK_LENGTH,
  WHEEL_TICK_WIDTH,
} from './constants'
import { GlassCard } from './GlassCard'
import {
  angleToIndex,
  angularVelocity,
  canTurnAt,
  clampIndex,
  indexToAngle,
  isTurningMove,
  pointerAngle,
  unwrapDelta,
} from './wheel-geometry'

const STEP_COUNT = RATIOS.length
const LAST_INDEX = STEP_COUNT - 1
const CENTER = WHEEL_SIZE / 2
/** 扇の端（ここで止まる）。 */
const MAX_ANGLE = WHEEL_SWEEP / 2

export type MixWheelProps = {
  /** いまの ratio（8 段階のいずれか）。 */
  value: number
  onChange: (ratio: number) => void
  tier: TierId
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function MixWheel({ value, onChange, tier, disabled = false, style }: MixWheelProps) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  const index = ratioToIndex(value)

  /** 直近にコミットした段。ディテント判定はこれだけを見る（真の値）。 */
  const committed = useSharedValue(index)
  /** 表示専用の角度。指に追従する間は段の中間も取る（判定には使わない）。 */
  const angle = useSharedValue(indexToAngle(index, STEP_COUNT, WHEEL_SWEEP))
  /** 直前のフレームの指の角度（差分を取るためだけ）。 */
  const lastTouch = useSharedValue(0)
  /** いま輪を掴んでいるか。中央の窓に入ったら離す（0）。 */
  const gripping = useSharedValue(0)
  /** 触れ始めた位置。掴んでよい場所か・回す動きかの判定に使う。 */
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)
  /** 掴む / 見送るの判定が済んだか。**1 回の指で 1 度しか決めない。** */
  const decided = useSharedValue(0)
  const active = useSharedValue(0)

  // 外から値が変わったとき（ヒント選択・リセット）に追従する。
  // 自分が onChange した直後は committed と一致するので、バネを取り直さない。
  useEffect(() => {
    if (committed.value === index) return
    committed.value = index
    angle.value = withSpring(indexToAngle(index, STEP_COUNT, WHEEL_SWEEP), spring.snappy)
  }, [index, angle, committed])

  /** 段が変わったときだけ呼ばれる（JS スレッド）。 */
  const commit = useCallback(
    (nextIndex: number) => {
      feedback('slider_detent')
      onChange(indexToRatio(nextIndex))
    },
    [onChange],
  )

  /** 読み上げ（VoiceOver / TalkBack）からの 1 段ぶんの操作。 */
  const stepBy = useCallback(
    (direction: number) => {
      const next = clampIndex(index + direction, STEP_COUNT)
      if (next === index) return
      committed.value = next
      angle.value = withSpring(indexToAngle(next, STEP_COUNT, WHEEL_SWEEP), spring.snappy)
      commit(next)
    },
    [index, angle, committed, commit],
  )

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') stepBy(1)
      else if (event.nativeEvent.actionName === 'decrement') stepBy(-1)
    },
    [stepBy],
  )

  /**
   * ジェスチャ。**掴むかどうかを自分で決める**（`manualActivation`）。
   *
   * 素直に掴むと 2 つ壊れる:
   * 1. 中央の窓を掴めてしまい、**4px の指ブレで 2 段飛ぶ**（中心ほど 1px が巨大な角度）
   * 2. 216pt 四方がスクロールを奪い、**縦になぞっても画面が送れない**
   *
   * そこで「掴んでよい半径の外から始まり、かつ**回す動き**（接線方向が半径方向より
   * 大きい）」のときだけ掴む。上端を縦になぞるのは中心へ向かう動きなので掴まず、
   * スクロールに譲る。判定はどちらも `wheel-geometry` の純粋関数（テスト済み）。
   */
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .manualActivation(true)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0]
      if (touch === undefined) {
        manager.fail()
        return
      }
      touchStartX.value = touch.x
      touchStartY.value = touch.y
      decided.value = 0
    })
    .onTouchesMove((event, manager) => {
      // 掴むと決めたあとに activate を呼び直すと、そのたびに測り直しになって
      // 回した量が落ちる（実測で半分ほど失われた）。判定は 1 回だけ。
      if (decided.value === 1) return
      const touch = event.allTouches[0]
      if (touch === undefined) return
      const moveX = touch.x - touchStartX.value
      const moveY = touch.y - touchStartY.value
      // まだ動きが小さいうちは保留する（触れただけで比率を動かさない）。
      if (moveX * moveX + moveY * moveY < WHEEL_ACTIVATE_DISTANCE * WHEEL_ACTIVATE_DISTANCE) return

      decided.value = 1
      const dx = touchStartX.value - CENTER
      const dy = touchStartY.value - CENTER
      if (!canTurnAt(dx, dy, WHEEL_GRIP_MIN_RADIUS) || !isTurningMove(dx, dy, moveX, moveY)) {
        manager.fail()
        return
      }
      manager.activate()
    })
    .onStart((event) => {
      lastTouch.value = pointerAngle(event.x, event.y, CENTER, CENTER)
      gripping.value = 1
      active.value = withTiming(1, { duration: duration.fast })
    })
    .onUpdate((event) => {
      const dx = event.x - CENTER
      const dy = event.y - CENTER
      // 中央の窓に入っているあいだは回さない（ここでの 1px は角度が暴れる）。
      if (!canTurnAt(dx, dy, WHEEL_GRIP_MIN_RADIUS)) {
        gripping.value = 0
        return
      }
      const touch = pointerAngle(event.x, event.y, CENTER, CENTER)
      // 窓を通り抜けて出てきたときは、そこから測り直す（横断ぶん飛ばさない）。
      if (gripping.value === 0) {
        gripping.value = 1
        lastTouch.value = touch
        return
      }
      const delta = unwrapDelta(lastTouch.value, touch)
      lastTouch.value = touch

      // 端を越えて回り続けない（段は 8 つしか無い）。
      const next = Math.min(Math.max(angle.value + delta, -MAX_ANGLE), MAX_ANGLE)
      angle.value = next

      const nextIndex = angleToIndex(next, STEP_COUNT, WHEEL_SWEEP)
      if (nextIndex !== committed.value) {
        committed.value = nextIndex
        runOnJS(commit)(nextIndex)
      }
    })
    .onEnd((event) => {
      // 払った勢いのぶんだけ先へ送ってから、最寄りの段に収める。
      // 中央の窓の中で離したときは勢いを見ない（半径が小さく角速度が暴れる）。
      const omega = canTurnAt(event.x - CENTER, event.y - CENTER, WHEEL_GRIP_MIN_RADIUS)
        ? angularVelocity(event.velocityX, event.velocityY, event.x - CENTER, event.y - CENTER)
        : 0
      const projected = angle.value + omega * WHEEL_INERTIA_SEC
      const nextIndex = angleToIndex(projected, STEP_COUNT, WHEEL_SWEEP)
      if (nextIndex !== committed.value) {
        committed.value = nextIndex
        runOnJS(commit)(nextIndex)
      }
    })
    .onFinalize(() => {
      gripping.value = 0
      decided.value = 0
      // 途中で取り消されても段の上に戻す（中途半端な角度で止めない）。
      angle.value = withSpring(
        indexToAngle(committed.value, STEP_COUNT, WHEEL_SWEEP),
        spring.snappy,
      )
      active.value = withTiming(0, { duration: duration.base })
    })

  const knobRotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}rad` }],
  }))

  const knobScale = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + active.value * (WHEEL_KNOB_ACTIVE_SCALE - 1) }],
  }))

  return (
    <View
      style={[styles.root, disabled ? { opacity: opacity.disabled } : null, style]}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      {/* `touchAction` は Web 限定。ブラウザは縦のなぞりを**自分でスクロールに使う**ので、
          これが 'none'（既定）のままだとホイールの上で画面が送れない。
          ネイティブ側はジェスチャの調停（上の manualActivation）が同じ仕事をする。 */}
      <GestureDetector gesture={pan} touchAction="pan-y">
        <View
          style={styles.wheel}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="混ぜる比率"
          accessibilityValue={{
            min: 0,
            max: LAST_INDEX,
            now: index,
            text: `今の語と混ぜる語で ${ratioMixLabel(value)}`,
          }}
          accessibilityActions={ACCESSIBILITY_ACTIONS}
          onAccessibilityAction={onAccessibilityAction}
        >
          {/* 外周の輪 */}
          <View style={[styles.ring, { borderColor: colors.surface }]} pointerEvents="none" />

          {/* 目盛り 8 本。今の段までを accent で塗って、温度計のように見せる。 */}
          {RATIOS.map((ratio, tickIndex) => {
            const reached = tickIndex <= index
            const current = tickIndex === index
            return (
              <View
                key={ratio}
                pointerEvents="none"
                style={[
                  styles.rotor,
                  {
                    transform: [
                      { rotate: `${indexToAngle(tickIndex, STEP_COUNT, WHEEL_SWEEP)}rad` },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    styles.tick,
                    current ? styles.tickActive : null,
                    {
                      backgroundColor: reached ? colors.accent : colors.sub,
                      opacity: current ? opacity.full : reached ? opacity.muted : opacity.disabled,
                    },
                  ]}
                />
              </View>
            )
          })}

          {/* つまみ。角度は共有値なので、指を離したあともバネで段に吸い付く。 */}
          <Animated.View style={[styles.rotor, knobRotation]} pointerEvents="none">
            <Animated.View
              style={[
                styles.knob,
                { backgroundColor: colors.accent, borderColor: palette.glassEdge },
                knobScale,
              ]}
            />
          </Animated.View>

          {/* 中央の窓。いまの比率を「今の語 : 混ぜる語」で読む。 */}
          <View style={styles.hubWrap} pointerEvents="none">
            <GlassCard
              tint={colors.glassTint}
              cornerRadius={WHEEL_HUB_SIZE / 2}
              padding={0}
              style={styles.hub}
            >
              <Text style={[typography.title, { color: colors.text }]}>{ratioMixLabel(value)}</Text>
              <Text style={[typography.mono, { color: colors.sub }]}>×{value.toFixed(1)}</Text>
            </GlassCard>
          </View>
        </View>
      </GestureDetector>

      {/* 扇の下の隙間に、両端が何を意味するかを置く。 */}
      <View style={styles.legend} pointerEvents="none">
        <Text style={[typography.label, { color: colors.sub }]}>今の語寄り</Text>
        <Text style={[typography.label, { color: colors.sub }]}>混ぜる語寄り</Text>
      </View>
    </View>
  )
}

const ACCESSIBILITY_ACTIONS = [
  { name: 'increment', label: '混ぜる語を強くする' },
  { name: 'decrement', label: '今の語を強くする' },
] as const

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.sm },
  wheel: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  ring: {
    position: 'absolute',
    top: WHEEL_RING_INSET,
    left: WHEEL_RING_INSET,
    right: WHEEL_RING_INSET,
    bottom: WHEEL_RING_INSET,
    borderRadius: radius.pill,
    borderWidth: WHEEL_RING_WIDTH,
  },
  /** 中心まわりに子を回すための入れ物。子は上端の中央に置く。 */
  rotor: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center' },
  tick: {
    top: WHEEL_TICK_INSET,
    width: WHEEL_TICK_WIDTH,
    height: WHEEL_TICK_LENGTH,
    borderRadius: radius.pill,
  },
  tickActive: {
    width: WHEEL_TICK_ACTIVE_WIDTH,
    height: WHEEL_TICK_ACTIVE_LENGTH,
  },
  knob: {
    top: WHEEL_RING_INSET + WHEEL_RING_WIDTH / 2 - WHEEL_KNOB_SIZE / 2,
    width: WHEEL_KNOB_SIZE,
    height: WHEEL_KNOB_SIZE,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hubWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: {
    width: WHEEL_HUB_SIZE,
    height: WHEEL_HUB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  legend: {
    width: WHEEL_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
