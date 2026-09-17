/**
 * 対戦ルームのオーケストレーション（SPEC §9）。
 *
 * ルール判定そのものは `room-rules.ts`（純粋関数）。ここは DB との突き合わせを行う。
 * **クライアントの値は一切信用しない。** 誰がホストか・誰が先にゴールへ着いたかは
 * `rooms` / `room_players` / `games` の行だけが権威。
 *
 * ## 進行中に配ってよいもの
 * 順位・手数・ヒント数・到達した最良ランクだけ。
 * **他人が打った語（current / input）は絶対に返さない。**
 * 見せると真似で解かれて競技にならない（§9.2）。SELECT する列をここで絞っているのはそのため。
 *
 * ## 同期はポーリング
 * Vercel では部屋 → インスタンスのアフィニティが無く、外部 Redis 無しに
 * 同じ部屋の全員へ配信できない（計画書の冒頭に根拠）。1 秒ポーリングで十分な情報量
 * （順位と手数）しか流れないので、ここは素直に「毎回引き直す」。
 */
import {
  type Difficulty,
  ROOM_CODE_LENGTH,
  ROOM_FINISH_GRACE_SECONDS,
  ROOM_MAX_PLAYERS,
  ROOM_TTL_MINUTES,
  ROOM_WAITING_TTL_MINUTES,
  type RoomPlayer,
  type RoomResponse,
  type RoomStatus,
  START_RANK_RANGE,
} from '@coto2ba/contracts'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { roomPlayers, rooms, user } from '../db/schema'
import { expoDeepLink } from '../lib/deeplink'
import { appError } from '../lib/errors'
import { readableToken } from '../lib/random'
import { type Challenge, createRoomGame, pickChallenge } from './game'
import { generateDisplayName } from './names'
import { canJoin, canStart, isRoomStatus, type RoomPlayerState, rankPlayers } from './room-rules'
import { rankOf } from './vector'

/** コードが衝突したときの引き直し回数。ROOM_CODE_LENGTH の空間なら数回で足りる。 */
const CODE_RETRY_LIMIT = 8

type RoomRow = typeof rooms.$inferSelect

/** 部屋の参加リンク（QR に入れる）。形の理由は `lib/deeplink.ts`。 */
export function roomJoinUrl(code: string): string {
  return expoDeepLink({ room: code })
}

function statusOf(row: RoomRow): RoomStatus {
  return isRoomStatus(row.status) ? row.status : 'finished'
}

/** 寿命を過ぎているか。ポーリングのたびに UPDATE を撃たないための前さばき。 */
function isStale(room: RoomRow): boolean {
  const status = statusOf(room)
  if (status === 'finished') return false
  const ttlMinutes = status === 'waiting' ? ROOM_WAITING_TTL_MINUTES : ROOM_TTL_MINUTES
  return Date.now() - room.createdAt.getTime() > ttlMinutes * 60_000
}

/** 生きている（= 終わっていない）部屋をコードで引く。 */
async function findLiveRoom(db: Db, code: string): Promise<RoomRow> {
  const rows = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.code, code), sql`${rooms.status} <> 'finished'`))
    .limit(1)
  const row = rows[0]
  if (row) return row
  // 終わった部屋も「結果を見る」ために引けるようにする（コードは再利用されうるので最新）。
  const finished = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code))
    .orderBy(sql`${rooms.createdAt} DESC`)
    .limit(1)
  const last = finished[0]
  if (!last) throw appError('ROOM_NOT_FOUND')
  return last
}

/**
 * 表示名。**無ければここで作って保存する**（`GET /api/me` と同じ遅延付与）。
 * これをしないと、`/api/me` を一度も叩いていない端末が「名無し」で部屋に並ぶ。
 * ブースで全員が「名無し」になると誰が誰だか分からない。
 */
async function displayNameOf(db: Db, userId: string): Promise<string> {
  const rows = await db
    .select({ displayName: user.displayName })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const existing = rows[0]?.displayName
  if (existing !== null && existing !== undefined && existing.length > 0) return existing
  const generated = await generateDisplayName(db)
  await db.update(user).set({ displayName: generated }).where(eq(user.id, userId))
  return generated
}

