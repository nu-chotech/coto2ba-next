/**
 * ランキングのサーバー状態（@tanstack/react-query）。
 *
 * - API は `src/lib/api.ts` だけを通す（zod 検証・401 の自己修復つき）。
 * - クエリキーは `lib/queryClient.ts` の `queryKeys`。ここで文字列を作らない。
 * - **サーバーがまだ動いていない前提で書く。** 失敗しても画面は壊さない。
 */

import type { LeaderboardEntry, LeaderboardResponse } from '@coto2ba/contracts'
import { useQuery } from '@tanstack/react-query'
import { getLeaderboard } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { isFutureDate } from './dates'

/**
 * その日のデイリーランキング。
 * 未来の日付は取りに行かない（サーバーが空を返すだけだが往復が無駄）。
 */
export function useLeaderboardQuery(date: string) {
  return useQuery({
    queryKey: queryKeys.leaderboard(date),
    queryFn: ({ signal }) => getLeaderboard(date, signal),
    enabled: date.length > 0 && !isFutureDate(date),
  })
}

/**
 * 上位 50 に自分が入っていないときだけ、自分の行を別枠で出す。
 * サーバーが返す `me` は常に自分の順位（入っていても返る）。
 */
export function outsideTopEntry(data: LeaderboardResponse | undefined): LeaderboardEntry | null {
  if (data === undefined || data.me === null) return null
  const inTop = data.entries.some((entry) => entry.user_id === data.me?.user_id)
  return inTop ? null : data.me
}

/** 「12 人がクリア」。0 のときは null（空表示に任せる）。 */
export function clearedCountLabel(data: LeaderboardResponse | undefined): string | null {
  if (data === undefined || data.total <= 0) return null
  return `${data.total.toLocaleString('ja-JP')} 人がクリア`
}
