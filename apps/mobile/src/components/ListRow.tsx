/**
 * ガラスのカードの中に並べる行。iOS の inset grouped リストの作法に合わせる。
 *
 * ガラスの上にさらに枠付きの箱を置くと濁るので、**行そのものには枠を付けない**。
 * 区切りは髪の毛 1 本の線だけ、押せる行には右端に山形（chevron）を置く。
 * 高さは最小タップ領域（44pt）を下回らない。
 */

import type { ReactNode } from 'react'
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { iconSize, palette, radius, spacing, typography } from '../theme'
import { MIN_TAP_SIZE } from './constants'
import { SymbolIcon } from './SymbolIcon'
import type { SymbolName } from './symbols'

export type ListRowProps = {
  title: string
  /** 2 行目の小さい説明。 */
  description?: string | null
  /** 右端に出す値（「3 回」など）。押せる行では chevron の左に出る。 */
  value?: string | null
  /** 左端のアイコン。 */
  icon?: SymbolName
  /** 押したときの動作。無ければ押せない行になる（chevron も出ない）。 */
  onPress?: (() => void) | null
  /** 押せる行の右端に出す記号。既定は `chevron.right`。 */
  accessory?: SymbolName
  textColor: string
  subColor: string
  /** 行の上に区切り線を引く。リストの 2 行目以降に付ける。 */
  divided?: boolean
  right?: ReactNode
  style?: StyleProp<ViewStyle>
}

export function ListRow({
  title,
  description = null,
  value = null,
  icon,
  onPress = null,
  accessory = 'chevron.right',
  textColor,
  subColor,
  divided = false,
  right,
  style,
}: ListRowProps) {
  const body = (
    <>
      {icon !== undefined ? <SymbolIcon name={icon} size={iconSize.md} color={subColor} /> : null}
      <View style={styles.text}>
        <Text style={[typography.body, { color: textColor }]}>{title}</Text>
        {description !== null && description.length > 0 ? (
          <Text style={[typography.label, { color: subColor }]}>{description}</Text>
        ) : null}
      </View>
      {value !== null && value.length > 0 ? (
        <Text style={[typography.label, { color: subColor }]}>{value}</Text>
      ) : null}
      {right}
      {onPress !== null ? (
        <SymbolIcon name={accessory} size={iconSize.sm} color={subColor} />
      ) : null}
    </>
  )

  if (onPress === null) {
    return <View style={[styles.row, divided && styles.divided, style]}>{body}</View>
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        pressed && styles.pressed,
        style,
      ]}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TAP_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.divider,
  },
  // 押下の被膜は行の端まで届かせたいので、負のマージンでカードの余白ぶん広げる。
  pressed: {
    backgroundColor: palette.pressed,
    borderRadius: radius.sm,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  text: { flex: 1, gap: spacing.xs },
})
