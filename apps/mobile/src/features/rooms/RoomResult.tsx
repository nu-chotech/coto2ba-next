/**
 * 対戦の結果（SPEC §9.5）。
 *
 * 勝者を大きく見せ、その下に順位一覧を出す。
 * **「もう一度」で同じ難易度の新しい部屋を 1 タップで作れる**ようにする
 * （行列ができている前提で、ホストが同じ操作を何度も繰り返せることが要件）。
 *
 * 自分のゲームそのものの結果（経路・実績・シェア）は既存の結果画面に任せる。
 * ここで作り直さない。
 */

import { DIFFICULTY_LABELS_JA, type RoomResponse } from '@coto2ba/contracts'
import { StyleSheet, Text, View } from 'react-native'
import { GlassButton, GlassCard, HERO_LINE_HEIGHT_RATIO } from '../../components'
import { heroFontSize, layout, radius, spacing, typography, useTheme } from '../../theme'
import { RoomStandings } from './RoomStandings'

/** 結果は落ち着いた地で出す（勝者の色は行の側で金にする）。 */
const RESULT_TIER = 'mono'

export type RoomResultProps = {
  room: RoomResponse
  /** 同じ難易度で新しい部屋を作る。 */
  onRematch: () => void
  rematching: boolean
  /** 自分のゲームの結果画面へ。`my_game_id` が無ければ出さない。 */
  onOpenMyResult: (() => void) | null
  onLeave: () => void
  /** 「もう一度」に失敗したときの一言。 */
  error: string | null
}

export function RoomResult({
  room,
  onRematch,
  rematching,
  onOpenMyResult,
  onLeave,
  error,
}: RoomResultProps) {
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(RESULT_TIER)
  const winner = room.players[0]
  const cleared = winner !== undefined && winner.finished_at !== null

  return (
    <>
      <GlassCard tint={colors.glassTint} style={styles.card}>
        <Text style={[typography.label, { color: colors.sub }]}>
          {cleared ? '勝者' : '決着しました'}
        </Text>
        {cleared ? (
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            style={[
              typography.hero,
              styles.center,
              {
                color: colors.text,
                fontSize: heroFontSize(winner.display_name),
                lineHeight: heroFontSize(winner.display_name) * HERO_LINE_HEIGHT_RATIO,
              },
            ]}
          >
            {winner.display_name}
          </Text>
        ) : (
          <Text style={[typography.subtitle, styles.center, { color: colors.text }]}>
            誰もゴールに届きませんでした
          </Text>
        )}

        {room.goal !== null ? (
          <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
            お題は「{room.goal}」（{DIFFICULTY_LABELS_JA[room.difficulty]}）
          </Text>
        ) : null}
      </GlassCard>

      <GlassCard tint={colors.glassTint} style={styles.card}>
        <Text style={[typography.label, { color: colors.sub }]}>順位</Text>
        <RoomStandings players={room.players} tier={RESULT_TIER} />
      </GlassCard>

      <View style={styles.actions}>
        <GlassButton
          title="もう一度"
          onPress={onRematch}
          tier={RESULT_TIER}
          loading={rematching}
          subtitle="同じ難易度で新しい部屋を作ります"
        />
        {onOpenMyResult !== null ? (
          <GlassButton
            title="自分の結果を見る"
            onPress={onOpenMyResult}
            tier={RESULT_TIER}
            variant="secondary"
          />
        ) : null}
        <GlassButton title="ロビーへ戻る" onPress={onLeave} tier={RESULT_TIER} variant="ghost" />
      </View>

      {error !== null ? (
        <Text style={[typography.caption, styles.center, { color: colors.sub }]}>{error}</Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  card: { gap: layout.cardGap, borderRadius: radius.lg },
  center: { textAlign: 'center' },
  actions: { gap: spacing.md },
})
