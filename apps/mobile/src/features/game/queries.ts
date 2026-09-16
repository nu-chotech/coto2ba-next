/**
 * ゲームのサーバー状態（@tanstack/react-query）。
 *
 * - API 呼び出しは `src/lib/api.ts` だけを通す（zod 検証・401 の自己修復つき）。
 * - **クエリキーは `lib/queryClient.ts` の `queryKeys`。** ここで文字列を作らない。
 * - **サーバーがまだ動いていない前提で書く。** どのフックも「エラーを返す」だけで、
 *   画面を壊さない（呼び出し側が ErrorState を出す）。
 * - 1 手の mutation は `MIX_ANIMATION_MIN_MS` を保証してから解決する。
 *   応答が 80ms でも 600ms 見せる（SPEC §8.3 の演出のルール）。
 */

import {
  type CreateGameRequest,
  type Difficulty,
  type Game,
  type GameDetail,
  MIX_ANIMATION_MIN_MS,
  type Move,
  type MoveRequest,
  type MoveResponse,
  tierForRank,
} from '@coto2ba/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGame,
  getDaily,
  getGame,
  getMe,
  getWordDescription,
  giveUp,
  postHint,
  postMove,
} from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'

/** 最低表示時間を満たすまで待つ。 */
async function holdAtLeast<T>(startedAt: number, value: T): Promise<T> {
  const remaining = MIX_ANIMATION_MIN_MS - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remaining)
    })
  }
  return value
}

// ── 読み取り ────────────────────────────────────────────────

export function useMeQuery() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => getMe(signal),
  })
}

export function useDailyQuery() {
  return useQuery({
    queryKey: queryKeys.daily(),
    queryFn: ({ signal }) => getDaily(signal),
  })
}

/** `gameId` が null のあいだは走らせない。 */
export function useGameQuery(gameId: string | null) {
  return useQuery({
    queryKey: queryKeys.game(gameId ?? ''),
    queryFn: ({ signal }) => getGame(gameId ?? '', signal),
    enabled: gameId !== null && gameId.length > 0,
  })
}

/**
 * 語の説明。**結果アニメーションが終わってから**呼ぶ（SPEC §7.6）。
 * 失敗しても UI は壊さない（説明が出ないだけ）。
 */
export function useWordDescriptionQuery(word: string | null) {
  return useQuery({
    queryKey: queryKeys.wordDescription(word ?? ''),
    queryFn: ({ signal }) => getWordDescription(word ?? '', signal),
    enabled: word !== null && word.length > 0,
    retry: false,
  })
}

// ── 書き込み ────────────────────────────────────────────────

export function useCreateGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGameRequest) => createGame(input),
    onSuccess: (game) => {
      queryClient.setQueryData<GameDetail>(
        queryKeys.game(game.id),
        (previous) => previous ?? { ...game, moves: [] },
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.daily() })
    },
  })
}

export type MixResult = {
  response: MoveResponse
  /** 表示用に組み立てた手（履歴に足す）。 */
  move: Move
}

/**
 * 1 手打つ。
 * **解決までに必ず `MIX_ANIMATION_MIN_MS` 以上かかる。** 画面はこの間、混合演出を出す。
 * 成功したらキャッシュを手元で更新してから裏で取り直す
 * （演出直後に古い `current` が一瞬見えるのを防ぐ）。
 */
export function useMoveMutation(gameId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: MoveRequest): Promise<MixResult> => {
      const startedAt = Date.now()
      const response = await postMove(gameId, input)
      const move: Move = {
        seq: response.move_count,
        input_word: input.input_word,
        ratio: input.ratio,
        result: response.result,
        rank: response.rank,
        tier: response.tier,
        created_at: new Date().toISOString(),
      }
      return holdAtLeast(startedAt, { response, move })
    },
    onSuccess: ({ response, move }) => {
      applyMoveToCache(queryClient, gameId, response, move)
      void queryClient.invalidateQueries({ queryKey: queryKeys.game(gameId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.daily() })
    },
  })
}

/** 手の結果をキャッシュに反映する（サーバーの再取得を待たずに画面を進める）。 */
function applyMoveToCache(
  queryClient: QueryClient,
  gameId: string,
  response: MoveResponse,
  move: Move,
): void {
  queryClient.setQueryData<GameDetail>(queryKeys.game(gameId), (previous) => {
    if (previous === undefined) return previous
    return {
      ...previous,
      current: response.result,
      current_rank: response.rank,
      move_count: response.move_count,
      hint_count: response.hint_count,
      status: response.status,
      perfect: response.perfect,
      moves: [...previous.moves, move],
    }
  })
}

export function useHintMutation(gameId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => postHint(gameId),
    onSuccess: (data) => {
      queryClient.setQueryData<GameDetail>(queryKeys.game(gameId), (previous) =>
        previous === undefined ? previous : { ...previous, hint_count: data.hint_count },
      )
    },
  })
}

export function useGiveUpMutation(gameId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => giveUp(gameId),
    onSuccess: (game: Game) => {
      queryClient.setQueryData<GameDetail>(queryKeys.game(gameId), (previous) =>
        previous === undefined ? previous : { ...previous, ...game },
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.daily() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    },
  })
}

// ── 表示用のちいさな導出 ────────────────────────────────────

/** 履歴から「前の手のランク」を出す。初手の前は start のランク。 */
export function previousRank(game: GameDetail): number | null {
  const { moves } = game
  if (moves.length === 0) return null
  if (moves.length === 1) return null
  const prev = moves[moves.length - 2]
  return prev === undefined ? null : prev.rank
}

/** いま画面が出すべき tier。 */
export function currentTier(game: GameDetail) {
  return tierForRank(game.current_rank)
}

/** 自己ベスト（フリーモード）の表示文。無ければ null。 */
export function bestFreeMovesLabel(
  best: Partial<Record<Difficulty, number>> | undefined,
  difficulty: Difficulty,
): string | null {
  const value = best?.[difficulty]
  return value === undefined ? null : `自己ベスト ${value} 手`
}
