/**
 * 画面遷移のパス。文字列をあちこちに散らかさないためにここだけで作る。
 * `app.json` の `experiments.typedRoutes` が有効なので、
 * 動的セグメントは `{ pathname, params }` の形で渡す（型が付く）。
 */

import type { Href } from 'expo-router'

export const LOBBY_HREF = '/play' as Href

export function gameHref(gameId: string): Href {
  return { pathname: '/play/game/[id]', params: { id: gameId } } as Href
}

export function resultHref(gameId: string, unlockedIds: readonly string[] = []): Href {
  return {
    pathname: '/play/result/[id]',
    params: { id: gameId, unlocked: unlockedIds.join(',') },
  } as Href
}

/**
 * 図鑑をそのゲームの軌跡にフォーカスして開く。
 * `?game=` は**一度きりの指示**として扱う（図鑑側が読んだら消す）ので、
 * 結果画面から何度飛んでも毎回その軌跡に寄る。
 */
export function spaceHref(gameId: string): Href {
  return { pathname: '/space', params: { game: gameId } } as Href
}
