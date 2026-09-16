/**
 * ローディングのスケルトン。スピナーではなく「そこに何かが来る形」を見せる。
 */

import { useEffect } from 'react'
import { type DimensionValue, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { palette, radius, spacing } from '../theme'
import { SKELETON_MAX_OPACITY, SKELETON_MIN_OPACITY, SKELETON_PULSE_MS } from './constants'

export type SkeletonProps = {
  width?: DimensionValue
  height: number
  cornerRadius?: number
  style?: StyleProp<ViewStyle>
}

export function Skeleton({
  width = '100%',
  height,
  cornerRadius = radius.sm,
  style,
}: SkeletonProps) {
  const pulse = useSharedValue(SKELETON_MIN_OPACITY)

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(SKELETON_MAX_OPACITY, {
        duration: SKELETON_PULSE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    )
  }, [pulse])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: cornerRadius, backgroundColor: palette.divider },
        animatedStyle,
        style,
      ]}
    />
  )
}

/** カード 1 枚ぶんのスケルトン（ロビーで使う）。 */
export function SkeletonCard({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      <Skeleton width="40%" height={16} />
      <Skeleton width="70%" height={40} />
      <Skeleton width="90%" height={14} />
      <Skeleton height={48} cornerRadius={radius.lg} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.tiers.mono.surface,
  },
})
