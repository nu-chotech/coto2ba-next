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
import { radius, spacing, typography, useTheme } from '../theme'
import { HINT_SHEET_MAX_HEIGHT_RATIO, HINT_SLOT_HEIGHT } from './constants'
import { GlassButton } from './GlassButton'
import { GlassCard } from './GlassCard'
import { ListRow } from './ListRow'
import { Skeleton } from './Skeleton'

/** ローディング中に並べる枠。index を key にしないため、先に固定の id を作っておく。 */
const HINT_SLOT_IDS = Array.from({ length: HINT_COUNT }, (_, i) => `hint-slot-${i}`)

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
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  const { height } = useWindowDimensions()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: palette.scrim }]}
        onPress={onClose}
        accessibilityLabel="閉じる"
      />
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
            {loading ? (
              <View style={styles.slots}>
                {HINT_SLOT_IDS.map((slotId) => (
                  <Skeleton key={slotId} height={HINT_SLOT_HEIGHT} cornerRadius={radius.md} />
                ))}
              </View>
            ) : (
              words.map((word, index) => (
                <ListRow
                  key={word}
                  title={word}
                  onPress={() => onPick(word)}
                  accessory="arrow.up.right"
                  textColor={colors.text}
                  subColor={colors.sub}
                  divided={index > 0}
                />
              ))
            )}

            {errorMessage !== null && errorMessage.length > 0 ? (
              <View style={styles.error}>
                <Text style={[typography.caption, { color: palette.negative }]}>
                  {errorMessage}
                </Text>
                <GlassButton title="もう一度" onPress={onRetry} tier={tier} variant="ghost" />
              </View>
            ) : null}
          </ScrollView>

          <GlassButton title="閉じる" onPress={onClose} tier={tier} variant="secondary" />
        </GlassCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dock: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg },
  sheet: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  list: { paddingVertical: spacing.sm },
  slots: { gap: spacing.sm },
  error: { gap: spacing.sm, paddingTop: spacing.sm },
})
