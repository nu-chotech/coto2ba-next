/**
 * 対戦ルームのサーバー状態（@tanstack/react-query）。
 *
 * **同期はポーリング。** Vercel では部屋 → インスタンスのアフィニティが無く、
 * 外部 Redis 無しに同じ部屋の全員へ配信できない（計画書の冒頭に根拠）。
 * レース中に流れるのは順位と手数だけなので、1 秒の遅れは順位バーの補間に乗って
 * 知覚されない。
 *
 * ポーリングで気を付けること:
 * - 終わった部屋では**止める**（展示中に無駄な通信を残さない）
 * - **バックグラウンドでは回さない**（端末をポケットに入れたまま一晩、が起きない）
 * - 数回失敗しても画面を壊さない。前の値を出したまま裏で追いつく
 */

import {
  type CreateRoomRequest,
  ROOM_POLL_INTERVAL_LOBBY_MS,
  ROOM_POLL_INTERVAL_RACE_MS,
  type RoomPlayer,
  type RoomResponse,
} from '@coto2ba/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  createRoom,
  getRoom,
  isApiError,
  joinRoom,
  leaveRoom,
  rematchRoom,
  startRoom,
} from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { ROOM_JOIN_RETRY_COUNT, ROOM_JOIN_RETRY_DELAY_MS } from './constants'

/**
 * `code` が null のあいだは走らせない。
 *
 * `enabled` を渡すとさらに絞れる。部屋の画面は**参加が済むまで止める**のに使う
 * （状態は参加者にしか返さないので、参加より先に着いた取得は 403 になる）。
 * `enabled: false` でもキャッシュは購読し続けるので、参加のレスポンスが
 * `queryKeys.room(code)` に書かれた瞬間に呼び出し側へ届く。
 */
export function useRoomQuery(
  code: string | null,
  options?: { enabled?: boolean; watchForRematch?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.room(code),
    queryFn: ({ signal }) => getRoom(code ?? '', signal),
    enabled: code !== null && code.length > 0 && (options?.enabled ?? true),
    /**
     * **状態で間隔を変える。** ロビーの人の出入りは秒単位で見えれば十分だが、
     * レース中は他人の順位の動きを追う必要がある。終わったら止める
     * （展示中に無駄な通信を残さない）。
     *
     * 例外は結果画面（`watchForRematch`）。ホストが「もう一度」を押したときの
     * 次の部屋のコードは**終わった部屋のポーリングで届く**ので、
     * そこだけはロビーと同じ間隔で見張り続ける。止め時は呼び出し側が
     * `enabled` で決める（`ROOM_REMATCH_WATCH_MS`）。
     */
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.status === 'finished') {
        if (options?.watchForRematch !== true) return false
        // 次の部屋が分かったらもう見張らなくてよい。
        return data.next_code === null ? ROOM_POLL_INTERVAL_LOBBY_MS : false
      }
      if (data?.status === 'playing') return ROOM_POLL_INTERVAL_RACE_MS
      return ROOM_POLL_INTERVAL_LOBBY_MS
    },
    refetchIntervalInBackground: false,
    // 会場の Wi-Fi は不安定な前提。**取り直しの失敗で画面を覆わない**ので、
    // 前の値を出したまま次のポーリングで追いつかせる。
    placeholderData: (previous) => previous,
  })
}

export function useCreateRoomMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRoomRequest) => createRoom(input),
    onSuccess: (room) => {
      cacheRoom(queryClient, room)
      // 作った人は既に参加者。部屋の画面が着地で join を投げ直さないように印を付ける。
      markRoomJoinAttempted(room.code)
      joinedRooms.add(room.code)
    },
  })
}

/**
 * 参加。サーバー側は**冪等**なので、QR で開き直しても、コードを打ち直しても増えない。
 *
 * **一過性の失敗では諦めない。** ブースでは 8 人が一斉に QR を読む。
 * 429 と通信断だけは少し待って投げ直す。
 * 満員・開始済み・存在しないコードは投げ直さない（結果が変わらない）。
 *
 * **この retry は起動時 429 の根本修正ではない。** 根本は
 * 「汎用バケツの容量が持続レートと同じ 5 に縛られていて、アプリを開いた瞬間の
 * バーストが必ず溢れる」ことで、そちらは `RATE_LIMIT_BURST_PER_USER` を
 * 分けて直してある（`apps/api/src/middleware/rateLimit.ts`）。
 * ここに残しているのは、会場の Wi-Fi が切れたときと、
 * 想定外の混み方をしたときの**最後の保険**として。
 */
export function useJoinRoomMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => joinRoom(code),
    onMutate: (code) => markRoomJoinAttempted(code),
    retry: (failureCount, error) => failureCount < ROOM_JOIN_RETRY_COUNT && isTransient(error),
    retryDelay: (failureCount) => ROOM_JOIN_RETRY_DELAY_MS * (failureCount + 1),
    onSuccess: (room) => {
      joinedRooms.add(room.code)
      cacheRoom(queryClient, room)
    },
  })
}

