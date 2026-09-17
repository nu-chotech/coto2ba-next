/**
 * 開始の途中で失敗したら、部屋を `waiting` に戻すこと（SPEC §9）。
 *
 * 戻さないと、**ゲームを持たない参加者がいる `playing` の部屋から誰も抜け出せない**。
 * ホストがもう一度「はじめる」を押しても `ROOM_CLOSED` で弾かれ、
 * `ROOM_TTL_MINUTES` が来るまで部屋が死んだまま残る。
 *
 * 失敗は自然には起こせないので、**ゲーム作成だけを差し替えて**途中で投げさせる。
 * 差し替えがほかの試験に漏れないよう、この 1 本だけ別ファイルにしてある。
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** 2 人目のゲーム作成で失敗させる（1 人目は作れている ＝ 中途半端な状態を作る）。 */
const created = { count: 0 }
vi.mock('../src/services/game', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/game')>()
  return {
    ...actual,
    createRoomGame: vi.fn(async (...args: Parameters<typeof actual.createRoomGame>) => {
      created.count += 1
      if (created.count === 2) throw new Error('ゲーム作成に失敗（試験用）')
      return await actual.createRoomGame(...args)
    }),
  }
})

const { db, pool } = await import('../src/db/client')
const { roomPlayers, rooms, user } = await import('../src/db/schema')
const { createRoom, joinRoom, roomState, startRoom } = await import('../src/services/rooms')

let hasDb = false
const createdUserIds: string[] = []

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1 FROM goal_pool LIMIT 1`)
    hasDb = true
  } catch {
    hasDb = false
    console.warn('DB が無いので開始の巻き戻し試験をスキップします')
  }
})

afterAll(async () => {
  if (hasDb) {
    for (const id of createdUserIds) {
      await db
        .delete(user)
        .where(eq(user.id, id))
        .catch(() => {})
    }
  }
  await pool.end().catch(() => {})
})

async function createTestUser(): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(user).values({
    id,
    name: '巻き戻し',
    email: `${id}@test.coto2ba.invalid`,
    emailVerified: false,
    isAnonymous: true,
    displayName: '巻き戻し',
    bestFreeMoves: {},
    booth: false,
  })
  createdUserIds.push(id)
  return id
}

describe('開始の途中で失敗したとき', () => {
  it('部屋は waiting に戻り、もう一度はじめられる', async () => {
    if (!hasDb) return
    const host = await createTestUser()
    const guest = await createTestUser()
    const room = await createRoom(db, host, 'normal')
    await joinRoom(db, guest, room.code)

    // 2 人目で投げる（1 人目のゲームは作られている）。
    await expect(startRoom(db, host, room.code)).rejects.toThrow()

    const rolledBack = await db.select().from(rooms).where(eq(rooms.code, room.code)).limit(1)
    expect(rolledBack[0]?.status).toBe('waiting')
    expect(rolledBack[0]?.startedAt).toBeNull()

    // 作りかけのゲームは参照から外れている（引き直しても二重に効かない）。
    const links = await db
      .select({ gameId: roomPlayers.gameId })
      .from(roomPlayers)
      .where(eq(roomPlayers.roomId, rolledBack[0]?.id as string))
    expect(links.every((l) => l.gameId === null)).toBe(true)

    // ここからが本題。**もう一度はじめられる。**
    const started = await startRoom(db, host, room.code)
    expect(started.status).toBe('playing')
    expect(started.my_game_id).not.toBeNull()

    const guestView = await roomState(db, guest, room.code)
    expect(guestView.my_game_id).not.toBeNull()
    expect(guestView.goal).toBe(started.goal)
  })
})
