/**
 * レース中に**既存のゲーム画面へ重ねる**順位の帯（SPEC §9.2）。
 *
 * ゲーム画面は複製しない。`/play/game/[id]?room=CODE` で開かれたときだけ
 * これがゲーム画面の先頭に載り、`useRoomQuery` が 1 秒ごとに順位を取り直す。
 *
 * ここに出せるのは**順位・名前・手数・到達したいちばん良いランクだけ**。
 * 他人の語はサーバーが返さない（§9.2）。
 *
 * **既定は見出しだけに畳む。** 全員ぶんを出すとゲームの入力欄と「混ぜる」が
 * 画面外に落ちて、人が多いほど遊べなくなる（レビューで実測）。
 * 畳んだ高さは**人数によらず一定**なので、部屋が変わっても入力欄の位置が動かない。
 * 見出し（何人中の何位か / ゴールした人）をタップすると全員に広がる。
 *
 * 通信が数回失敗しても**画面を覆わない**。会場の Wi-Fi は不安定な前提で、
 * 前の順位を出したまま裏で追いつく（`useRoomQuery` の `placeholderData`）。
 */

import { ROOM_FINISH_GRACE_SECONDS, type TierId } from '@coto2ba/contracts'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { GlassCard, MIN_TAP_SIZE, SymbolIcon } from '../../components'
import { feedback } from '../../lib/feedback'
import { iconSize, radius, spacing, typography, useTheme } from '../../theme'
import { winnerOf } from './code'
import { useRoomQuery } from './queries'
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

  /** 既定は畳む。広げるのは見出しのタップ。 */
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const players = room.data?.players ?? []
  if (players.length === 0) return null

  /**
   * **畳んだときは見出しだけ。人数によらず高さが変わらない。**
   *
   * 人数で行数を変えると、3 人のときに 8 人より背が高くなる（実測 172px / 62px）という
   * ねじれが起き、入力欄の位置も部屋ごとに動く。ブースでは**同じ位置に同じものがある**
   * ほうが速いので、畳んだ高さは固定にして、見たい人だけ広げる。
   *
   * 見出しには「何人中の何位か」と「誰かがゴールしたか」が入る。自分の順位と温度は
   * ゲーム画面本体が大きく出しているので、これで足りる。
   */
  const canToggle = players.length > 0
  const me = players.find((p) => p.is_me)
  const myRank = me === undefined ? null : players.indexOf(me) + 1

  /**
   * **見出しの行が開閉も兼ねる。** 折りたたみ用の行を別に置くと、
   * それだけで 44pt（最小タップ領域）取られて入力欄が押し下がる。
   */
  const header = (
    <View style={styles.header}>
      <Text style={[typography.label, { color: colors.sub }]} numberOfLines={1}>
        対戦 {code}
      </Text>
      <View style={styles.trailing}>
        {winner === null ? (
          <Text style={[typography.label, { color: colors.sub }]}>
            {myRank === null ? `${players.length} 人` : `${myRank} / ${players.length} 位`}
          </Text>
        ) : (
          <>
            <SymbolIcon name="flag" size={iconSize.sm} color={colors.accent} />
            <Text style={[typography.label, { color: colors.accent }]} numberOfLines={1}>
              {winner.is_me ? 'あなたがゴール' : `${winner.display_name} がゴール`}
            </Text>
          </>
        )}
        {canToggle ? (
          <SymbolIcon
            name={expanded ? 'arrow.up' : 'arrow.down'}
            size={iconSize.sm}
            color={colors.sub}
          />
        ) : null}
      </View>
    </View>
  )

  return (
    <GlassCard tint={colors.glassTint} padding={spacing.md} style={styles.card}>
      {canToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? '順位を畳む' : `${players.length} 人の順位を見る`}
          accessibilityState={{ expanded }}
          onPress={toggle}
          style={styles.headerPress}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}

      {expanded ? <RoomStandings players={players} tier={tier} compact /> : null}

      {/* 誰かがゴールしたあとも打てる。**あと何秒で締め切られるのか**を書かないと
          「もう終わったのに入力できる」に見えて、来場者が手を止めてしまう。 */}
      {winner === null ? null : (
        <Text style={[typography.label, styles.note, { color: colors.sub }]}>
          あと {ROOM_FINISH_GRACE_SECONDS} 秒で結果に進みます
        </Text>
      )}
    </GlassCard>
  )
}

const styles = StyleSheet.create({
  // 内容ではなく**重ねる帯**なので、カードの既定より内側の余白を詰める。
  // ここを詰めないと 8 人のとき「混ぜる」が画面外に落ちる（実測で 6px 足りなかった）。
  card: { gap: spacing.sm, borderRadius: radius.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // 見出しが開閉を兼ねるので、当たり判定だけ Apple の 44pt まで広げる
  // （負のマージンでカードの余白ぶんに食い込ませ、見た目の高さは増やさない）。
  headerPress: {
    minHeight: MIN_TAP_SIZE,
    justifyContent: 'center',
    marginVertical: -spacing.sm,
  },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  note: { textAlign: 'center' },
})
