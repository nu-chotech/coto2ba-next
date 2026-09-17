/**
 * 対戦ルームのルール（設計 §9.2）。**純粋関数だけ**を置く。
 *
 * `rules.ts` と同じ立て付けで、DB を触る `services/rooms.ts` はここを通してしか
 * 状態を進めない。ルームの勝敗は **最初にゴールへ着いた人が勝ち**なので、
 * デイリーランキング（ヒント数 → 手数 → クリア時刻）とは並び順が違う。
 * 同じに揃えてはいけない ── レースの勝者が後から入れ替わってしまう。
 */
import {
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  ROOM_STATUSES,
  type RoomStatus,
} from '@coto2ba/contracts'

/** DB の text 列から読んだ値を状態として扱ってよいか。 */
export function isRoomStatus(value: string): value is RoomStatus {
  return (ROOM_STATUSES as readonly string[]).includes(value)
}

/** 順位付けに必要な最小限。**他人が打った語は含めない**（§9.2）。 */
export type RoomPlayerState = {
  userId: string
  displayName: string
  moveCount: number
  /** そのプレイヤーがこれまでに到達した最良の（小さい）ランク。 */
  bestRank: number
  /** クリア時刻（ISO）。まだなら null。 */
  finishedAt: string | null
}

export type RoomShape = {
  status: RoomStatus
  playerCount: number
}

/**
 * 参加できるか。
 * **開始後の途中参加は許さない** ── 後から入った人は短い時間で勝ててしまう。
 */
export function canJoin(room: RoomShape): boolean {
  return room.status === 'waiting' && room.playerCount < ROOM_MAX_PLAYERS
}

/** 開始できるか。ホストだけ、待機中だけ、最小人数以上だけ。 */
export function canStart(room: RoomShape, actorId: string, hostId: string): boolean {
  return actorId === hostId && room.status === 'waiting' && room.playerCount >= ROOM_MIN_PLAYERS
}

/**
 * 順位付け。**必ず新しい配列を返す**（呼び出し側の入力を壊さない）。
 *
 * 並びは
 * 1. クリア済みが未クリアより上
 * 2. クリア同士はクリア時刻の早い順（= 最初にゴールへ着いた人が勝ち）
 * 3. 未クリア同士は到達した最良ランクの小さい順
 * 4. 同率なら手数の少ない順
 * 5. それでも同値なら userId 昇順（**毎秒の表示が入れ替わらないように**）
 */
export function rankPlayers(players: readonly RoomPlayerState[]): RoomPlayerState[] {
  return [...players].sort(comparePlayers)
}

function comparePlayers(a: RoomPlayerState, b: RoomPlayerState): number {
  if (a.finishedAt !== null && b.finishedAt !== null) {
    if (a.finishedAt !== b.finishedAt) return a.finishedAt < b.finishedAt ? -1 : 1
  } else if (a.finishedAt !== null) {
    return -1
  } else if (b.finishedAt !== null) {
    return 1
  }
  if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank
  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount
  if (a.userId === b.userId) return 0
  return a.userId < b.userId ? -1 : 1
}
