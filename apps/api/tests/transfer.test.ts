/**
 * 引き継ぎ（SPEC §7.4）の統合テスト。DATABASE_URL の DB に直接書き込む。
 * DB が無ければスキップする（CI で落ちないように）。
 *
 * ここで守りたいのは「200 を返したなら本当に引き継がれている」こと。
 * Better Auth のセッション行を付け替えないと、実アプリでは 1 件も引き継がれないのに
 * 成功が返り、クライアントが「引き継ぎました」と嘘をつく。
 */
import { TRANSFER_TOKEN_TTL_MINUTES } from '@coto2ba/contracts'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { deviceTokens, session, transferTokens, user } from '../src/db/schema'

let hasDb = false
/** 後片付け用に作ったユーザー ID を控えておく。 */
const createdUserIds: string[] = []

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1 FROM "user" LIMIT 1`)
    hasDb = true
  } catch {
    hasDb = false
    console.warn('DB が無いので引き継ぎの統合テストをスキップします')
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

/** 匿名ユーザーを 1 人作る。 */
async function createUser(displayName: string): Promise<string> {
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

/**
 * Better Auth のセッション行を 1 本作り、Bearer に載せる生トークンを返す。
 * bearer プラグインは「.」を含まない値を生トークンとみなして署名してくれるので、
 * UUID をそのまま使える。
 */
async function createSession(userId: string): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replaceAll('-', '')
  await db.insert(session).values({
    id,
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return { id, token }
}

async function createTransferToken(userId: string): Promise<string> {
  const token = `T${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`
  await db.insert(transferTokens).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + TRANSFER_TOKEN_TTL_MINUTES * 60_000),
  })
  return token
}

async function claim(bearer: string, token: string): Promise<Response> {
  return await app.request('/api/transfer/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ token }),
  })
}

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('POST /api/transfer/claim', () => {
  it('Better Auth のセッションを引き継ぎ先に付け替える', async () => {
    if (!hasDb) return
    const sourceId = await createUser('引き継ぎ元')
    const newDeviceId = await createUser('新しい端末')
    const s = await createSession(newDeviceId)
    const token = await createTransferToken(sourceId)

    const res = await claim(s.token, token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user_id: sourceId, display_name: '引き継ぎ元' })

    // セッション行が引き継ぎ先を指している
    const rows = await db
      .select({ userId: session.userId })
      .from(session)
      .where(eq(session.id, s.id))
    expect(rows[0]?.userId).toBe(sourceId)

    // 同じ資格情報で GET /api/me を叩くと引き継ぎ先が返る（ここが本番の着地点）
    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${s.token}` } })
    expect(me.status).toBe(200)
    const body = (await me.json()) as { id: string; display_name: string }
    expect(body.id).toBe(sourceId)
    expect(body.display_name).toBe('引き継ぎ元')

    // 旧匿名ユーザーは削除される（SPEC §7.4）
    const left = await db.select({ id: user.id }).from(user).where(eq(user.id, newDeviceId))
    expect(left).toHaveLength(0)
  })

  it('端末トークン（フォールバック）も付け替える', async () => {
    if (!hasDb) return
    const sourceId = await createUser('端末元')
    const newDeviceId = await createUser('端末新')
    const deviceToken = crypto.randomUUID().replaceAll('-', '')
    await db.insert(deviceTokens).values({ token: deviceToken, userId: newDeviceId })
    const token = await createTransferToken(sourceId)

    const res = await claim(deviceToken, token)
    expect(res.status).toBe(200)

    const rows = await db
      .select({ userId: deviceTokens.userId })
      .from(deviceTokens)
      .where(eq(deviceTokens.token, deviceToken))
    expect(rows[0]?.userId).toBe(sourceId)

    const me = await app.request('/api/me', {
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(((await me.json()) as { id: string }).id).toBe(sourceId)
  })

  it('同じコードは 2 回使えない', async () => {
    if (!hasDb) return
    const sourceId = await createUser('二重元')
    const firstId = await createUser('二重新1')
    const secondId = await createUser('二重新2')
    const token = await createTransferToken(sourceId)

    const a = await createSession(firstId)
    expect((await claim(a.token, token)).status).toBe(200)

    const b = await createSession(secondId)
    const res = await claim(b.token, token)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('TRANSFER_INVALID')

    // 2 人目のセッションは動いていない
    const rows = await db
      .select({ userId: session.userId })
      .from(session)
      .where(eq(session.id, b.id))
    expect(rows[0]?.userId).toBe(secondId)
  })

  it('自分のコードは使えない', async () => {
    if (!hasDb) return
    const id = await createUser('自分')
    const s = await createSession(id)
    const token = await createTransferToken(id)

    const res = await claim(s.token, token)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('TRANSFER_INVALID')
  })
})
