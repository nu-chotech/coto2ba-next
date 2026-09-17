/**
 * セグメント選択。フリーモードの難易度に使う。
 * 値は文字列のユニオンなら何でも通る（Difficulty / 日付など）。
 */

import type { TierId } from '@coto2ba/contracts'
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { borderWidth, opacity, radius, spacing, TRANSPARENT, typography, useTheme } from '../theme'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
}

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  tier: TierId
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tier,
  disabled = false,
  style,
}: SegmentedProps<T>) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.surface,
          borderColor: palette.border,
          opacity: disabled ? opacity.disabled : opacity.full,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected ? colors.accent : pressed ? palette.pressed : TRANSPARENT,
              },
            ]}
          >
            <Text style={[typography.label, { color: selected ? colors.onAccent : colors.text }]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: spacing.xs,
    gap: spacing.xs,
    borderWidth: borderWidth.hairline,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
