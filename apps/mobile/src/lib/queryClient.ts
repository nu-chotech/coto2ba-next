/**
 * react-query v5 の QueryClient。
 *
 * サーバー状態はすべてここ経由。UI 状態は zustand（src/store）。
 * 認証エラー・入力エラーはリトライしても直らないので弾く。
 */

import { QueryClient } from '@tanstack/react-query'
import { isApiError } from './api'
import { QUERY_GC_TIME_MS, QUERY_RETRY_COUNT, QUERY_STALE_TIME_MS } from './constants'

/** リトライしても結果が変わらないエラー。 */
function isTerminalError(error: unknown): boolean {
  if (!isApiError(error)) return false
  if (error.isNetworkError) return false
  return error.status >= 400 && error.status < 500
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (isTerminalError(error)) return false
          return failureCount < QUERY_RETRY_COUNT
        },
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // 手を打つ・ヒントを引くは副作用があるので自動リトライしない。
        retry: 0,
      },
    },
  })
}

/** アプリ全体で 1 つ。 */
export const queryClient = createQueryClient()

/** クエリキー。文字列を散らかさないようここに集める。 */
export const queryKeys = {
  me: () => ['me'] as const,
  daily: () => ['daily'] as const,
  game: (gameId: string) => ['game', gameId] as const,
  leaderboard: (date: string | null) => ['leaderboard', date] as const,
  wordDescription: (word: string) => ['word', word, 'description'] as const,
  wordDetail: (word: string) => ['word', word, 'detail'] as const,
  collection: () => ['collection'] as const,
  achievements: () => ['achievements'] as const,
} as const
