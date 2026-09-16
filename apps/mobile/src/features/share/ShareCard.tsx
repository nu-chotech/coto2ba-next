/**
 * 結果カード（RN ビュー版）。`captureRef` で PNG にする対象。
 *
 * **Skia を一切使わない。** `captureRef` はビューの `draw()` 経路を通るので、
 * Skia の Canvas が混ざるとその部分が真っ白になる（docs/research/rn-game-ui.md）。
 * 純粋な `View` / `Text` だけで組む。
 *
 * 地は必ず不透明にすること（透明のまま撮ると真っ黒な PNG になる端末がある）。
 *
 * 画面には出さない。`ShareCardHost` が画面外に置いて描画だけさせる。
 */

import { DIFFICULTY_LABELS_JA, type GameDetail, LANDING_URL, MAX_MOVES } from '@coto2ba/contracts'
import type { RefObject } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { borderWidth, paletteForTier, radius, spacing, typography } from '../../theme'
import { currentTier, shortDate, tierPath } from '../game'
import {
  SHARE_CARD_GOAL_FONT_SIZE,
  SHARE_CARD_GOAL_LINE_HEIGHT,
  SHARE_CARD_OFFSCREEN,
  SHARE_CARD_PATH_FONT_SIZE,
  SHARE_CARD_PATH_LINE_HEIGHT,
  SHARE_CARD_WIDTH,
} from './constants'

export type ShareCardProps = {
  game: GameDetail
}

export function ShareCard({ game }: ShareCardProps) {
  const tier = currentTier(game)
  const colors = paletteForTier(tier)
  const cleared = game.status === 'cleared'
  const path = tierPath(game)

  const headline = game.perfect ? '完全錬成' : cleared ? 'クリア' : 'ギブアップ'
  const summary = cleared
    ? `${game.move_count} 手で${game.perfect ? '完全錬成' : 'クリア'}（ヒント ${game.hint_count}）`
    : `${game.move_count} 手でギブアップ（ヒント ${game.hint_count}）`

  return (
    <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.accent }]}>
      <View style={styles.row}>
        <Text style={[typography.label, { color: colors.sub }]}>コトコトバ</Text>
        <Text style={[typography.label, { color: colors.sub }]}>{shortDate(game)}</Text>
      </View>

      <Text style={[typography.subtitle, styles.center, { color: colors.accent }]}>{headline}</Text>

      <Text style={[typography.hero, styles.goal, { color: colors.text }]} numberOfLines={1}>
        {game.goal}
      </Text>

      <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
        {game.start} → {game.goal}
      </Text>

      {path.length > 0 ? (
        <Text style={[styles.path, { color: colors.text }]} numberOfLines={2}>
          {path.join('')}
        </Text>
      ) : null}

      <Text style={[typography.body, styles.center, { color: colors.text }]}>{summary}</Text>

      <View style={styles.row}>
        <Text style={[typography.label, { color: colors.sub }]}>
          {DIFFICULTY_LABELS_JA[game.difficulty]}
        </Text>
        <Text style={[typography.label, { color: colors.sub }]}>最大 {MAX_MOVES} 手</Text>
      </View>

      <Text style={[typography.label, styles.center, { color: colors.sub }]}>{LANDING_URL}</Text>
    </View>
  )
}

/**
 * 画面外に置いて描画だけさせる入れ物。
 * `collapsable={false}` が無いと iOS / Android で View が畳まれて撮れない。
 */
export function ShareCardHost({
  hostRef,
  game,
}: {
  hostRef: RefObject<View | null>
  game: GameDetail | null
}) {
  if (game === null) return null
  return (
    <View style={styles.host} pointerEvents="none" collapsable={false} ref={hostRef}>
      <ShareCard game={game} />
    </View>
  )
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: SHARE_CARD_OFFSCREEN,
    top: 0,
    width: SHARE_CARD_WIDTH,
  },
  card: {
    width: SHARE_CARD_WIDTH,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: borderWidth.thick,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { textAlign: 'center' },
  goal: {
    textAlign: 'center',
    fontSize: SHARE_CARD_GOAL_FONT_SIZE,
    lineHeight: SHARE_CARD_GOAL_LINE_HEIGHT,
  },
  path: {
    fontSize: SHARE_CARD_PATH_FONT_SIZE,
    lineHeight: SHARE_CARD_PATH_LINE_HEIGHT,
    textAlign: 'center',
  },
})
