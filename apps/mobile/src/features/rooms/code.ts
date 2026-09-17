/**
 * 参加コードの取り扱い。**ここは react-native にも react-query にも依存しない**
 * （theme や `standings.ts` と同じく、テストから素直に読めるようにするため）。
 *
 * 判定の権威はサーバー。ここでやるのは「読み上げてもらって手入力する」導線と
 * 「QR で開く」導線のゆれを吸収することだけ。
 */

import type { RoomPlayer, RoomResponse } from '@coto2ba/contracts'
import { ROOM_CODE_MEMORY_LIMIT } from './constants'

/** 全角英数を半角に寄せるためのオフセット（Ａ→A）。 */
const FULLWIDTH_OFFSET = 0xfee0

/**
 * 手入力のゆれ（小文字・空白・全角・区切り）を吸収する。
 *
 * ブースでは口頭で読み上げて入れてもらうので、
 * 「ｑ８３ｄ」「q83d」「Q 83 D」「Q-83-D」がすべて `Q83D` になる必要がある。
 */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * ディープリンク（`exp://…?room=CODE`）から参加コードを取り出す。
 * `room` が付いていない普通の起動（開発サーバーの URL など）では null。
 */
export function roomCodeFromUrl(url: string): string | null {
  const match = /[?&]room=([^&#\s]+)/.exec(url)
  const raw = match?.[1]
  if (raw === undefined) return null
  const code = normalizeRoomCode(safeDecode(raw))
  return code.length === 0 ? null : code
}

/** 壊れた % エスケープで落ちないようにする。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 自分の行。まだ参加していなければ null。 */
export function myStanding(room: RoomResponse | undefined): RoomPlayer | null {
  return room?.players.find((p) => p.is_me) ?? null
}

/**
 * 先頭でゴールした人。まだ誰も着いていなければ null。
 * **サーバーが並べた順（`rankPlayers`）の 1 番目**だけを見る。端末で並べ替えない。
 */
export function winnerOf(room: RoomResponse | undefined): RoomPlayer | null {
  const first = room?.players[0]
  return first !== undefined && first.finished_at !== null ? first : null
}

/** 自分がホストか。**次の部屋を作れるのはホストだけ。** */
export function isHost(room: RoomResponse | undefined, userId: string | null): boolean {
  return room !== undefined && userId !== null && room.host_user_id === userId
}

/**
 * 部屋コードの印を覚える。**上限を超えたら古いものから捨てる。**
 *
 * ブースは 1 台で何十戦も回す（「もう一度」を押すたびに新しいコードが増える）ので、
 * 際限なく貯めない。捨てたコードにもう一度出会っても、参加を投げ直すだけで
 * サーバー側は冪等なので害が無い。`Set` は挿入順を保つので先頭が最も古い。
 */
export function rememberCode(set: Set<string>, code: string, limit: number): void {
  set.delete(code)
  set.add(code)
  while (set.size > limit) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

// ── 端末が覚えている印 ──────────────────────────────────────
/**
 * **3 つの印は別物なので、絶対に 1 つにまとめないこと。**
 *
 * 一度まとめて壊した実績がある。ディープリンクの「飛ばした」印を
 * 「参加を投げた」印と共有したとき、**着地した部屋の画面が
 * 「もう投げた」と判断して join を 1 本も投げなくなった**。
 * ポーリングは参加が通るまで止めてあるので join も poll も飛ばず、
 * **エラーも出ないまま画面が固まった**（QR ＝ ブースの主動線が沈黙して死んだ）。
 *
 * 画面ではなくここに置いてあるのは、**React を描かずに振る舞いを検証できる**ようにするため
 * （`tests/room-code.test.ts` が `openRoomFromDeepLink` → `shouldJoinOnArrival` を
 * この実体に対して通す）。
 */
const openedFromDeepLink = new Set<string>()
const joinAttempts = new Set<string>()
const joinedRooms = new Set<string>()

/**
 * ディープリンク（QR）で来た URL を処理する。
 * 開くべき部屋のコードを返す。開かなくてよければ null。
 *
 * **ここで付けるのは「飛ばした」印だけ。** 参加の印には触らない
 * （触ると着地先が join を投げなくなる）。
 */
export function openRoomFromDeepLink(url: string, limit = ROOM_CODE_MEMORY_LIMIT): string | null {
  const code = roomCodeFromUrl(url)
  if (code === null) return null
  // 同じ URL で何度も push しない（画面が変わるたびに同じ URL が届く）。
  if (openedFromDeepLink.has(code)) return null
  rememberCode(openedFromDeepLink, code, limit)
  return code
}

/**
 * 部屋の画面に着地したとき、参加を投げるべきか。
 * 投げるときは**その場で印を付ける**（`onMutate` に任せると、Web の hydrate で
 * 木が作り直されたときに 2 本飛ぶ競争が残る）。
 */
export function shouldJoinOnArrival(code: string, limit = ROOM_CODE_MEMORY_LIMIT): boolean {
  if (code.length === 0) return false
  if (joinAttempts.has(code)) return false
  rememberCode(joinAttempts, code, limit)
  return true
}

/** 参加を投げた印を付ける（部屋を作った / 入口から投げた など、画面の外から）。 */
export function markRoomJoinAttempted(code: string, limit = ROOM_CODE_MEMORY_LIMIT): void {
  rememberCode(joinAttempts, code, limit)
}

export function hasAttemptedRoomJoin(code: string): boolean {
  return joinAttempts.has(code)
}

/** 参加が**通った**印。ポーリングを始めてよいかの判断に使う（403 対策）。 */
export function markRoomJoined(code: string, limit = ROOM_CODE_MEMORY_LIMIT): void {
  rememberCode(joinedRooms, code, limit)
}

export function hasJoinedRoom(code: string): boolean {
  return joinedRooms.has(code)
}

/** テスト用。印を全部忘れる。 */
export function resetRoomCodeMemory(): void {
  openedFromDeepLink.clear()
  joinAttempts.clear()
  joinedRooms.clear()
}
