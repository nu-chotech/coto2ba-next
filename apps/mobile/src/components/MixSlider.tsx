/**
 * ratio スライダー（SPEC §8.3-5）。
 *
 * - 値は contracts の `RATIOS`（0.1〜0.8 の 8 段階）。**連続値にしない。**
 * - react-native-gesture-handler の `Gesture.Pan()` + Reanimated。
 *   段が変わるたびに `slider_detent`（`selectionAsync` + クリック音）。
 * - ラベルは「今の語寄り ←→ 混ぜる語寄り」。
 */

import { indexToRatio, RATIOS, ratioToIndex, type TierId } from '@coto2ba/contracts'
import { useCallback, useEffect } from 'react'
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { feedback } from '../lib/feedback'
import {
  duration,
  layout,
  opacity,
  paletteForTier,
  radius,
  spacing,
  spring,
  typography,
} from '../theme'
import {
  SLIDER_EDGE_PADDING,
  SLIDER_HIT_HEIGHT,
  SLIDER_THUMB_ACTIVE_SCALE,
  SLIDER_TICK_SIZE,
} from './constants'

const LAST_INDEX = RATIOS.length - 1

export type MixSliderProps = {
  /** いまの ratio（8 段階のいずれか）。 */
  value: number
  onChange: (ratio: number) => void
  tier: TierId
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function MixSlider({ value, onChange, tier, disabled = false, style }: MixSliderProps) {
  const colors = paletteForTier(tier)
  const trackWidth = useSharedValue(0)
  /** 直近にコミットした段。ディテント判定はこれだけを見る（真の値）。 */
  const committed = useSharedValue(ratioToIndex(value))
  /** 表示専用。withSpring で補間中なので判定には使わない。 */
  const index = useSharedValue(ratioToIndex(value))
  const active = useSharedValue(0)

  // 外から値が変わったとき（ヒント選択・リセット）に追従する。
  // 自分が onChange した直後は committed と一致するので、スプリングを取り直さない。
  useEffect(() => {
    const next = ratioToIndex(value)
    if (committed.value !== next) {
      committed.value = next
      index.value = withSpring(next, spring.snappy)
    }
  }, [value, index, committed])

  /** 段が変わったときだけ呼ばれる（JS スレッド）。 */
  const commit = useCallback(
    (nextIndex: number) => {
      feedback('slider_detent')
      onChange(indexToRatio(nextIndex))
    },
    [onChange],
  )

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((event) => {
      active.value = withTiming(1, { duration: duration.fast })
      const next = indexAtX(event.x, trackWidth.value)
      if (next !== committed.value) {
        committed.value = next
        runOnJS(commit)(next)
        index.value = withSpring(next, spring.snappy)
      }
    })
    .onUpdate((event) => {
      const next = indexAtX(event.x, trackWidth.value)
      if (next !== committed.value) {
        committed.value = next
        runOnJS(commit)(next)
        index.value = withSpring(next, spring.snappy)
      }
    })
    .onFinalize(() => {
      active.value = withTiming(0, { duration: duration.base })
    })

  const thumbStyle = useAnimatedStyle(() => {
    const usable = Math.max(trackWidth.value - SLIDER_EDGE_PADDING * 2, 1)
    const x = SLIDER_EDGE_PADDING + (index.value / LAST_INDEX) * usable
    return {
      transform: [
        { translateX: x - layout.sliderThumbSize / 2 },
        { scale: 1 + active.value * (SLIDER_THUMB_ACTIVE_SCALE - 1) },
      ],
    }
  })

  const fillStyle = useAnimatedStyle(() => {
    const usable = Math.max(trackWidth.value - SLIDER_EDGE_PADDING * 2, 1)
    return { width: SLIDER_EDGE_PADDING + (index.value / LAST_INDEX) * usable }
  })

  return (
    <View style={[styles.root, disabled ? { opacity: opacity.disabled } : null, style]}>
      <View style={styles.labels}>
        <Text style={[typography.label, { color: colors.sub }]}>今の語寄り</Text>
        <Text style={[typography.subtitle, { color: colors.accent }]}>{value.toFixed(1)}</Text>
        <Text style={[typography.label, { color: colors.sub }]}>混ぜる語寄り</Text>
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.hit}
          onLayout={(event) => {
            trackWidth.value = event.nativeEvent.layout.width
          }}
        >
          <View style={[styles.track, { backgroundColor: colors.surface }]} />
          <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fillStyle]} />
          <View style={styles.ticks} pointerEvents="none">
            {RATIOS.map((ratio) => (
              <View key={ratio} style={[styles.tick, { backgroundColor: colors.sub }]} />
            ))}
          </View>
          <Animated.View
            style={[
              styles.thumb,
              { backgroundColor: colors.text, borderColor: colors.accent },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  )
}

/** x 座標 → 最も近いディテントの index（worklet）。 */
function indexAtX(x: number, width: number): number {
  'worklet'
  const usable = Math.max(width - SLIDER_EDGE_PADDING * 2, 1)
  const ratio = (x - SLIDER_EDGE_PADDING) / usable
  const raw = Math.round(ratio * LAST_INDEX)
  return Math.min(Math.max(raw, 0), LAST_INDEX)
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  labels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hit: { height: SLIDER_HIT_HEIGHT, justifyContent: 'center' },
  track: {
    height: layout.sliderTrackHeight,
    borderRadius: radius.pill,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: layout.sliderTrackHeight,
    borderRadius: radius.pill,
  },
  ticks: {
    position: 'absolute',
    left: SLIDER_EDGE_PADDING,
    right: SLIDER_EDGE_PADDING,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tick: {
    width: SLIDER_TICK_SIZE,
    height: SLIDER_TICK_SIZE,
    borderRadius: SLIDER_TICK_SIZE / 2,
    opacity: 0.8,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: layout.sliderThumbSize,
    height: layout.sliderThumbSize,
    borderRadius: layout.sliderThumbSize / 2,
    borderWidth: 2,
  },
})
