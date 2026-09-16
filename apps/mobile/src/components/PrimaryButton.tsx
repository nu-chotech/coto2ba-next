/**
 * 主要ボタン。混合ボタン・「はじめる」・「シェア」など。
 * 押し込みは Reanimated のスケール（GlassView を使わないので opacity 問題に当たらない）。
 */

import type { TierId } from '@coto2ba/contracts'
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import {
  borderWidth,
  layout,
  opacity,
  palette,
  paletteForTier,
  radius,
  spacing,
  spring,
  typography,
} from '../theme'
import { BUTTON_PRESSED_SCALE } from './constants'

export type PrimaryButtonVariant = 'primary' | 'secondary' | 'ghost'

export type PrimaryButtonProps = {
  title: string
  onPress: () => void
  tier: TierId
  variant?: PrimaryButtonVariant
  disabled?: boolean
  loading?: boolean
  /** ボタンの下に出す小さな補足（自己ベストなど）。 */
  subtitle?: string | null
  style?: StyleProp<ViewStyle>
}

export function PrimaryButton({
  title,
  onPress,
  tier,
  variant = 'primary',
  disabled = false,
  loading = false,
  subtitle = null,
  style,
}: PrimaryButtonProps) {
  const colors = paletteForTier(tier)
  const scale = useSharedValue(1)
  const inactive = disabled || loading

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'secondary'
        ? colors.surface
        : palette.transparent
  const labelColor = variant === 'primary' ? palette.base : colors.text
  const border = variant === 'ghost' ? colors.sub : palette.transparent

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={() => {
          scale.value = withSpring(BUTTON_PRESSED_SCALE, spring.snappy)
        }}
        onPressOut={() => {
          scale.value = withSpring(1, spring.snappy)
        }}
        style={[
          styles.button,
          {
            backgroundColor: background,
            borderColor: border,
            opacity: inactive ? opacity.disabled : opacity.full,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={labelColor} />
        ) : (
          <Text style={[typography.subtitle, { color: labelColor }]}>{title}</Text>
        )}
      </Pressable>
      {subtitle !== null && subtitle.length > 0 ? (
        <View style={styles.subtitleRow}>
          <Text style={[typography.label, { color: colors.sub }]}>{subtitle}</Text>
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  button: {
    height: layout.buttonHeight,
    borderRadius: radius.lg,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  subtitleRow: { alignItems: 'center', paddingTop: spacing.xs },
})
