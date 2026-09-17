/**
 * デイリーランキング（SPEC §5.8）。
 *
 * - 日付切替（前日 / 翌日）。**未来の日付には進めない。**
 * - 上位 `LEADERBOARD_LIMIT`（50）+ 自分の順位。
 * - 並びは `move_count ASC, hint_count ASC, cleared_at ASC`。
 *   **サーバーが返した順のまま出す**（端末で並べ替えない）。
 * - 自分の行はハイライト、完全錬成には印。
 * - 誰もクリアしていない日・サーバーが落ちている日でも画面は壊れない。
 */

import { LEADERBOARD_LIMIT } from '@coto2ba/contracts'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassCard,
  MIN_TAP_SIZE,
  Skeleton,
  SymbolIcon,
  type SymbolName,
  TierBackground,
} from '../../../components'
import {
  clearedCountLabel,
  formatJstDateLabel,
  isFutureDate,
  jstToday,
  LEADERBOARD_ROW_MIN_HEIGHT,
  LEADERBOARD_SKELETON_ROWS,
  LeaderboardRow,
  outsideTopEntry,
  relativeDateLabel,
  shiftDate,
  useLeaderboardQuery,
} from '../../../features/ranking'
import {
  borderWidth,
  iconSize,
  layout,
  opacity,
  radius,
  screenInsets,
  spacing,
  TRANSPARENT,
  typography,
  useTheme,
} from '../../../theme'

/** ランキングは演出帯を持たない。ロビーと同じ落ち着いた地。 */
const RANKING_TIER = 'mono'

/** ローディングのスケルトン行（index を key にしないため固定 id を作る）。 */
const SKELETON_IDS = Array.from(
  { length: LEADERBOARD_SKELETON_ROWS },
  (_, i) => `rank-skeleton-${i}`,
)

export default function RankingScreen() {
  const insets = useSafeAreaInsets()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(RANKING_TIER)

  const today = useMemo(() => jstToday(), [])
  const [date, setDate] = useState(today)
  const [refreshing, setRefreshing] = useState(false)

  const leaderboard = useLeaderboardQuery(date)

  const canGoForward = !isFutureDate(shiftDate(date, 1), today)
  const goPrev = useCallback(() => setDate((current) => shiftDate(current, -1)), [])
  const goNext = useCallback(
    () =>
      setDate((current) =>
        isFutureDate(shiftDate(current, 1), today) ? current : shiftDate(current, 1),
      ),
    [today],
  )

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void leaderboard.refetch().finally(() => setRefreshing(false))
  }, [leaderboard])

  const data = leaderboard.data
  const detachedMe = outsideTopEntry(data)
  const countLabel = clearedCountLabel(data)
  const relative = relativeDateLabel(date, today)

  return (
    <TierBackground tier={RANKING_TIER}>
      <ScrollView
        contentContainerStyle={[styles.content, screenInsets(insets)]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sub} />
        }
      >
        <View style={styles.header}>
          <Text style={[typography.largeTitle, { color: colors.text }]}>ランキング</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            その日のデイリーをクリアした人。手数 → ヒント数 → クリア時刻の順。
          </Text>
        </View>

        {/* ── 日付切替 ── */}
        <View style={styles.dateBar}>
          <DateArrow
            icon="chevron.left"
            accessibilityLabel="前の日"
            onPress={goPrev}
            tierColor={colors.text}
          />
          <View style={styles.dateLabel}>
            <Text style={[typography.subtitle, { color: colors.text }]}>
              {formatJstDateLabel(date)}
            </Text>
            <Text style={[typography.label, { color: colors.sub }]}>
              {relative ?? date}
              {countLabel === null ? '' : ` ・ ${countLabel}`}
            </Text>
          </View>
          <DateArrow
            icon="chevron.right"
            accessibilityLabel="次の日"
            onPress={goNext}
            disabled={!canGoForward}
            tierColor={colors.text}
          />
        </View>

        {/* ── 一覧 ── */}
        {leaderboard.isPending ? (
          <View style={styles.list}>
            {SKELETON_IDS.map((id) => (
              <Skeleton key={id} height={LEADERBOARD_ROW_MIN_HEIGHT} cornerRadius={radius.md} />
            ))}
          </View>
        ) : leaderboard.isError ? (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <ErrorState
              error={leaderboard.error}
              onRetry={() => void leaderboard.refetch()}
              tier={RANKING_TIER}
              title="ランキングを読み込めませんでした"
            />
          </GlassCard>
        ) : data === undefined || data.entries.length === 0 ? (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <Text style={[typography.subtitle, { color: colors.text }]}>まだ誰もいません</Text>
            <Text style={[typography.caption, { color: colors.sub }]}>
              この日のデイリーをクリアした人がいないか、まだ集計されていません。
              いちばん乗りを狙いましょう。
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.list}>
            {data.entries.map((entry) => (
              <LeaderboardRow key={entry.user_id} entry={entry} tier={RANKING_TIER} />
            ))}
            <Text style={[typography.label, styles.note, { color: colors.sub }]}>
              上位 {LEADERBOARD_LIMIT} 位まで表示しています
            </Text>
          </View>
        )}

        {/* ── 上位に入っていない自分 ── */}
        {detachedMe !== null ? (
          <View style={styles.list}>
            <Text style={[typography.label, { color: colors.sub }]}>あなた</Text>
            <LeaderboardRow entry={detachedMe} tier={RANKING_TIER} detached />
          </View>
        ) : null}
      </ScrollView>
    </TierBackground>
  )
}

function DateArrow({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  tierColor,
}: {
  icon: SymbolName
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
  tierColor: string
}) {
  const { palette } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.arrow,
        {
          borderColor: palette.border,
          opacity: disabled ? opacity.disabled : opacity.full,
          backgroundColor: pressed ? palette.pressed : TRANSPARENT,
        },
      ]}
    >
      <SymbolIcon name={icon} size={iconSize.md} color={tierColor} weight="semibold" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: layout.sectionGap,
  },
  header: { gap: spacing.xs },
  card: { gap: layout.cardGap },
  dateBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateLabel: { flex: 1, alignItems: 'center', gap: spacing.xs },
  arrow: {
    width: MIN_TAP_SIZE,
    height: MIN_TAP_SIZE,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: spacing.sm },
  note: { textAlign: 'center', paddingTop: spacing.sm },
})
