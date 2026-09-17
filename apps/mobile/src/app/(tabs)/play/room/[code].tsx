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

import { ROOM_FINISH_GRACE_SECONDS, ROOM_REMATCH_WATCH_MS } from '@coto2ba/contracts'
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
import { LOBBY_HREF, parseAchievementIds, resultHref, useMeQuery } from '../../../../features/game'
import {
  hasAttemptedRoomJoin,
  hasJoinedRoom,
  isHost,
  markRoomJoinAttempted,
  normalizeRoomCode,
  ROOM_ENTRY_HREF,
  RoomLobby,
  RoomResult,
  RoomStandings,
  roomGameHref,
  roomHref,
  useJoinRoomMutation,
  useLeaveRoomMutation,
  useRematchRoomMutation,
  useRoomQuery,
  useStartRoomMutation,
} from '../../../../features/rooms'
import { layout, screenPadding, typography, useTheme } from '../../../../theme'

/** 部屋は演出帯を持たない。ロビーと同じ落ち着いた地。 */
const ROOM_TIER = 'mono'

export default function RoomScreen() {
  const { code: raw, unlocked } = useLocalSearchParams<{ code: string; unlocked?: string }>()
  const code = normalizeRoomCode(typeof raw === 'string' ? raw : '')
  /**
   * ルーム戦でクリアしたときに解除された実績。
   * **自分の結果画面へ渡すためだけに持ち回る**（渡さないと、解除されたのに
   * どこにも出ないまま消える）。直接開いた（リロードした）ときは空でよい。
   */
  const unlockedIds = typeof unlocked === 'string' ? unlocked : ''
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(ROOM_TIER)

  const me = useMeQuery()
  const join = useJoinRoomMutation()
  const start = useStartRoomMutation(code)
  const rematch = useRematchRoomMutation(code)
  const leave = useLeaveRoomMutation(code)

  /**
   * **参加が通るまでポーリングを始めない。**
   *
   * 部屋の状態は参加者にしか返さない（コードを総当たりされても中身が漏れないように）ので、
   * 参加と同時に取りに行くと **先に着いた取得が 403 になる**
   * （QR で入るたびに 1 本無駄になり、コンソールにもエラーが出ていた）。
   *
   * 判断は**「投げたか」ではなく「通ったか」**（`hasJoinedRoom`）で行う。
   * Web は hydrate 直後にルート木が 1 度作り直される（`app/_layout.tsx` の
   * `useWebHydrationKey`）ため、「投げたか」で見ると**作り直された側が
   * 参加の完了を待たずに取りに行って 403 になる**（実際になった）。
   */
  const [readyToPoll, setReadyToPoll] = useState(() => hasJoinedRoom(code))

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
    // **投げる前に印を付ける。** mutation の `onMutate` に任せると、
    // Web の hydrate で作り直された側の効果が先に走って 2 本飛ぶ（実測で毎回 1 本無駄だった）。
    markRoomJoinAttempted(code)
    joinRoom(code)
  }, [code, joinRoom])

  /**
   * ポーリングは止めていても**キャッシュは購読している**ので、
   * 参加のレスポンスが書き込まれた瞬間にここへ届く。
   * 作り直された側の画面も、これで参加の完了を知って動き出す。
   */
  /**
   * 決着したあとも、**次の部屋（「もう一度」）のコードが来るまでは見張る**。
   * 見張るのは `ROOM_REMATCH_WATCH_MS` まで（結果画面を開いたまま放置された端末が
   * 枠を食い続けないように）。
   */
  const [watchingRematch, setWatchingRematch] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setWatchingRematch(false), ROOM_REMATCH_WATCH_MS)
    return () => clearTimeout(timer)
  }, [])

  const room = useRoomQuery(code.length > 0 ? code : null, {
    enabled: readyToPoll,
    watchForRematch: watchingRematch,
  })
  const hasRoomData = room.data !== undefined
  useEffect(() => {
    if (hasRoomData) setReadyToPoll(true)
  }, [hasRoomData])

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

  /**
   * **ホストが「もう一度」を押したら、全員がその部屋へ移る。**
   *
   * 押した本人はレスポンスで、ほかの参加者は終わった部屋のポーリングで届く
   * `next_code` で移る。各自が新しい部屋を作ると全員が別々の部屋で待つことになり、
   * ブースで誰も対戦を始められない（レビューで実測された）。
   */
  const nextCode = data?.next_code ?? null
  useEffect(() => {
    if (nextCode === null || nextCode === code) return
    router.replace(roomHref(nextCode))
  }, [nextCode, code, router])

  const onStart = useCallback(() => start.mutate(), [start])

  /**
   * 押した本人は**レスポンスで直接**次の部屋へ移る。
   *
   * `next_code` のポーリング頼みにすると、見張りが `ROOM_REMATCH_WATCH_MS` で
   * 切れたあとに押したとき**サーバーには部屋ができるのに画面が動かない**
   * （リロードすると飛ぶ）。ほかの参加者は今までどおりポーリングで移る。
   */
  const onRematch = useCallback(() => {
    rematch.mutate(undefined, { onSuccess: (next) => router.replace(roomHref(next.code)) })
  }, [rematch, router])

  /**
   * 部屋を出る。**待機中にホストが出たらサーバーが部屋ごと畳む**ので、
   * 残された人が 10 分待たされない。失敗しても画面はロビーへ戻す
   * （出るのを通信の成否に縛らない）。
   */
  const leaveRoom = leave.mutate
  const onLeave = useCallback(() => {
    leaveRoom(undefined, { onSettled: () => router.replace(LOBBY_HREF) })
  }, [leaveRoom, router])

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
            isHost={isHost(data, me.data?.id ?? null)}
            onRematch={onRematch}
            rematching={rematch.isPending}
            onOpenMyResult={
              data.my_game_id === null
                ? null
                : () =>
                    router.push(
                      resultHref(data.my_game_id as string, parseAchievementIds(unlockedIds)),
                    )
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
              {/* **なぜ待たされるのかを書く。** 来場者から見て理由が分からないと
                  「固まった」と思われてブースの流れが止まる。 */}
              <Text style={[typography.caption, { color: colors.sub }]}>
                誰かがゴールしてから {ROOM_FINISH_GRACE_SECONDS} 秒、
                または全員が終わると結果に進みます
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
