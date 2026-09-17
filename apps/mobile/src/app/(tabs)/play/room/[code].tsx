/**
 * 部屋の画面（SPEC §9.5）。状態でそのまま出し分ける。
 *
 * - `waiting`  … 待機（コードと QR、参加者、ホストだけ開始ボタン）
 * - `playing`  … 自分のゲームへ送り出す（**画面は既存のゲーム画面を使う**）
 * - `finished` … 結果
 *
 * 開いたら **まず join を 1 回投げる**。サーバー側は冪等なので、
 * 「コードを打って来た人」「QR で来た人」「自分が作った部屋に戻ってきた人」を
 * 同じ 1 本で扱える。
 *
 * ポーリングは `useRoomQuery`。**失敗しても画面を覆わない**（会場の Wi-Fi は
 * 不安定な前提。前の状態を出したまま裏で追いつく）。初回の join すら通らなかった
 * ときだけ、入口へ戻す案内を出す。
 */

import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassButton,
  GlassCard,
  SkeletonCard,
  TierBackground,
  toMessageJa,
} from '../../../../components'
import { LOBBY_HREF, resultHref, useMeQuery } from '../../../../features/game'
import {
  hasAttemptedRoomJoin,
  isHost,
  normalizeRoomCode,
  ROOM_ENTRY_HREF,
  RoomLobby,
  RoomResult,
  RoomStandings,
  roomGameHref,
  roomHref,
  useCreateRoomMutation,
  useJoinRoomMutation,
  useRoomQuery,
  useStartRoomMutation,
} from '../../../../features/rooms'
import { layout, screenPadding, typography, useTheme } from '../../../../theme'

/** 部屋は演出帯を持たない。ロビーと同じ落ち着いた地。 */
const ROOM_TIER = 'mono'

export default function RoomScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>()
  const code = normalizeRoomCode(typeof raw === 'string' ? raw : '')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(ROOM_TIER)

  const me = useMeQuery()
  const room = useRoomQuery(code.length > 0 ? code : null)
  const join = useJoinRoomMutation()
  const start = useStartRoomMutation(code)
  const rematch = useCreateRoomMutation()

  /**
   * 開いたら 1 回だけ join を投げる（サーバー側は冪等）。
   *
   * 入口の「参加する」から来たときは既に投げてあるので、ここでは投げない
   * （`hasAttemptedRoomJoin` の理由は `features/rooms/queries.ts`）。
   * QR や直リンクで来たときはここが唯一の参加経路になる。
   */
  const joinRoom = join.mutate
  useEffect(() => {
    if (code.length === 0) return
    if (hasAttemptedRoomJoin(code)) return
    joinRoom(code)
  }, [code, joinRoom])

  /**
   * レースが始まったら自分のゲームへ。**戻るで待機に戻らない**よう replace。
   *
   * **自分のゲームがまだ `playing` のときだけ送り出す。** これを見ないと、
   * クリアしてこの画面に戻ってきた人をもう一度ゲームへ送り返してしまい、
   * 部屋とゲームを往復する（実際に起きた）。
   */
  const data = room.data ?? join.data ?? null
  const myGameId = data?.my_game_id ?? null
  const stillPlaying = data?.status === 'playing' && data.my_game_status === 'playing'
  const [sentToGame, setSentToGame] = useState(false)
  useEffect(() => {
    if (!stillPlaying || myGameId === null || sentToGame) return
    setSentToGame(true)
    router.replace(roomGameHref(myGameId, code))
  }, [stillPlaying, myGameId, sentToGame, router, code])

  const onStart = useCallback(() => start.mutate(), [start])

  const onRematch = useCallback(() => {
    if (data === null) return
    rematch.mutate(
      { difficulty: data.difficulty },
      { onSuccess: (next) => router.replace(roomHref(next.code)) },
    )
  }, [data, rematch, router])

  const onLeave = useCallback(() => router.replace(LOBBY_HREF), [router])

  // 参加すらできなかった（満員・開始済み・存在しない）。ここだけは画面を覆う。
  if (data === null && join.isError) {
    return (
      <TierBackground tier={ROOM_TIER}>
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <ErrorState
            error={join.error}
            onRetry={() => router.replace(ROOM_ENTRY_HREF)}
            tier={ROOM_TIER}
            title="この部屋には入れませんでした"
          />
        </View>
      </TierBackground>
    )
  }

  if (data === null) {
    return (
      <TierBackground tier={ROOM_TIER}>
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <SkeletonCard />
        </View>
      </TierBackground>
    )
  }

  return (
    <TierBackground tier={ROOM_TIER}>
      <ScrollView contentContainerStyle={[styles.content, screenPadding(insets)]}>
        {data.status === 'finished' ? (
          <RoomResult
            room={data}
            onRematch={onRematch}
            rematching={rematch.isPending}
            onOpenMyResult={
              data.my_game_id === null
                ? null
                : () => router.push(resultHref(data.my_game_id as string))
            }
            onLeave={onLeave}
            error={rematch.isError ? toMessageJa(rematch.error) : null}
          />
        ) : data.status === 'playing' ? (
          stillPlaying ? (
            // ゲーム画面へ送り出す途中。一瞬だけ出る。
            <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
              はじまりました
            </Text>
          ) : (
            // 自分はもう終わっている。**他の人の決着を待つ**あいだ順位を見せる
            // （ここで画面を閉じると、勝ったかどうかが分からないまま終わる）。
            <GlassCard tint={colors.glassTint} style={styles.card}>
              <Text style={[typography.label, { color: colors.sub }]}>対戦 {data.code}</Text>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ほかの人を待っています
              </Text>
              <RoomStandings players={data.players} tier={ROOM_TIER} />
              <GlassButton
                title="ロビーへ戻る"
                onPress={onLeave}
                tier={ROOM_TIER}
                variant="ghost"
              />
            </GlassCard>
          )
        ) : (
          <RoomLobby
            room={data}
            isHost={isHost(data, me.data?.id ?? null)}
            onStart={onStart}
            starting={start.isPending}
            startError={start.isError ? toMessageJa(start.error) : null}
            onLeave={onLeave}
          />
        )}
      </ScrollView>
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  card: { gap: layout.cardGap },
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: layout.sectionGap,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    textAlign: 'center',
    paddingHorizontal: layout.screenPaddingHorizontal,
  },
})
