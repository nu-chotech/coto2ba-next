/**
 * ランク表示（SPEC §8.3-3）。
 *
 * 数値 + 温度バー。温度は対数（contracts の `rankToHeat`）。
 * 前の手からの変化を矢印と色で出す。rank は **小さいほどゴールに近い** ので、
 * 減ったときが「近づいた」＝ positive。
 */

import { PERFECT_RANK, rankToHeat, type TierId } from '@coto2ba/contracts'
import { useEffect } from 'react'
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { iconSize, radius, spacing, typography, useTheme } from '../theme'
import { RANK_METER_DURATION_MS, RANK_METER_HEIGHT } from './constants'
import { SymbolIcon } from './SymbolIcon'
import type { SymbolName } from './symbols'

export type RankMeterProps = {
  rank: number
  /** 前の手のランク。null なら変化を出さない（初手 / 履歴なし）。 */
  prevRank?: number | null
  tier: TierId
  style?: StyleProp<ViewStyle>
}

function formatRank(rank: number): string {
  if (rank <= PERFECT_RANK) return '完全錬成'
  return `${rank.toLocaleString('ja-JP')} 位`
}

/**
 * 前手からの差分（「1,204 近づいた」）。null なら出さない。
 * 矢印は文字ではなくアイコンで出す（`icon`）ので、ここでは名前だけ返す。
 */
type Delta = { icon: SymbolName | null; text: string }

function formatDelta(rank: number, prevRank: number | null | undefined): Delta | null {
  if (prevRank === null || prevRank === undefined) return null
  const diff = prevRank - rank
  if (diff === 0) return { icon: null, text: '変わらず' }
  const label = diff > 0 ? '近づいた' : '遠ざかった'
  return {
    icon: diff > 0 ? 'arrow.up' : 'arrow.down',
    text: `${Math.abs(diff).toLocaleString('ja-JP')} ${label}`,
  }
}

export function RankMeter({ rank, prevRank = null, tier, style }: RankMeterProps) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  const heat = rankToHeat(rank)
  const fill = useSharedValue(heat)

  useEffect(() => {
    fill.value = withTiming(heat, { duration: RANK_METER_DURATION_MS })
  }, [heat, fill])

  // 幅をパーセント文字列で動かすと型も再レイアウトも重いので、
  // 全幅のバーを左端基準で scaleX する。
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(fill.value, 0.02) }],
  }))

  const delta = formatDelta(rank, prevRank)
  const closer = prevRank !== null && prevRank !== undefined && rank < prevRank
  const farther = prevRank !== null && prevRank !== undefined && rank > prevRank
  const deltaColor = closer ? palette.positive : farther ? palette.negative : colors.sub

  return (
    <View style={[styles.root, style]}>
      <View style={styles.row}>
        <Text style={[typography.subtitle, { color: colors.text }]}>{formatRank(rank)}</Text>
        {delta !== null ? (
          <View style={styles.delta}>
            {delta.icon !== null ? (
              <SymbolIcon
                name={delta.icon}
                size={iconSize.sm}
                color={deltaColor}
                weight="semibold"
              />
            ) : null}
            <Text style={[typography.label, { color: deltaColor }]}>{delta.text}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.track, { backgroundColor: palette.border }]}>
        <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fillStyle]} />
      </View>
      <Text style={[typography.label, { color: colors.sub }]}>
        ゴールまでの温度 {Math.round(heat * 100)}%
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  track: {
    height: RANK_METER_HEIGHT,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: { height: '100%', width: '100%', borderRadius: radius.pill, transformOrigin: 'left' },
})
