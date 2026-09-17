/**
 * 順位一覧の「畳み方」。**ここは react-native に依存しない**
 * （theme と同じく、テストから素直に読めるようにするため）。
 *
 * **8 人ぶんを全部出すとゲームの入力欄と「混ぜる」が画面外に落ちる**
 * （390×844 の画面で input の top が 987 になっていた ＝ 満員に近いほど遊べない）。
 * レース中のオーバーレイは人数に応じて畳む。
 */

import type { RoomPlayer } from '@coto2ba/contracts'
import { ROOM_STANDING_COLLAPSED_ROWS } from './constants'

/** 表示する 1 行。`rank` は**サーバーが返した並びのままの順位**。 */
export type RankedEntry = {
  player: RoomPlayer
  rank: number
}

/**
 * 畳むときに何行残すか。**人数で変える。**
 *
 * 少人数（`ROOM_STANDING_COLLAPSED_ROWS` 人まで）は全員出しても操作系を押し下げないので、
 * そのまま全部出す。それを超えたら **1 行も出さない**（見出しだけにする）。
 *
 * 行を 1 つも出さなくてよいのは、**自分の順位と温度はゲーム画面本体が既に大きく出している**
 * から。オーバーレイにしか無い情報は「何人中の何位か」と「誰かがゴールしたか」で、
 * どちらも見出しに入る。詳しく見たい人は見出しをタップして広げる。
 */
export function collapsedRowsFor(playerCount: number): number {
  return playerCount <= ROOM_STANDING_COLLAPSED_ROWS ? playerCount : 0
}

/**
 * 畳むときに残す行を選ぶ。優先順は **「自分」「首位」「自分のすぐ上」**。
 *
 * 1 行しか残せないときに首位を出すと、**自分が何位なのか分からなくなる**ので
 * 自分を最優先にする。枠があれば首位と「あと誰を抜けばいいか」を足す。
 * 足りなければ上位から埋める。
 *
 * **順位は詰め直さない。** 5 位の人を 3 位として見せると勝負が成り立たない。
 */
export function pickImportantRows(players: readonly RoomPlayer[], maxRows: number): RankedEntry[] {
  const all: RankedEntry[] = players.map((player, index) => ({ player, rank: index + 1 }))
  if (all.length <= maxRows) return all

  const meIndex = all.findIndex((e) => e.player.is_me)
  const keep = new Set<number>()
  if (meIndex >= 0) keep.add(meIndex)
  if (keep.size < maxRows) keep.add(0)
  if (meIndex > 0 && keep.size < maxRows) keep.add(meIndex - 1)
  // 枠が余ったら上位から埋める。
  for (let i = 0; i < all.length && keep.size < maxRows; i += 1) keep.add(i)

  return [...keep]
    .sort((a, b) => a - b)
    .slice(0, maxRows)
    .map((i) => all[i])
    .filter((e): e is RankedEntry => e !== undefined)
}
