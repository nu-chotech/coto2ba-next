/**
 * レース中に**既存のゲーム画面へ重ねる**順位の帯（SPEC §9.2）。
 *
 * ゲーム画面は複製しない。`/play/game/[id]?room=CODE` で開かれたときだけ
 * これがゲーム画面の先頭に載り、`useRoomQuery` が 1 秒ごとに順位を取り直す。
 *
 * ここに出せるのは**順位・名前・手数・到達したいちばん良いランクだけ**。
 * 他人の語はサーバーが返さない（§9.2）。
 *
 * 通信が数回失敗しても**画面を覆わない**。会場の Wi-Fi は不安定な前提で、
 * 前の順位を出したまま裏で追いつく（`useRoomQuery` の `placeholderData`）。
 */

import type { TierId } from '@coto2ba/contracts'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { GlassCard, SymbolIcon } from '../../components'
import { feedback } from '../../lib/feedback'
import { iconSize, radius, spacing, typography, useTheme } from '../../theme'
import { useRoomQuery, winnerOf } from './queries'
import { RoomStandings } from './RoomStandings'
import { roomHref } from './routes'

export type RoomRaceProps = {
  code: string
  tier: TierId
}

export function RoomRace({ code, tier }: RoomRaceProps) {
  const router = useRouter()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  const room = useRoomQuery(code)
  const winner = winnerOf(room.data)
  const announced = useRef<string | null>(null)

  // 誰かがゴールした瞬間に気づけるようにする（1 人につき 1 回だけ鳴らす）。
  useEffect(() => {
    if (winner === null) return
    if (announced.current === winner.user_id) return
    announced.current = winner.user_id
    feedback('achievement')
  }, [winner])

  // 部屋が畳まれたら結果へ。自分がまだ打っていても、勝負は決まっている。
  const finished = room.data?.status === 'finished'
  useEffect(() => {
    if (finished) router.replace(roomHref(code))
  }, [finished, router, code])

  const players = room.data?.players ?? []
  if (players.length === 0) return null

  return (
    <GlassCard tint={colors.glassTint} style={styles.card}>
      <View style={styles.header}>
        <Text style={[typography.label, { color: colors.sub }]}>対戦 {code}</Text>
        {winner === null ? (
          <Text style={[typography.label, { color: colors.sub }]}>{players.length} 人</Text>
        ) : (
          <View style={styles.winner}>
            <SymbolIcon name="flag" size={iconSize.sm} color={colors.accent} />
            <Text style={[typography.label, { color: colors.accent }]} numberOfLines={1}>
              {winner.is_me ? 'あなたがゴール' : `${winner.display_name} がゴール`}
            </Text>
          </View>
        )}
      </View>

      <RoomStandings players={players} tier={tier} compact />
    </GlassCard>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, borderRadius: radius.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  winner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
})
