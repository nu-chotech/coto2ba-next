/**
 * 対戦ルームの画面遷移。文字列をあちこちに散らかさないためにここだけで作る。
 * `app.json` の `experiments.typedRoutes` が有効なので、
 * 動的セグメントは `{ pathname, params }` の形で渡す。
 */

import type { Href } from 'expo-router'

/** 対戦の入口（部屋を作る / コードで参加する）。 */
export const ROOM_ENTRY_HREF = '/play/room' as Href

/** 部屋の画面（待機 → レースへ送り出す → 結果）。 */
export function roomHref(code: string): Href {
  return { pathname: '/play/room/[code]', params: { code } } as Href
}

/**
 * レース中のゲーム画面。**既存のゲーム画面をそのまま使い**、
 * `room` を渡したときだけ順位のオーバーレイが載る（画面を複製しない）。
 */
export function roomGameHref(gameId: string, code: string): Href {
  return { pathname: '/play/game/[id]', params: { id: gameId, room: code } } as Href
}
