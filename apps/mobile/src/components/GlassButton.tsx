/**
 * ボタン。**主要な操作面はすべてこれ。**
 *
 * これまでの `PrimaryButton` は「`GlassView` の `opacity: 0` が描画されない」問題を
 * 避けるために**意図的にガラスを使っていなかった**。それが「中途半端に普通のボタン」の
 * 正体だったので、地をガラスに揃えたうえで既知の問題を回避する。
 *
 * **フェード（disabled / loading）はガラス自身ではなく、包んでいる `Animated.View` の
 * opacity で行う。** `GlassView` に opacity を掛けると 0 でなくても描画が崩れるので、
 * ガラスには一切 opacity を触らせない。
 *
 * 形は iOS 26 の Liquid Glass のボタンに合わせてカプセル（`radius.pill`）。
 * 配色は `buttonStyle.ts`（テストでコントラストを固定してある）。
 * ガラスが使えない端末では `GlassCard` が `BlurView` に落ちるので、見た目は現行のまま。
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
  iconSize,
  layout,
  opacity,
  palette,
  paletteForTier,
  radius,
  spacing,
  spring,
  typography,
} from '../theme'
import { type ButtonVariant, buttonSurface } from './buttonStyle'
import { BUTTON_PRESSED_SCALE, MIN_TAP_SIZE } from './constants'
import { GlassCard } from './GlassCard'
import { SymbolIcon } from './SymbolIcon'
import type { SymbolName } from './symbols'

export type GlassButtonVariant = ButtonVariant

export type GlassButtonProps = {
  title: string
  onPress: () => void
  tier: TierId
  variant?: GlassButtonVariant
  /** ラベルの左に置く SF Symbol。無くてよい（付けすぎると賑やかになる）。 */
  icon?: SymbolName
  /** 行の中に並べる小さいボタン。高さは最小タップ領域（44pt）まで。 */
  compact?: boolean
  disabled?: boolean
  loading?: boolean
  /** ボタンの下に出す小さな補足（自己ベストなど）。 */
  subtitle?: string | null
  style?: StyleProp<ViewStyle>
}

export function GlassButton({
  title,
  onPress,
  tier,
  variant = 'primary',
  icon,
  compact = false,
  disabled = false,
  loading = false,
  subtitle = null,
  style,
}: GlassButtonProps) {
  const colors = paletteForTier(tier)
  const surface = buttonSurface(variant, colors)
  const scale = useSharedValue(1)
  const inactive = disabled || loading

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const content = (
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
      style={({ pressed }) => [
        styles.pressable,
        compact ? styles.compact : styles.regular,
        { backgroundColor: pressed ? palette.pressed : palette.transparent },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={surface.label} />
      ) : (
        <View style={styles.row}>
          {icon !== undefined ? (
            <SymbolIcon
              name={icon}
              size={compact ? iconSize.sm : iconSize.md}
              color={surface.label}
              weight="semibold"
            />
          ) : null}
          <Text
            style={[compact ? typography.body : typography.subtitle, { color: surface.label }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )

  return (
    // フェードはこの層で。中のガラスには opacity を掛けない。
    <Animated.View
      style={[animatedStyle, { opacity: inactive ? opacity.disabled : opacity.full }, style]}
    >
      {surface.usesGlass ? (
        <GlassCard tint={surface.fill} cornerRadius={radius.pill} padding={0}>
          {content}
        </GlassCard>
      ) : (
        <View style={styles.plain}>{content}</View>
      )}
      {subtitle !== null && subtitle.length > 0 ? (
        <View style={styles.subtitleRow}>
          <Text style={[typography.label, { color: colors.sub }]}>{subtitle}</Text>
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  pressable: { alignItems: 'center', justifyContent: 'center' },
  regular: { height: layout.buttonHeight, paddingHorizontal: spacing.xl },
  compact: { height: MIN_TAP_SIZE, paddingHorizontal: spacing.lg },
  plain: { borderRadius: radius.pill, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subtitleRow: { alignItems: 'center', paddingTop: spacing.xs },
})
