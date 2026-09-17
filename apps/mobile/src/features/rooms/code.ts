/**
 * 参加コードの取り扱い。**ここは react-native にも react-query にも依存しない**
 * （theme や `standings.ts` と同じく、テストから素直に読めるようにするため）。
 *
 * 判定の権威はサーバー。ここでやるのは「読み上げてもらって手入力する」導線と
 * 「QR で開く」導線のゆれを吸収することだけ。
 */

import type { RoomPlayer, RoomResponse } from '@coto2ba/contracts'

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
 *
 * **印の種類ごとに別の Set を渡すこと。** 1 つを使い回すと、
 * 「ディープリンクで飛ばした」印が「参加を投げた」印を兼ねてしまい、
 * **着地先が参加を投げなくなる**（実際に QR 経由の参加が沈黙して壊れた）。
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
