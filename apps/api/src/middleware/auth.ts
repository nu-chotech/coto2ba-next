/**
 * 認証ミドルウェア。Better Auth のセッション（Bearer / Cookie）を第一に見て、
 * 無ければ自前の device_tokens（SPEC §7.4 のフォールバック、ブースモードでも使う）を見る。
 */
import { eq, sql } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { auth } from '../auth'
import { db } from '../db/client'
import { deviceTokens, user } from '../db/schema'
import { appError } from '../lib/errors'
import { type BestFreeMoves, parseBestFreeMoves } from '../services/rules'

export interface AuthUser {
  id: string
  displayName: string | null
  booth: boolean
  bestFreeMoves: BestFreeMoves
}

export type AuthVariables = { authUser: AuthUser }

async function fromDeviceToken(token: string): Promise<AuthUser | null> {
  const rows = await db
    .select({
      id: user.id,
      displayName: user.displayName,
      booth: user.booth,
      bestFreeMoves: user.bestFreeMoves,
    })
    .from(deviceTokens)
    .innerJoin(user, eq(user.id, deviceTokens.userId))
    .where(eq(deviceTokens.token, token))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  // 最終利用時刻の更新は待たない
  void db
    .update(deviceTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(deviceTokens.token, token))
    .catch(() => {})
  return {
    id: row.id,
    displayName: row.displayName,
    booth: row.booth,
    bestFreeMoves: parseBestFreeMoves(row.bestFreeMoves),
  }
}

async function fromBetterAuth(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null)
  if (!session?.user) return null
  const rows = await db
    .select({
      id: user.id,
      displayName: user.displayName,
      booth: user.booth,
      bestFreeMoves: user.bestFreeMoves,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    displayName: row.displayName,
    booth: row.booth,
    bestFreeMoves: parseBestFreeMoves(row.bestFreeMoves),
  }
}

/** 認証を要求する。 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const headers = c.req.raw.headers
  let authUser = await fromBetterAuth(headers)

  if (!authUser) {
    const bearerHeader = headers.get('authorization')
    const token = bearerHeader?.toLowerCase().startsWith('bearer ')
      ? bearerHeader.slice(7).trim()
      : null
    if (token) authUser = await fromDeviceToken(token)
  }

  if (!authUser) throw appError('UNAUTHORIZED')
  c.set('authUser', authUser)
  await next()
})