/**
 * 部屋の参加者と、その人の進み具合。
 * **`games.current` は SELECT しない**（他人の語を持ち出さないため）。
 */
async function loadPlayers(
  db: Db,
  roomId: string,
): Promise<{ state: RoomPlayerState; gameId: string | null; gameStatus: string | null }[]> {
  const rows = await db.execute<{
    user_id: string
    display_name: string
    game_id: string | null
    game_status: string | null
    move_count: number | null
    hint_count: number | null
    best_rank: number | null
    finished_at: Date | string | null
  }>(sql`
    SELECT rp.user_id,
           rp.display_name,
           rp.game_id,
           g.status AS game_status,
           g.move_count,
           -- **順位キーの一部**（room-rules.rankPlayers）。ここを落とすと
           -- 対戦でヒントが完全に無料になる。
           g.hint_count,
           -- これまでに到達した最良（最小）のランク。単調に良くなるので順位バーが跳ねない。
           LEAST(g.current_rank, COALESCE(m.min_rank, g.current_rank)) AS best_rank,
           rp.finished_at
    FROM room_players rp
    LEFT JOIN games g ON g.id = rp.game_id
    LEFT JOIN (
      SELECT game_id, MIN(rank) AS min_rank FROM moves GROUP BY game_id
    ) m ON m.game_id = rp.game_id
    WHERE rp.room_id = ${roomId}
    ORDER BY rp.joined_at ASC
  `)

  return rows.rows.map((r) => ({
    state: {
      userId: r.user_id,
      displayName: r.display_name,
      moveCount: Number(r.move_count ?? 0),
      hintCount: Number(r.hint_count ?? 0),
      // ゲームがまだ無い（待機中）なら最下位扱い。
      bestRank: Number(r.best_rank ?? Number.MAX_SAFE_INTEGER),
      finishedAt: toIso(r.finished_at),
    },
    gameId: r.game_id,
    gameStatus: r.game_status,
  }))
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * 進み具合を `room_players` に取り込み、決着していれば部屋を畳む。
 *
 * **クリア時刻は `games.cleared_at`（サーバーが打った時刻）をそのまま使う。**
 * クライアントから時刻を受け取らないので、端末の時計がずれていても順位は狂わない。
 */
async function syncRoomProgress(db: Db, room: RoomRow): Promise<RoomRow> {
  if (statusOf(room) !== 'playing') return room

  // 1. クリアした人の finished_at を埋める（まだ埋まっていない人だけ）。
  await db.execute(sql`
    UPDATE room_players rp
       SET finished_at = g.cleared_at
      FROM games g
     WHERE g.id = rp.game_id
       AND rp.room_id = ${room.id}
       AND rp.finished_at IS NULL
       AND g.status = 'cleared'
       AND g.cleared_at IS NOT NULL
  `)

  // 2. 全員が終わった（クリア or ギブアップ）か、最初のクリアから猶予が過ぎたら畳む。
  const decided = await db.execute<{ all_done: boolean; grace_over: boolean }>(sql`
    SELECT bool_and(g.status IS NOT NULL AND g.status <> 'playing') AS all_done,
           COALESCE(
             MIN(rp.finished_at) < now() - ${`${ROOM_FINISH_GRACE_SECONDS} seconds`}::interval,
             false
           ) AS grace_over
      FROM room_players rp
      LEFT JOIN games g ON g.id = rp.game_id
     WHERE rp.room_id = ${room.id}
  `)
  const verdict = decided.rows[0]
  if (verdict === undefined) return room
  if (!verdict.all_done && !verdict.grace_over) return room

  const updated = await db
    .update(rooms)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(and(eq(rooms.id, room.id), eq(rooms.status, 'playing')))
    .returning()
  return updated[0] ?? { ...room, status: 'finished' }
}

/** 返す形に組み立てる。**待機中は goal / start を伏せる。** */
function toResponse(
  room: RoomRow,
  players: readonly {
    state: RoomPlayerState
    gameId: string | null
    gameStatus: string | null
  }[],
  viewerId: string,
): RoomResponse {
  const status = statusOf(room)
  const revealed = status !== 'waiting'
  const mine = players.find((p) => p.state.userId === viewerId)
  const ranked = rankPlayers(players.map((p) => p.state))
  const entries: RoomPlayer[] = ranked.map((p) => ({
    user_id: p.userId,
    display_name: p.displayName,
    move_count: p.moveCount,
    hint_count: p.hintCount,
    // まだゲームが無い人の bestRank は巨大なので、表示に出さず 0 に潰す。
    best_rank: p.bestRank === Number.MAX_SAFE_INTEGER ? 0 : p.bestRank,
    finished_at: p.finishedAt,
    is_me: p.userId === viewerId,
  }))

  return {
    code: room.code,
    status,
    host_user_id: room.hostUserId,
    difficulty: room.difficulty as Difficulty,
    goal: revealed ? room.goal : null,
    start: revealed ? room.start : null,
    players: entries,
    my_game_id: mine?.gameId ?? null,
    my_game_status: (mine?.gameStatus as RoomResponse['my_game_status']) ?? null,
    next_code: room.nextCode,
    join_url: roomJoinUrl(room.code),
  }
}

/** 部屋の状態を作って返す（進み具合の取り込みも行う）。 */
async function buildState(db: Db, room: RoomRow, viewerId: string): Promise<RoomResponse> {
  const synced = await syncRoomProgress(db, room)
  const players = await loadPlayers(db, synced.id)
  return toResponse(synced, players, viewerId)
}

/** 参加者かどうか。参加していない部屋の状態は見せない。 */
function assertMember(players: readonly { state: RoomPlayerState }[], userId: string): void {
  if (!players.some((p) => p.state.userId === userId)) throw appError('FORBIDDEN')
}

/**
 * 放置された部屋を畳む（SPEC §9 / ブース運用）。
 *
 * **cron は使わない。** Vercel Hobby の枠と運用の複雑さを増やしたくないので、
 * 部屋を作るときと状態を取るときに、ついでに古いものを片付ける。
 * `rooms_created_at_idx` があるので走査は安い。
 *
 * 失敗しても呼び出し側の処理は止めない（掃除は本筋ではない）。
 */
async function closeStaleRooms(db: Db): Promise<void> {
  await db
    .execute(
      sql`
        UPDATE rooms
           SET status = 'finished', finished_at = now()
         WHERE status <> 'finished'
           AND created_at < now() - (
                 CASE WHEN status = 'waiting'
                      THEN ${`${ROOM_WAITING_TTL_MINUTES} minutes`}::interval
                      ELSE ${`${ROOM_TTL_MINUTES} minutes`}::interval
                 END)
      `,
    )
    .catch(() => {})
}

/**
 * 部屋を作る（ホスト）。
 * **お題はここで 1 度だけ引く**（`pickChallenge`）。全員が同じ盤面を解く。
 */
export async function createRoom(
  db: Db,
  userId: string,
  difficulty: Difficulty,
): Promise<RoomResponse> {
  // ここで古い部屋を畳んでおくと、コードの取り合いも自然に解ける。
  await closeStaleRooms(db)
  const [displayName, challenge] = await Promise.all([
    displayNameOf(db, userId),
    pickChallenge(db, difficulty),
  ])

  for (let attempt = 0; attempt < CODE_RETRY_LIMIT; attempt += 1) {
    const code = readableToken(ROOM_CODE_LENGTH)
    const inserted = await db
      .insert(rooms)
      .values({
        code,
        hostUserId: userId,
        difficulty,
        goal: challenge.goal,
        start: challenge.start,
        forbiddenInputs: challenge.forbiddenInputs,
        status: 'waiting',
      })
      // 生きている部屋のコードは一意（部分 UNIQUE）。ぶつかったら引き直す。
      .onConflictDoNothing()
      .returning()
    const room = inserted[0]
    if (room === undefined) continue

    await db
      .insert(roomPlayers)
      .values({ roomId: room.id, userId, displayName })
      .onConflictDoNothing()
    const players = await loadPlayers(db, room.id)
    return toResponse(room, players, userId)
  }
  throw appError('INTERNAL', '参加コードを発行できませんでした')
}

/**
 * 参加する。**同じユーザーの二重参加は冪等**（ポーリング中の再送で増えない）。
 * 開始後は入れない（後から入ると短い時間で勝ててしまう）。
 */
export async function joinRoom(db: Db, userId: string, code: string): Promise<RoomResponse> {
  const room = await findLiveRoom(db, code)
  const existing = await loadPlayers(db, room.id)
  const already = existing.some((p) => p.state.userId === userId)

  if (!already) {
    const status = statusOf(room)
    if (status !== 'waiting') throw appError('ROOM_CLOSED')
    if (existing.length >= ROOM_MAX_PLAYERS) throw appError('ROOM_FULL')
    if (!canJoin({ status, playerCount: existing.length })) throw appError('ROOM_CLOSED')

    const displayName = await displayNameOf(db, userId)
    await db
      .insert(roomPlayers)
      .values({ roomId: room.id, userId, displayName })
      .onConflictDoNothing()
  }

  return buildState(db, room, userId)
}

/**
 * 開始する（ホストのみ）。**参加者全員ぶんの `games` をここで作る。**
 * 全員が同じ start / goal / forbiddenInputs、`mode` は `'room'`。
 */
export async function startRoom(db: Db, userId: string, code: string): Promise<RoomResponse> {
  const room = await findLiveRoom(db, code)
  const players = await loadPlayers(db, room.id)
  const status = statusOf(room)

  if (room.hostUserId !== userId) throw appError('ROOM_NOT_HOST')
  if (status !== 'waiting') throw appError('ROOM_CLOSED')
  if (!canStart({ status, playerCount: players.length }, userId, room.hostUserId)) {
    throw appError('ROOM_NOT_ENOUGH_PLAYERS')
  }

  // **先に状態を進める。** 二重に押されても games が二重に生えない（CAS）。
  const claimed = await db
    .update(rooms)
    .set({ status: 'playing', startedAt: new Date() })
    .where(and(eq(rooms.id, room.id), eq(rooms.status, 'waiting')))
    .returning()
  const started = claimed[0]
  if (started === undefined) {
    // 別のリクエストが先に開始した。状態を返すだけにする。
    return buildState(db, room, userId)
  }

  // **スタート語のランクは部屋の中で固定なので 1 回だけ引く。**
  // 人数ぶん引き直すと 1 回 90ms が積み上がり、開始のたびにブースが止まる。
  const startRank = await rankOf(db, started.goal, started.start)
  const challenge: Challenge = {
    goal: started.goal,
    start: started.start,
    startRank: startRank ?? START_RANK_RANGE[1],
    forbiddenInputs: started.forbiddenInputs,
  }

  /**
   * **途中で失敗したら `waiting` に戻す。**
   * 戻さないと、ゲームを持たない参加者がいる `playing` の部屋から誰も抜け出せず、
   * ホストがもう一度「はじめる」を押すこともできない（`ROOM_CLOSED` になる）。
   * 作りかけの `games` は `room_players.game_id` を外せば参照されなくなるので、
   * 引き直しても二重に効かない。
   */
  try {
    for (const player of players) {
      const game = await createRoomGame(db, {
        userId: player.state.userId,
        roomId: started.id,
        difficulty: started.difficulty as Difficulty,
        challenge,
      })
      await db
        .update(roomPlayers)
        .set({ gameId: game.id })
        .where(and(eq(roomPlayers.roomId, started.id), eq(roomPlayers.userId, player.state.userId)))
    }
  } catch (error) {
    await db
      .update(roomPlayers)
      .set({ gameId: null })
      .where(eq(roomPlayers.roomId, started.id))
      .catch(() => {})
    await db
      .update(rooms)
      .set({ status: 'waiting', startedAt: null })
      .where(eq(rooms.id, started.id))
      .catch(() => {})
    throw error
  }

  const next = await loadPlayers(db, started.id)
  return toResponse(started, next, userId)
}

/**
 * 部屋を出る。
 *
 * - 待機中にホストが出たら**部屋ごと畳む**。ブースではホストの端末が落ちる・
 *   アプリを閉じるのが普通に起きるので、`ROOM_WAITING_TTL_MINUTES` を待たずに片付ける
 * - 待機中に参加者が出たら、その人だけ抜ける（席が 1 つ空く）
 * - **レース中・決着後は何もしない。** 走っている人がいるのに畳むと勝負が消える
 */
export async function leaveRoom(db: Db, userId: string, code: string): Promise<RoomResponse> {
  const room = await findLiveRoom(db, code)
  const players = await loadPlayers(db, room.id)
  assertMember(players, userId)

  if (statusOf(room) !== 'waiting') return buildState(db, room, userId)

  if (room.hostUserId === userId) {
    const closed = await db
      .update(rooms)
      .set({ status: 'finished', finishedAt: new Date() })
      .where(and(eq(rooms.id, room.id), eq(rooms.status, 'waiting')))
      .returning()
    const next = closed[0] ?? { ...room, status: 'finished' as const }
    return toResponse(next, players, userId)
  }

  await db
    .delete(roomPlayers)
    .where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, userId)))
  // 抜けたあとの状態は本人には返す（画面がそのまま結果を出せるように）。
  return toResponse(room, players, userId)
}

