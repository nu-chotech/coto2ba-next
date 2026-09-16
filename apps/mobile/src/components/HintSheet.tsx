/**
 * ヒントシート（SPEC §8.3-7）。
 *
 * 6 語をガラスのシートで出す。タップすると入力欄に入るだけで、**自動で混合はしない**。
 * 開いた回数はカード側に出す（サーバーの `hint_count` が正）。
 */

import { HINT_COUNT, type TierId } from '@coto2ba/contracts'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { borderWidth, palette, paletteForTier, radius, spacing, typography } from '../theme'
import { HINT_SHEET_MAX_HEIGHT_RATIO } from './constants'
import { GlassCard } from './GlassCard'
import { PrimaryButton } from './PrimaryButton'
import { Skeleton } from './Skeleton'

export type HintSheetProps = {
  visible: boolean
  tier: TierId
  words: readonly string[]
  loading: boolean
  /** 取得に失敗したときの日本語メッセージ。null なら正常。 */
  errorMessage?: string | null
  /** サーバーが持っているヒントの使用回数。 */
  hintCount: number
  onPick: (word: string) => void
  onClose: () => void
  onRetry: () => void
}

export function HintSheet({
  visible,
  tier,
  words,
  loading,
  errorMessage = null,
  hintCount,
  onPick,
  onClose,
  onRetry,
}: HintSheetProps) {
  const colors = paletteForTier(tier)
  const { height } = useWindowDimensions()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="閉じる" />
      <View style={styles.dock} pointerEvents="box-none">
        <GlassCard
          variant="sheet"
          tint={colors.glassTint}
          cornerRadius={radius.xl}
          style={[styles.sheet, { maxHeight: height * HINT_SHEET_MAX_HEIGHT_RATIO }]}
        >
          <View style={styles.header}>
            <Text style={[typography.subtitle, { color: colors.text }]}>ヒント</Text>
            <Text style={[typography.label, { color: colors.sub }]}>使った回数 {hintCount}</Text>
          </View>
          <Text style={[typography.caption, { color: colors.sub }]}>
            タップすると入力欄に入ります（混合はされません）
          </Text>

          <ScrollView contentContainerStyle={styles.list}>
            {loading
              ? Array.from({ length: HINT_COUNT }, (_, i) => (
                  <Skeleton key={i} height={48} cornerRadius={radius.md} />
                ))
              : words.map((word) => (
                  <Pressable
                    key={word}
                    onPress={() => onPick(word)}
                    style={({ pressed }) => [
                      styles.item,
                      {
                        borderColor: colors.sub,
                        backgroundColor: pressed ? palette.pressed : colors.surface,
                      },
                    ]}
                  >
                    <Text style={[typography.body, { color: colors.text }]}>{word}</Text>
                  </Pressable>
                ))}

            {errorMessage !== null && errorMessage.length > 0 ? (
              <View style={styles.error}>
                <Text style={[typography.caption, { color: palette.negative }]}>
                  {errorMessage}
                </Text>
                <PrimaryButton title="もう一度" onPress={onRetry} tier={tier} variant="ghost" />
              </View>
            ) : null}
          </ScrollView>

          <PrimaryButton title="閉じる" onPress={onClose} tier={tier} variant="secondary" />
        </GlassCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.scrim },
  dock: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg },
  sheet: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  list: { gap: spacing.sm, paddingVertical: spacing.sm },
  item: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
  },
  error: { gap: spacing.sm, paddingTop: spacing.sm },
})
