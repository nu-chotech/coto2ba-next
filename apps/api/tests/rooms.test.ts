/**
 * 対戦ルーム（SPEC §9）の統合テスト。DATABASE_URL の DB に直接書き込む。
 * DB が無ければスキップする（CI で落ちないように）。
 *
 * ここで守りたいのは 3 つ。
 * 1. 全員が**同じお題**を解く（部屋で 1 度だけ抽選する）
 * 2. **進行中に他人が打った語が漏れない**（漏れると真似で解かれて競技にならない）
 * 3. 勝敗は**サーバーの時刻**で決まる（最初にゴールへ着いた人が勝ち）
 */
import { ROOM_MIN_PLAYERS, ROOM_TTL_MINUTES } from '@coto2ba/contracts'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import { games, rooms, user } from '../src/db/schema'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  rematchRoom,
  roomState,
  startRoom,
} from '../src/services/rooms'

let hasDb = false
const createdUserIds: string[] = []

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1 FROM goal_pool LIMIT 1`)
    hasDb = true
  } catch {
    hasDb = false
    console.warn('DB が無いので対戦ルームの統合テストをスキップします')
  }
})

afterAll(async () => {
  if (hasDb) {
    for (const id of createdUserIds) {
      // rooms / room_players / games は user の cascade で消える。
      await db
        .delete(user)
        .where(eq(user.id, id))
        .catch(() => {})
    }
  }
  await pool.end().catch(() => {})
})

async function createTestUser(displayName = '静かな蚕'): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(user).values({
    id,
    name: displayName,
    email: `${id}@test.coto2ba.invalid`,
    emailVerified: false,
    isAnonymous: true,
    displayName,
    bestFreeMoves: {},
    booth: false,
  })
  createdUserIds.push(id)
  return id
}

/** そのユーザーのルーム戦のゲーム行（他人の語が漏れていないかを見るのに使う）。 */
async function myRoomGame(userId: string, code: string) {
  const state = await roomState(db, userId, code)
  const gameId = state.my_game_id
  expect(gameId).not.toBeNull()
  const rows = await db
    .select()
    .from(games)
    .where(eq(games.id, gameId as string))
    .limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error('ルーム戦のゲームが見つかりません')
  return row
}

/** 決着した状態にする（「もう一度」は終わった部屋から始まるので、その前提を作る）。 */
async function closeRoom(code: string): Promise<void> {
  await db
    .update(rooms)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(eq(rooms.code, code))
}

/** サーバーと同じ経路でクリアさせる（時刻はサーバーが持つ）。 */
async function forceClear(gameId: string, clearedAt: Date): Promise<void> {
  await db
    .update(games)
    .set({ status: 'cleared', currentRank: 0, moveCount: 3, clearedAt })
    .where(eq(games.id, gameId))
}

describe.runIf(true)('対戦ルーム', () => {
  it('作って、参加して、開始できる', async () => {
    if (!hasDb) return
    const host = await createTestUser('ホスト')
    const guest = await createTestUser('ゲスト')
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    const started = await startRoom(db, host, created.code)
    expect(started.status).toBe('playing')
    expect(started.players).toHaveLength(ROOM_MIN_PLAYERS)
  })

  it('ホスト以外は開始できない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await expect(startRoom(db, guest, created.code)).rejects.toThrow()
  })

  it('人数が足りなければ開始できない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await expect(startRoom(db, host, created.code)).rejects.toThrow()
  })

  it('同じ人が二重に参加しても増えない（冪等）', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    const again = await joinRoom(db, guest, created.code)
    expect(again.players).toHaveLength(2)
  })

  it('ホストが自分の部屋に join しても増えない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    const again = await joinRoom(db, host, created.code)
    expect(again.players).toHaveLength(1)
  })

  it('開始後は参加できない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const late = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await startRoom(db, host, created.code)
    await expect(joinRoom(db, late, created.code)).rejects.toThrow()
  })

  it('全員が同じお題を解く', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await startRoom(db, host, created.code)
    const a = await roomState(db, host, created.code)
    const b = await roomState(db, guest, created.code)
    expect(a.goal).toBe(b.goal)
    expect(a.start).toBe(b.start)
    expect(a.goal).not.toBeNull()

    // ゲーム行も同じ盤面であること（forbidden_inputs まで揃っているか）。
    const hostGame = await myRoomGame(host, created.code)
    const guestGame = await myRoomGame(guest, created.code)
    expect(hostGame.goal).toBe(guestGame.goal)
    expect(hostGame.start).toBe(guestGame.start)
    expect(hostGame.forbiddenInputs).toEqual(guestGame.forbiddenInputs)
    expect(hostGame.mode).toBe('room')
  })

  // 進行中に他人の語が見えると、真似されて競技にならない。
  it('他人が打った語は返さない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await startRoom(db, host, created.code)

    // ホストだけが誰にも当てられない語に進んだことにする。
    const hostGame = await myRoomGame(host, created.code)
    const secret = 'ホストだけの秘密の語'
    await db.update(games).set({ current: secret }).where(eq(games.id, hostGame.id))

    const state = await roomState(db, guest, created.code)
    expect(JSON.stringify(state)).not.toContain(secret)
  })

  it('待機中はお題を伏せる', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    const state = await roomState(db, host, created.code)
    expect(state.status).toBe('waiting')
    expect(state.goal).toBeNull()
    expect(state.start).toBeNull()
  })

  it('先にクリアした人が 1 位', async () => {
    if (!hasDb) return
    const host = await createTestUser('先着')
    const guest = await createTestUser('後着')
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await startRoom(db, host, created.code)

    const hostGame = await myRoomGame(host, created.code)
    const guestGame = await myRoomGame(guest, created.code)
    const now = Date.now()
    await forceClear(guestGame.id, new Date(now + 20_000))
    await forceClear(hostGame.id, new Date(now + 10_000))

    const state = await roomState(db, guest, created.code)
    expect(state.players[0]?.finished_at).not.toBeNull()
    expect(state.players[0]?.user_id).toBe(host)
    expect(state.players[0]?.display_name).toBe('先着')
  })

  it('全員が終わったら部屋が finished になる', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, created.code)
    await startRoom(db, host, created.code)

    const hostGame = await myRoomGame(host, created.code)
    const guestGame = await myRoomGame(guest, created.code)
    await forceClear(hostGame.id, new Date())
    await db.update(games).set({ status: 'gave_up' }).where(eq(games.id, guestGame.id))

    const state = await roomState(db, host, created.code)
    expect(state.status).toBe('finished')
  })

  // **ブース運用の核心。** 各自が「もう一度」で部屋を作ると全員が別々の部屋で待ち、
  // 誰とも当たらない（実際にそうなった）。ホストだけが作り、次のコードを配る。
  describe('もう一度', () => {
    it('ホストが作った次の部屋のコードが、終わった部屋に書き残される', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const first = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, first.code)
      await startRoom(db, host, first.code)
      await closeRoom(first.code)

      const next = await rematchRoom(db, host, first.code)
      expect(next.code).not.toBe(first.code)

      // 参加者は終わった部屋を見るだけで次のコードに辿り着ける。
      const seenByGuest = await roomState(db, guest, first.code)
      expect(seenByGuest.next_code).toBe(next.code)
    })

    it('ホスト以外は「もう一度」を作れない', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const first = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, first.code)
      await closeRoom(first.code)
      await expect(rematchRoom(db, guest, first.code)).rejects.toThrow()
    })

    it('二度押しても部屋は増えない', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const first = await createRoom(db, host, 'normal')
      await closeRoom(first.code)
      const a = await rematchRoom(db, host, first.code)
      const b = await rematchRoom(db, host, first.code)
      expect(b.code).toBe(a.code)
    })

    // まだ生きている部屋で作ると、そこで待っている人を置き去りにする
    // （Critical-1 と同じ形の事故）。
    it('終わっていない部屋からは作れない', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const waiting = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, waiting.code)
      await expect(rematchRoom(db, host, waiting.code)).rejects.toThrow()

      await startRoom(db, host, waiting.code)
      await expect(rematchRoom(db, host, waiting.code)).rejects.toThrow()
    })

    it('参加していない人は作れない', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const stranger = await createTestUser()
      const first = await createRoom(db, host, 'normal')
      await closeRoom(first.code)
      await expect(rematchRoom(db, stranger, first.code)).rejects.toThrow()
    })

    /**
     * コードは「生きている部屋の中で一意」なので、次の部屋も終わったあとに
     * 同じコードが**別人の部屋**へ再利用されうる。そのとき 403 で行き止まりにせず、
     * 新しい部屋を作りに進むこと。
     */
    it('次のコードが別人の部屋に再利用されていたら、新しく作り直す', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const stranger = await createTestUser()
      const first = await createRoom(db, host, 'normal')
      await closeRoom(first.code)

      // 他人の部屋を作り、その部屋のコードを first.next_code に差し込む
      //（コード再利用で同じことが起きる）。
      const others = await createRoom(db, stranger, 'normal')
      await db.update(rooms).set({ nextCode: others.code }).where(eq(rooms.code, first.code))

      const next = await rematchRoom(db, host, first.code)
      // 他人の部屋を返さない。新しい部屋を作る。
      expect(next.code).not.toBe(others.code)
      expect(next.players.some((p) => p.is_me)).toBe(true)
    })

    it('難易度は引き継ぐ', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const first = await createRoom(db, host, 'hard')
      await closeRoom(first.code)
      const next = await rematchRoom(db, host, first.code)
      expect(next.difficulty).toBe('hard')
    })
  })

  describe('部屋を出る', () => {
    // ブースではホストの端末が落ちる・アプリを閉じるのが普通に起きる。
    it('待機中にホストが出たら部屋ごと畳む', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const created = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, created.code)

      const left = await leaveRoom(db, host, created.code)
      expect(left.status).toBe('finished')

      const rows = await db.select().from(rooms).where(eq(rooms.code, created.code)).limit(1)
      expect(rows[0]?.status).toBe('finished')
    })

    it('待機中に参加者が出たら、その人だけ抜ける', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const created = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, created.code)

      await leaveRoom(db, guest, created.code)

      const state = await roomState(db, host, created.code)
      expect(state.status).toBe('waiting')
      expect(state.players).toHaveLength(1)
    })

    // 走っている人がいるのに畳むと勝負が消える。
    it('レース中にホストが出ても部屋は畳まない', async () => {
      if (!hasDb) return
      const host = await createTestUser()
      const guest = await createTestUser()
      const created = await createRoom(db, host, 'normal')
      await joinRoom(db, guest, created.code)
      await startRoom(db, host, created.code)

      await leaveRoom(db, host, created.code)

      const state = await roomState(db, guest, created.code)
      expect(state.status).toBe('playing')
    })
  })

  it('コードは生きている部屋の中で一意', async () => {
    if (!hasDb) return
    const a = await createTestUser()
    const b = await createTestUser()
    const first = await createRoom(db, a, 'normal')
    const second = await createRoom(db, b, 'normal')
    expect(second.code).not.toBe(first.code)
  })

  it('存在しないコードは ROOM_NOT_FOUND', async () => {
    if (!hasDb) return
    const someone = await createTestUser()
    await expect(roomState(db, someone, 'ZZZZ')).rejects.toThrow()
  })

  it('参加していない部屋の状態は見られない', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const stranger = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    await expect(roomState(db, stranger, created.code)).rejects.toThrow()
  })

  // cron を使わない代わりに、部屋を作るときと状態を取るときに掃除する。
  it('寿命を過ぎた部屋は次の操作のついでに畳まれる', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const other = await createTestUser()
    const stale = await createRoom(db, host, 'normal')

    // 作成時刻を寿命より前に巻き戻す。
    await db
      .update(rooms)
      .set({ createdAt: new Date(Date.now() - (ROOM_TTL_MINUTES + 1) * 60_000) })
      .where(eq(rooms.code, stale.code))

    // 別の誰かが部屋を作ると、そのついでに畳まれる。
    await createRoom(db, other, 'normal')

    const rows = await db.select().from(rooms).where(eq(rooms.code, stale.code)).limit(1)
    expect(rows[0]?.status).toBe('finished')
  })

  /**
   * 引き継ぎ（`POST /api/transfer/claim`）は、成功すると**旧匿名ユーザーを消す**。
   * ブースで部屋を立てた来場者が、持ち帰り QR で自分の端末へ引き継ぐと実際に起きる。
   * そのとき部屋が残ると、コードが取られたままになる。
   *
   * （「次の人へ」はユーザーを消さない。新しい匿名ユーザーを作るだけ。）
   */
  it('ホストのユーザーを消すと部屋も消える（cascade）', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const created = await createRoom(db, host, 'normal')
    expect(await db.select().from(rooms).where(eq(rooms.code, created.code))).toHaveLength(1)

    await db.delete(user).where(eq(user.id, host))

    expect(await db.select().from(rooms).where(eq(rooms.code, created.code))).toHaveLength(0)
  })
})