/**
 * 「もう一度」（ホストのみ）。同じ難易度で新しい部屋を作り、
 * **終わった部屋に次のコードを書き残す。**
 *
 * 参加者はそれをポーリングで受け取って同じ部屋へ移る。
 * 各自が「もう一度」で部屋を作ると全員が別々の部屋で待つことになり、
 * ブースで誰も対戦を始められない（実際にそうなった）。
 */
export async function rematchRoom(db: Db, userId: string, code: string): Promise<RoomResponse> {
  const room = await findLiveRoom(db, code)
  const players = await loadPlayers(db, room.id)
  assertMember(players, userId)
  if (room.hostUserId !== userId) throw appError('ROOM_NOT_HOST')
  /**
   * **決着した部屋からしか作れない。**
   * まだ生きている部屋で作ると、そこで待っている人を置き去りにしたまま
   * ホストだけ別の部屋へ行くことになる（`Critical-1` と同じ形の事故）。
   */
  if (statusOf(room) !== 'finished') throw appError('ROOM_NOT_FINISHED')

  /**
   * 既に作ってあれば作り直さない（二度押し・再送で部屋が増えない）。
   *
   * ただし **`next_code` が指す先が自分の部屋とは限らない**。
   * コードは「生きている部屋の中で一意」なので、次の部屋も終わったあとに
   * 同じコードが別の部屋へ再利用されうる。そのときは自分が参加者ではないので、
   * **そこで 403 を返して行き止まりにせず、新しい部屋を作りに進む**。
   */
  if (room.nextCode !== null) {
    const existing = await findLiveRoom(db, room.nextCode).catch(() => null)
    if (existing !== null && statusOf(existing) !== 'finished') {
      const next = await loadPlayers(db, existing.id)
      if (next.some((p) => p.state.userId === userId)) {
        return toResponse(existing, next, userId)
      }
    }
  }

  const created = await createRoom(db, userId, room.difficulty as Difficulty)
  await db.update(rooms).set({ nextCode: created.code }).where(eq(rooms.id, room.id))
  return created
}

/**
 * 部屋の状態（1 秒ポーリングの受け先）。
 * **参加していない部屋は見せない**（コードを総当たりされても中身が漏れない）。
 */
export async function roomState(db: Db, userId: string, code: string): Promise<RoomResponse> {
  const room = await findLiveRoom(db, code)
  // 自分の部屋が生きているうちに、放置された他の部屋を畳む。
  // ポーリングのついでなので、部屋が 1 つでも動いていれば掃除が回り続ける。
  if (isStale(room)) await closeStaleRooms(db)
  const players = await loadPlayers(db, room.id)
  assertMember(players, userId)
  return buildState(db, room, userId)
}

/**
 * ルーム戦の順位（`POST /moves` のレスポンスに同梱する。Task 6）。
 * ルーム戦でなければ null。**他人の語は含めない。**
 */
export async function roomStandingsForGame(
  db: Db,
  userId: string,
  roomId: string | null,
): Promise<RoomPlayer[] | null> {
  if (roomId === null) return null
  const rows = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  const room = rows[0]
  if (room === undefined) return null
  const synced = await syncRoomProgress(db, room)
  const players = await loadPlayers(db, synced.id)
  return toResponse(synced, players, userId).players
}