/** 参加が通った部屋。**画面の作り直しを跨いで**覚えておく（下の解説を参照）。 */
const joinedRooms = new Set<string>()

/** その部屋の参加者だと分かっているか。ポーリングを始めてよいかの判断に使う。 */
export function hasJoinedRoom(code: string): boolean {
  return joinedRooms.has(code)
}

/**
 * 参加を投げた部屋のコード。**モジュールスコープ**で覚える。
 *
 * - 入口の「参加する」で投げた直後に部屋の画面が開くので、そこで二重に投げない
 * - Web は hydrate 直後にルート木が 1 度作り直される（`app/_layout.tsx` の
 *   `useWebHydrationKey`）ので、`useRef` に置くと消えて二重送信になる
 *
 * 2 本目は汎用のレート制限バケツ（5 req/s）を無駄に食い、実際に 429 を踏んだ。
 * サーバー側は冪等なので**安全側に倒しても壊れない**（投げ直しは retry が行う）。
 */
const joinAttempts = new Set<string>()

export function markRoomJoinAttempted(code: string): void {
  joinAttempts.add(code)
}

export function hasAttemptedRoomJoin(code: string): boolean {
  return joinAttempts.has(code)
}

/** 投げ直せば結果が変わりうる失敗か。 */
function isTransient(error: unknown): boolean {
  if (!isApiError(error)) return false
  return error.isNetworkError || error.code === 'RATE_LIMITED'
}

export function useStartRoomMutation(code: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => startRoom(code),
    onSuccess: (room) => cacheRoom(queryClient, room),
  })
}

/**
 * 「もう一度」（ホストのみ）。**ホストだけが次の部屋を作る。**
 *
 * 以前は各自が `createRoom` を呼んでいたので、ホストと参加者が別々の部屋を作り、
 * **2 人が別々の部屋で待ち続けて誰も対戦が始まらなかった**（レビューで実測）。
 * いまはサーバーが終わった部屋に次のコードを書き残し、参加者はそれを見て移る。
 */
export function useRematchRoomMutation(code: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => rematchRoom(code),
    onSuccess: (room) => {
      joinedRooms.add(room.code)
      markRoomJoinAttempted(room.code)
      cacheRoom(queryClient, room)
    },
  })
}

/** 部屋を出る。待機中にホストが出ると部屋ごと畳まれる（ブースでの離脱対策）。 */
export function useLeaveRoomMutation(code: string) {
  return useMutation({
    mutationFn: () => leaveRoom(code),
  })
}

function cacheRoom(queryClient: ReturnType<typeof useQueryClient>, room: RoomResponse): void {
  queryClient.setQueryData<RoomResponse>(queryKeys.room(room.code), room)
}

/**
 * 手のレスポンスに同梱された順位（`room_standings`）をキャッシュに入れる。
 *
 * **自分の手はポーリングを待たずに順位へ反映される。** ポーリングは
 * 「他人の変化の検知」だけを担えばよくなるので、間隔を緩めても体感が落ちない。
 * ルーム戦でない手では `standings` が来ないので、何もしない。
 */
export function useApplyRoomStandings(code: string | null) {
  const queryClient = useQueryClient()
  return useCallback(
    (standings: readonly RoomPlayer[] | null | undefined) => {
      if (code === null || standings === null || standings === undefined) return
      queryClient.setQueryData<RoomResponse>(queryKeys.room(code), (previous) =>
        previous === undefined ? previous : { ...previous, players: [...standings] },
      )
    },
    [queryClient, code],
  )
}

// ── 表示用のちいさな導出 ────────────────────────────────────

/** ディープリンク（`exp://…?room=CODE`）から参加コードを取り出す。 */
export function roomCodeFromUrl(url: string): string | null {
  const match = /[?&]room=([^&#\s]+)/.exec(url)
  const raw = match?.[1]
  if (raw === undefined) return null
  const code = normalizeRoomCode(decodeURIComponent(raw))
  return code.length === 0 ? null : code
}

/** 手入力のゆれ（小文字・空白・全角）を吸収する。判定の権威はサーバー。 */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** 自分の行。まだ参加していなければ null。 */
export function myStanding(room: RoomResponse | undefined) {
  return room?.players.find((p) => p.is_me) ?? null
}

/** 先頭でゴールした人。まだ誰も着いていなければ null。 */
export function winnerOf(room: RoomResponse | undefined) {
  const first = room?.players[0]
  return first !== undefined && first.finished_at !== null ? first : null
}

/** 自分がホストか。 */
export function isHost(room: RoomResponse | undefined, userId: string | null): boolean {
  return room !== undefined && userId !== null && room.host_user_id === userId
}
