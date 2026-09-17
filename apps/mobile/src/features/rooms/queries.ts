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
import { createRoom, getRoom, isApiError, joinRoom, startRoom } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { ROOM_JOIN_RETRY_COUNT, ROOM_JOIN_RETRY_DELAY_MS } from './constants'

/** `code` が null のあいだは走らせない。 */
export function useRoomQuery(code: string | null) {
  return useQuery({
    queryKey: queryKeys.room(code),
    queryFn: ({ signal }) => getRoom(code ?? '', signal),
    enabled: code !== null && code.length > 0,
    /**
     * **状態で間隔を変える。** ロビーの人の出入りは秒単位で見えれば十分だが、
     * レース中は他人の順位の動きを追う必要がある。終わったら止める
     * （展示中に無駄な通信を残さない）。
     */
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'finished') return false
      if (status === 'playing') return ROOM_POLL_INTERVAL_RACE_MS
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
    onSuccess: (room) => cacheRoom(queryClient, room),
  })
}

/**
 * 参加。サーバー側は**冪等**なので、QR で開き直しても、コードを打ち直しても増えない。
 *
 * **一過性の失敗では諦めない。** ブースでは 8 人が一斉に QR を読む。
 * 参加は汎用のレート制限バケツ（5 req/s）を使うので、
 * 画面を開いた瞬間に走る他のクエリ（図鑑・デイリー・語の説明）と重なると
 * 429 を踏む（実際に踏んだ）。429 と通信断だけは少し待って投げ直す。
 * 満員・開始済み・存在しないコードは投げ直さない（結果が変わらない）。
 */
export function useJoinRoomMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => joinRoom(code),
    retry: (failureCount, error) => failureCount < ROOM_JOIN_RETRY_COUNT && isTransient(error),
    retryDelay: (failureCount) => ROOM_JOIN_RETRY_DELAY_MS * (failureCount + 1),
    onSuccess: (room) => cacheRoom(queryClient, room),
  })
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
