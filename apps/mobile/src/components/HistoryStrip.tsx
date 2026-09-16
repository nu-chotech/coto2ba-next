/**
 * 履歴（SPEC §8.3-8）。横スクロールのチップ列で **全手** 表示する
 * （ハッカソン版の 5 件制限は撤廃）。
 *
 * チップ 1 枚 = `input ×ratio → result (rank)`。
 */

import { PERFECT_RANK, TIER_EMOJI, type Move, type TierId } from '@coto2ba/contracts'
import { useEffect, useRef } from 'react'
import { ScrollView, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { borderWidth, palette, paletteForTier, radius, spacing, typography } from '../theme'
import { HISTORY_CHIP_MIN_WIDTH, HISTORY_STRIP_HEIGHT } from './constants'

export type HistoryStripProps = {
  moves: readonly Move[]
  tier: TierId
  /** 開始語。1 枚目の前に「start」として出す。 */
  start: string
  style?: StyleProp<ViewStyle>
}

function formatRank(rank: number): string {
  return rank <= PERFECT_RANK ? '完全錬成' : `${rank.toLocaleString('ja-JP')} 位`
}

export function HistoryStrip({ moves, tier, start, style }: HistoryStripProps) {
  const colors = paletteForTier(tier)
  const scrollRef = useRef<ScrollView | null>(null)

  // 新しい手が増えたら末尾へ寄せる。
  useEffect(() => {
    if (moves.length === 0) return
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0)
    return () => clearTimeout(timer)
  }, [moves.length])

  return (
    <View style={[styles.root, style]}>
      <Text style={[typography.label, { color: colors.sub }]}>これまでの手</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.scroll}
      >
        <View style={[styles.chip, styles.startChip, { borderColor: colors.sub }]}>
          <Text style={[typography.label, { color: colors.sub }]}>スタート</Text>
          <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
            {start}
          </Text>
        </View>

        {moves.map((move) => (
          <View
            key={`${move.seq}-${move.result}`}
            style={[styles.chip, { borderColor: colors.sub, backgroundColor: colors.surface }]}
          >
            <Text style={[typography.label, { color: colors.sub }]} numberOfLines={1}>
              {move.seq}. {move.input_word} ×{move.ratio.toFixed(1)}
            </Text>
            <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
              {TIER_EMOJI[move.tier]} {move.result}
            </Text>
            <Text style={[typography.label, { color: colors.sub }]}>{formatRank(move.rank)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  scroll: { minHeight: HISTORY_STRIP_HEIGHT },
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    minWidth: HISTORY_CHIP_MIN_WIDTH,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    gap: spacing.xs,
  },
  startChip: { backgroundColor: palette.transparent },
})
