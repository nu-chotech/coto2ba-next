/**
 * 順位の一覧（レース中のオーバーレイと結果画面で共有する）。
 *
 * **出すのは順位・名前・手数・到達したいちばん良いランクだけ。**
 * 他人が打った語は**サーバーが返してこない**（§9.2）ので、ここに描く手段も無い。
 * 真似で解かれると競技にならないため、将来も足さないこと。
 *
 * 並びは**サーバーが返した順のまま**（`rankPlayers`）。端末で並べ替えない。
 */

import {
  ROOM_MAX_PLAYERS,
  type RoomPlayer,
  rankToHeat,
  type TierId,
  tierForRank,
} from '@coto2ba/contracts'
import { StyleSheet, Text, View } from 'react-native'
import { SymbolIcon, TierDot } from '../../components'
import {
  borderWidth,
  iconSize,
  radius,
  spacing,
  TRANSPARENT,
  typography,
  useTheme,
} from '../../theme'
import {
  ROOM_ME_BORDER_WIDTH,
  ROOM_RANK_BADGE_SIZE,
  ROOM_STANDING_ROW_MIN_HEIGHT,
} from './constants'

/** ゴールに着いた人だけに付ける印。上位 3 位の色分けはしない（勝者は 1 人）。 */
const WINNER_RANK = 1

export type RoomStandingsProps = {
  players: readonly RoomPlayer[]
  tier: TierId
  /** レース中のオーバーレイ用。名前と順位だけの詰めた行にする。 */
  compact?: boolean
}

export function RoomStandings({ players, tier, compact = false }: RoomStandingsProps) {
  // 1 部屋の上限は contracts（`ROOM_MAX_PLAYERS`）。ここで数字を重ねて持たない。
  // 順位は**サーバーが返した並びのまま**（`rankPlayers`）。端末で並べ替えない。
  const visible = players.slice(0, ROOM_MAX_PLAYERS)
  return (
    <View style={styles.list}>
      {visible.map((player, index) => (
        <RoomStandingRow
          key={player.user_id}
          player={player}
          rank={index + 1}
          tier={tier}
          compact={compact}
        />
      ))}
    </View>
  )
}

export type RoomStandingRowProps = {
  player: RoomPlayer
  /** 表示順。サーバーの並びをそのまま 1 始まりにしたもの。 */
  rank: number
  tier: TierId
  compact?: boolean
}

export function RoomStandingRow({ player, rank, tier, compact = false }: RoomStandingRowProps) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  // 勝者の印は、その日の tier に関係なく「黄金」の色で出す。
  const gold = paletteForTier('gold')
  const finished = player.finished_at !== null
  const winner = finished && rank === WINNER_RANK
  const badgeColor = winner ? gold.accent : colors.sub
  const badgeTextColor = winner ? gold.onAccent : colors.text

  return (
    <View
      style={[
        styles.row,
        compact ? styles.rowCompact : null,
        {
          backgroundColor: player.is_me ? colors.surface : TRANSPARENT,
          borderColor: player.is_me ? colors.accent : palette.border,
          borderWidth: player.is_me ? ROOM_ME_BORDER_WIDTH : borderWidth.hairline,
        },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: badgeColor }]}>
        <Text style={[typography.label, { color: badgeTextColor }]}>{rank}</Text>
      </View>

      <Text style={[typography.body, styles.name, { color: colors.text }]} numberOfLines={1}>
        {player.display_name}
      </Text>

      {finished ? (
        <View style={styles.trailing}>
          <SymbolIcon name="flag" size={iconSize.sm} color={gold.accent} />
          <Text style={[typography.label, { color: gold.accent }]}>ゴール</Text>
        </View>
      ) : (
        <View style={styles.trailing}>
          <TierDot tier={tierForRank(player.best_rank)} />
          <Text style={[typography.label, { color: colors.sub }]}>{progressLabel(player)}</Text>
        </View>
      )}

      <Text style={[typography.mono, styles.moves, { color: colors.sub }]}>
        {player.move_count} 手
      </Text>
    </View>
  )
}

/**
 * 進み具合の一言。**ランクの生値は出すが、他人の語は出さない。**
 * まだ 1 手も打っていない人は「まだ」（0 位と読ませない）。
 */
function progressLabel(player: RoomPlayer): string {
  if (player.move_count === 0) return 'これから'
  const heat = Math.round(rankToHeat(player.best_rank) * 100)
  return `${player.best_rank.toLocaleString('ja-JP')} 位 ・ ${heat}%`
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: ROOM_STANDING_ROW_MIN_HEIGHT + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  // オーバーレイでは縦を詰める（ゲームの主役を押し下げない）。
  rowCompact: { minHeight: ROOM_STANDING_ROW_MIN_HEIGHT, paddingVertical: spacing.xs },
  badge: {
    width: ROOM_RANK_BADGE_SIZE,
    height: ROOM_RANK_BADGE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  moves: { minWidth: 48, textAlign: 'right' },
})
