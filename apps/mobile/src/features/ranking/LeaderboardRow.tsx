/**
 * ランキングの 1 行（SPEC §5.8）。
 *
 * 並び順は **サーバーが返した順のまま**（`move_count ASC, hint_count ASC, cleared_at ASC`）。
 * 端末側で並べ替えない。`entry.rank` もサーバーの値をそのまま出す。
 *
 * - 自分の行は枠と地でハイライトする。
 * - 完全錬成には印（contracts の `TIER_EMOJI.gold`）。
 */

import { type LeaderboardEntry, TIER_EMOJI, type TierId } from '@coto2ba/contracts'
import { StyleSheet, Text, View } from 'react-native'
import {
  borderWidth,
  palette,
  paletteForTier,
  radius,
  spacing,
  tierPalettes,
  typography,
} from '../../theme'
import { LEADERBOARD_ROW_MIN_HEIGHT, ME_ROW_BORDER_WIDTH, RANK_BADGE_SIZE } from './constants'
import { formatJstTime } from './dates'

/** 上位 3 位だけ金の帯にする。それ以外は tier の地。 */
const PODIUM_RANK_MAX = 3

export type LeaderboardRowProps = {
  entry: LeaderboardEntry
  tier: TierId
  /** 一覧から外れた「自分の行」を別枠で出すとき true（見出しを変える）。 */
  detached?: boolean
}

export function LeaderboardRow({ entry, tier, detached = false }: LeaderboardRowProps) {
  const colors = paletteForTier(tier)
  const podium = entry.rank <= PODIUM_RANK_MAX
  const badgeColor = podium ? tierPalettes.gold.accent : colors.sub
  const badgeTextColor = podium ? palette.base : colors.text

  const clearedAt = formatJstTime(entry.cleared_at)
  const subtitle = [
    detached ? 'あなたの順位' : null,
    `ヒント ${entry.hint_count}`,
    clearedAt.length > 0 ? clearedAt : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ・ ')

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: entry.is_me ? colors.surface : palette.transparent,
          borderColor: entry.is_me ? colors.accent : palette.divider,
          borderWidth: entry.is_me ? ME_ROW_BORDER_WIDTH : borderWidth.hairline,
        },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: badgeColor }]}>
        <Text style={[typography.mono, { color: badgeTextColor }]}>{entry.rank}</Text>
      </View>

      <View style={styles.middle}>
        <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
          {entry.display_name}
        </Text>
        <Text style={[typography.label, { color: colors.sub }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={[typography.subtitle, { color: colors.text }]}>{entry.move_count} 手</Text>
        {entry.perfect ? (
          <Text style={[typography.label, { color: tierPalettes.gold.accent }]}>
            {TIER_EMOJI.gold} 完全錬成
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    minHeight: LEADERBOARD_ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  badge: {
    width: RANK_BADGE_SIZE,
    height: RANK_BADGE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: spacing.xs },
  right: { alignItems: 'flex-end', gap: spacing.xs },
})
