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
