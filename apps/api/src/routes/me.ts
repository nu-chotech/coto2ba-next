import {
  ACHIEVEMENTS,
  DEVICE_TOKEN_LENGTH,
  patchMeRequestSchema,
  TRANSFER_TOKEN_LENGTH,
  TRANSFER_TOKEN_TTL_MINUTES,
  transferClaimRequestSchema,
} from '@coto2ba/contracts'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { deviceTokens, transferTokens, user, userAchievements } from '../db/schema'
import { appError } from '../lib/errors'
import { opaqueToken, readableToken } from '../lib/random'
import type { AuthVariables } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'
import { userStats } from '../services/game'
import { generateDisplayName, isAcceptableDisplayName } from '../services/names'

export const meRoutes = new Hono<{ Variables: AuthVariables }>()

/**
 * 端末トークンの発行（SPEC §7.4 のフォールバックとブースモードの「次の人へ」）。
 * 認証不要。呼ぶたびに新しい匿名ユーザーを作る。
 */
meRoutes.post('/devices', async (c) => {
  const id = crypto.randomUUID()
  const displayName = await generateDisplayName(db)
  const now = Date.now()
  await db.insert(user).values({
    id,
    name: displayName,
    email: `${id}@device.coto2ba.invalid`,
    emailVerified: false,
    isAnonymous: true,
    displayName,
    bestFreeMoves: {},
    booth: false,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  })
  const token = opaqueToken(DEVICE_TOKEN_LENGTH)
  await db.insert(deviceTokens).values({ token, userId: id })
  return c.json({ token, user_id: id, display_name: displayName })
})

meRoutes.use('/me', requireAuth, rateLimit)
meRoutes.use('/me/*', requireAuth, rateLimit)
meRoutes.use('/achievements', requireAuth, rateLimit)
meRoutes.use('/transfer', requireAuth, rateLimit)
meRoutes.use('/transfer/*', requireAuth, rateLimit)

meRoutes.get('/me', async (c) => {
  const me = c.get('authUser')
  let displayName = me.displayName
  if (!displayName) {
    displayName = await generateDisplayName(db)
    await db.update(user).set({ displayName }).where(eq(user.id, me.id))
  }
  return c.json({
    id: me.id,
    display_name: displayName,
    booth: me.booth,
    best_free_moves: me.bestFreeMoves,
    stats: await userStats(db, me.id),
  })
})

meRoutes.patch('/me', async (c) => {
  const body = patchMeRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) throw appError('VALIDATION', body.error.message)
  const me = c.get('authUser')

  const patch: { displayName?: string; booth?: boolean } = {}
  if (body.data.display_name !== undefined) {
    const name = body.data.display_name.trim()
    if (!isAcceptableDisplayName(name)) throw appError('INVALID_NAME')
    patch.displayName = name
  }
  if (body.data.booth !== undefined) patch.booth = body.data.booth

  const rows = await db.update(user).set(patch).where(eq(user.id, me.id)).returning({
    id: user.id,
    displayName: user.displayName,
    booth: user.booth,
    bestFreeMoves: user.bestFreeMoves,
  })
  const row = rows[0]
  if (!row) throw appError('INTERNAL')
  return c.json({
    id: row.id,
    display_name: row.displayName ?? '',
    booth: row.booth,
    best_free_moves: (row.bestFreeMoves ?? {}) as Record<string, number>,
    stats: await userStats(db, me.id),
  })
})

meRoutes.get('/achievements', async (c) => {
  const me = c.get('authUser')
  const unlocked = await db
    .select({
      achievement: userAchievements.achievement,
      unlockedAt: userAchievements.unlockedAt,
    })
    .from(userAchievements)
    .where(eq(userAchievements.userId, me.id))
  const byId = new Map(unlocked.map((u) => [u.achievement, u.unlockedAt]))
  return c.json({
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      icon: a.icon,
      unlocked_at: byId.get(a.id)?.toISOString() ?? null,
    })),
  })
})

/** 引き継ぎコードの発行（SPEC §7.4）。 */
meRoutes.post('/transfer', async (c) => {
  const me = c.get('authUser')
  const token = readableToken(TRANSFER_TOKEN_LENGTH)
  const expiresAt = new Date(Date.now() + TRANSFER_TOKEN_TTL_MINUTES * 60_000)
  await db.insert(transferTokens).values({ token, userId: me.id, expiresAt })
  const landing = process.env.LANDING_ORIGIN ?? 'https://coto2ba-next.chotech.dev'
  return c.json({
    token,
    expires_at: expiresAt.toISOString(),
    url: `${landing}/?transfer=${token}`,
  })
})

/** 引き継ぎの適用。呼び出したセッションのユーザーを既存ユーザーに差し替える。 */
meRoutes.post('/transfer/claim', async (c) => {
  const body = transferClaimRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) throw appError('VALIDATION', body.error.message)
  const me = c.get('authUser')
  const token = body.data.token.trim().toUpperCase()

  // 読み取りと消費を 1 文で行う。分けると同じコードを同時に 2 端末で使える（TOCTOU）。
  const rows = await db
    .update(transferTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(transferTokens.token, token),
        isNull(transferTokens.usedAt),
        gt(transferTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: transferTokens.userId })
  const row = rows[0]
  if (!row) throw appError('TRANSFER_INVALID')
  if (row.userId === me.id) throw appError('TRANSFER_INVALID', '同じ端末では引き継げません')

  // 呼び出し元の端末トークンを引き継ぎ先のユーザーに付け替える
  const bearer = c.req.header('authorization')
  const raw = bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : null
  if (raw) {
    await db.update(deviceTokens).set({ userId: row.userId }).where(eq(deviceTokens.token, raw))
  }

  const target = await db
    .select({ displayName: user.displayName })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1)

  return c.json({ user_id: row.userId, display_name: target[0]?.displayName ?? '' })
})
