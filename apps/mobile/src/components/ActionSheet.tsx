/**
 * アクションシート。**画面の「その他の操作」はすべてこれに集める。**
 *
 * iOS のアクションシートの作法に合わせてある（Apple HIG「Action sheets」）:
 * 見出しと説明は小さく上に、選べる操作は全幅の行、**取り消しは離れた別のカード**。
 * 取り返しのつかない操作は赤（`destructive`）で、いちばん下に置く。
 *
 * **`Alert.alert` を入れ子にしない。** 入れ子の Alert は
 * 「いま何を聞かれているのか」が消えるうえ、**Web では何も出ない**
 * （react-native-web は `Alert` を実装していない。ブラウザで動作確認できなくなる）。
 * ここは Modal で自前に描くので、iOS / Android / Web のどれでも同じものが出る。
 *
 * **項目を押しても勝手に閉じない。** 押した先でさらに確認を出すことがあるからで、
 * 閉じるかどうかは呼び出し側が決める（同じシートの中身を差し替えれば、
 * Modal を出し直さずに「メニュー → 確認」を繋げられる）。
 */

import type { TierId } from '@coto2ba/contracts'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { radius, spacing, TRANSPARENT, typography, useTheme } from '../theme'
import { ACTION_SHEET_ROW_HEIGHT } from './constants'
import { GlassCard } from './GlassCard'

export type ActionSheetItem = {
  label: string
  onPress: () => void
  /** 取り返しのつかない操作。赤で出る。 */
  destructive?: boolean
  /**
   * 送信中など、いま押せない行。薄く出して押せなくする。
   * **行を消さないこと** ── 消すと下の行が上がってきて、
   * 待っているあいだに別の操作を押してしまう。
   */
  disabled?: boolean
}

export type ActionSheetProps = {
  visible: boolean
  tier: TierId
  /** 見出し（「ギブアップしますか？」）。 */
  title?: string | null
  /** 説明（「この挑戦は終了します。…」）。 */
  message?: string | null
  /** 選べる操作。空なら説明だけのシートになる。 */
  items?: readonly ActionSheetItem[]
  /** 取り消しの文言。説明だけのシートでは「閉じる」にする。 */
  cancelLabel?: string
  /**
   * 説明の揃え。既定は中央（iOS のアクションシート）。
   * **数行以上の説明は `start`** にする（中央揃えの長文は行頭が揃わず読みにくい）。
   */
  messageAlign?: 'center' | 'start'
  onClose: () => void
}

export function ActionSheet({
  visible,
  tier,
  title = null,
  message = null,
  items = [],
  cancelLabel = 'キャンセル',
  messageAlign = 'center',
  onClose,
}: ActionSheetProps) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  const insets = useSafeAreaInsets()
  const hasHeader = (title ?? '').length > 0 || (message ?? '').length > 0

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: palette.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="閉じる"
      />
      <View
        style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        pointerEvents="box-none"
      >
        <GlassCard variant="sheet" tint={colors.glassTint} cornerRadius={radius.xl} padding={0}>
          {hasHeader ? (
            <View style={styles.header}>
              {title !== null && title.length > 0 ? (
                <Text style={[typography.label, styles.centered, { color: colors.text }]}>
                  {title}
                </Text>
              ) : null}
              {message !== null && message.length > 0 ? (
                <Text
                  style={[
                    typography.caption,
                    messageAlign === 'center' ? styles.centered : styles.leading,
                    { color: colors.sub },
                  ]}
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null}

          {items.map((item, itemIndex) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              disabled={item.disabled === true}
              accessibilityRole="button"
              accessibilityState={{ disabled: item.disabled === true }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? palette.pressed : TRANSPARENT,
                  borderTopWidth: hasHeader || itemIndex > 0 ? StyleSheet.hairlineWidth : 0,
                  borderTopColor: palette.border,
                },
              ]}
            >
              <Text
                style={[
                  typography.body,
                  {
                    color:
                      item.disabled === true
                        ? colors.sub
                        : item.destructive === true
                          ? palette.negative
                          : colors.text,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </GlassCard>

        {/* 取り消しは離す（押し間違いを防ぐ Apple の作法）。 */}
        <GlassCard variant="sheet" tint={colors.glassTint} cornerRadius={radius.xl} padding={0}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? palette.pressed : TRANSPARENT },
            ]}
          >
            <Text style={[typography.subtitle, { color: colors.text }]}>{cancelLabel}</Text>
          </Pressable>
        </GlassCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  header: { padding: spacing.lg, gap: spacing.xs },
  centered: { textAlign: 'center' },
  leading: { textAlign: 'left' },
  row: {
    minHeight: ACTION_SHEET_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
})
