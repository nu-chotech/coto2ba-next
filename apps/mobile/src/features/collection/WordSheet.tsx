/**
 * 図鑑のボトムシート（SPEC §9.2）。
 *
 * 語・説明文（§7.6）・初遭遇日・出会った回数・**所持語の中で近い 5 語**（実コサイン）。
 * 近い語をタップすると、その語へカメラが飛ぶ。
 *
 * 説明・近傍はサーバー頼みなので、取れなくてもシートは開く（その行が出ないだけ）。
 */

import type { TierId } from '@coto2ba/contracts'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { GlassCard, PrimaryButton, Skeleton, TierDot } from '../../components'
import { borderWidth, palette, paletteForTier, radius, spacing, typography } from '../../theme'
import { formatJstDateLabel, toJstDateString } from '../ranking/dates'
import { SPACE_SHEET_MAX_HEIGHT_RATIO } from './constants'
import { useWordDetailQuery } from './queries'
import type { SpaceNode } from './scene'

const SHEET_TIER: TierId = 'cosmos'

export type WordSheetProps = {
  node: SpaceNode | null
  onClose: () => void
  /** 近い語をタップしたとき。その語が図鑑にあればカメラが飛ぶ。 */
  onPickWord: (word: string) => void
}

function firstSeenLabel(node: SpaceNode): string | null {
  if (node.firstSeenAt === null) return null
  const parsed = new Date(node.firstSeenAt)
  if (Number.isNaN(parsed.getTime())) return null
  return `初めて出会った日 ${formatJstDateLabel(toJstDateString(parsed))}`
}

export function WordSheet({ node, onClose, onPickWord }: WordSheetProps) {
  const colors = paletteForTier(SHEET_TIER)
  const { height } = useWindowDimensions()
  const detail = useWordDetailQuery(node?.word ?? null)

  const visible = node !== null
  const seen = node === null ? null : firstSeenLabel(node)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="閉じる" />
      <View style={styles.dock} pointerEvents="box-none">
        <GlassCard
          variant="sheet"
          tint={colors.glassTint}
          cornerRadius={radius.xl}
          style={[styles.sheet, { maxHeight: height * SPACE_SHEET_MAX_HEIGHT_RATIO }]}
        >
          {node === null ? null : (
            <ScrollView contentContainerStyle={styles.body}>
              <View style={styles.header}>
                <Text style={[typography.title, { color: colors.text }]}>{node.word}</Text>
                {node.tier !== null ? (
                  <View style={styles.tierRow}>
                    <TierDot tier={node.tier} />
                    <Text style={[typography.label, { color: colors.sub }]}>
                      {node.kind === 'goal' ? '今日のゴール' : '初遭遇の帯'}
                    </Text>
                  </View>
                ) : null}
              </View>

              {detail.isPending ? (
                <Skeleton height={40} cornerRadius={radius.sm} />
              ) : detail.data?.description != null && detail.data.description.length > 0 ? (
                <Text style={[typography.body, { color: colors.text }]}>
                  {detail.data.description}
                </Text>
              ) : (
                <Text style={[typography.caption, { color: colors.sub }]}>
                  この語の説明はまだありません。
                </Text>
              )}

              {seen !== null ? (
                <Text style={[typography.label, { color: colors.sub }]}>{seen}</Text>
              ) : null}
              {node.count > 0 ? (
                <Text style={[typography.label, { color: colors.sub }]}>
                  出会った回数 {node.count}
                </Text>
              ) : null}

              <Text style={[typography.label, { color: colors.sub }]}>意味が近い語</Text>
              {detail.isPending ? (
                <Skeleton height={44} cornerRadius={radius.md} />
              ) : (detail.data?.neighbors.length ?? 0) === 0 ? (
                <Text style={[typography.caption, { color: colors.sub }]}>
                  近い語を取得できませんでした。
                </Text>
              ) : (
                <View style={styles.neighbors}>
                  {detail.data?.neighbors.map((neighbor) => (
                    <Pressable
                      key={neighbor.word}
                      onPress={() => onPickWord(neighbor.word)}
                      style={({ pressed }) => [
                        styles.neighbor,
                        {
                          borderColor: colors.sub,
                          backgroundColor: pressed ? palette.pressed : colors.surface,
                        },
                      ]}
                    >
                      <Text style={[typography.body, { color: colors.text }]}>{neighbor.word}</Text>
                      <Text style={[typography.mono, { color: colors.sub }]}>
                        {neighbor.similarity.toFixed(3)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={[typography.label, { color: colors.sub }]}>
                空間の位置は近さの近似です。数値は実際のコサイン類似度。
              </Text>
            </ScrollView>
          )}

          <PrimaryButton title="閉じる" onPress={onClose} tier={SHEET_TIER} variant="secondary" />
        </GlassCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.scrim,
  },
  dock: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg },
  sheet: { gap: spacing.md },
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  header: { gap: spacing.xs },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  neighbors: { gap: spacing.sm },
  neighbor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
  },
})
