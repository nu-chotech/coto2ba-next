/**
 * 対戦ルームのエンドポイント（SPEC §9.4）の統合テスト。
 *
 * ここで守りたいのは「**端末が zod で parse できる形**が返る」こと。
 * `apps/mobile/src/lib/api.ts` はレスポンスを必ず契約スキーマに通すので、
 * 形が 1 つずれると画面が「サーバーの応答を解釈できません」で止まる。
 *
 * DB が無ければスキップする（CI で落ちないように）。
 */
import { roomResponseSchema } from '@coto2ba/contracts'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { session, user } from '../src/db/schema'

let hasDb = false
const createdUserIds: string[] = []

beforeAll(async () => {
  try {
    const r = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM goal_pool WHERE enabled`,
    )
    hasDb = Number(r.rows[0]?.n ?? 0) > 0
  } catch {
    hasDb = false
  }
  if (!hasDb) console.warn('goal_pool が無いので対戦ルームのエンドポイント試験をスキップします')
})

afterAll(async () => {
  for (const id of createdUserIds) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {})
  }
  await pool.end().catch(() => {})
})

async function signIn(displayName: string): Promise<string> {
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
  const token = crypto.randomUUID().replaceAll('-', '')
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId: id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return token
}

async function post(path: string, bearer: string, body?: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  })
}

async function get(path: string, bearer: string): Promise<Response> {
  return await app.request(path, { headers: { authorization: `Bearer ${bearer}` } })
}

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('対戦ルームのエンドポイント', () => {
  it('作成 → 参加 → 開始 → 取得が、すべて契約どおりの形で返る', async () => {
    if (!hasDb) return
    const host = await signIn('ホスト')
    const guest = await signIn('ゲスト')

    const createdRes = await post('/api/rooms', host, { difficulty: 'easy' })
    expect(createdRes.status).toBe(200)
    const created = roomResponseSchema.parse(await createdRes.json())
    expect(created.status).toBe('waiting')
    expect(created.goal).toBeNull()
    expect(created.join_url).toContain(created.code)

    // 小文字で入力されても拾う（読み上げてもらって手入力する導線）。
    const joinedRes = await post(`/api/rooms/${created.code.toLowerCase()}/join`, guest)
    expect(joinedRes.status).toBe(200)
    const joined = roomResponseSchema.parse(await joinedRes.json())
    expect(joined.players).toHaveLength(2)

    // ホスト以外は開始できない。
    const forbidden = await post(`/api/rooms/${created.code}/start`, guest)
    expect(forbidden.status).toBe(403)

    const startedRes = await post(`/api/rooms/${created.code}/start`, host)
    expect(startedRes.status).toBe(200)
    const started = roomResponseSchema.parse(await startedRes.json())
    expect(started.status).toBe('playing')
    expect(started.goal).not.toBeNull()
    expect(started.my_game_id).not.toBeNull()

    const polledRes = await get(`/api/rooms/${created.code}`, guest)
    expect(polledRes.status).toBe(200)
    const polled = roomResponseSchema.parse(await polledRes.json())
    expect(polled.goal).toBe(started.goal)
    expect(polled.players.filter((p) => p.is_me)).toHaveLength(1)
  })

  it('存在しないコードは 404', async () => {
    if (!hasDb) return
    const someone = await signIn('通りすがり')
    const res = await get('/api/rooms/ZZZZ', someone)
    expect(res.status).toBe(404)
  })

  it('POST /api/games に mode=room は投げられない（ルーム戦はサーバーだけが作る）', async () => {
    if (!hasDb) return
    const someone = await signIn('直接作る人')
    const res = await post('/api/games', someone, { mode: 'room' })
    expect(res.status).toBe(400)
  })
})
