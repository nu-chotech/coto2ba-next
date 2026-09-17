/**
 * 対戦ルームの画面遷移。文字列をあちこちに散らかさないためにここだけで作る。
 * `app.json` の `experiments.typedRoutes` が有効なので、
 * 動的セグメントは `{ pathname, params }` の形で渡す。
 */

import type { Href } from 'expo-router'

/** 対戦の入口（部屋を作る / コードで参加する）。 */
export const ROOM_ENTRY_HREF = '/play/room' as Href

/**
 * 部屋の画面（待機 → レースへ送り出す → 結果）。
 *
 * `unlockedIds` は**ルーム戦でクリアしたときに解除された実績**。
 * ルーム戦の行き先は部屋の結果なので、ここで持ち回さないと
 * **解除された実績がどこにも出ないまま消える**（自分の結果画面は URL の
 * `unlocked` からしか受け取れない）。
 */
export function roomHref(code: string, unlockedIds: readonly string[] = []): Href {
  return {
    pathname: '/play/room/[code]',
    params: { code, unlocked: unlockedIds.join(',') },
  } as Href
}

/**
 * レース中のゲーム画面。**既存のゲーム画面をそのまま使い**、
 * `room` を渡したときだけ順位のオーバーレイが載る（画面を複製しない）。
 */
export function roomGameHref(gameId: string, code: string): Href {
  return { pathname: '/play/game/[id]', params: { id: gameId, room: code } } as Href
}
