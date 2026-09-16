import {
  ACHIEVEMENTS,
  DEVICE_TOKEN_LENGTH,
  EXPO_PROJECT_ID,
  EXPO_RUNTIME_VERSION,
  EXPO_UPDATE_CHANNEL,
  EXPO_UPDATE_ORIGIN,
  LANDING_URL,
  patchMeRequestSchema,
  TRANSFER_TOKEN_LENGTH,
  TRANSFER_TOKEN_TTL_MINUTES,
  transferClaimRequestSchema,
} from '@coto2ba/contracts'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { auth } from '../auth'
import { db } from '../db/client'
import { deviceTokens, session, transferTokens, user, userAchievements } from '../db/schema'
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

/**
 * 環境変数の値。**未設定なら既定値、明示的に空にしたら空文字**を返す
 * （空 = その設定を無効化したい、という意思表示として扱う）。
 */
function envOr(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined ? fallback : raw.trim()
}

/** 末尾のスラッシュを落としたランディングのオリジン。 */
function landingOrigin(): string {
  const origin = envOr('LANDING_ORIGIN', LANDING_URL)
  return (origin.length === 0 ? LANDING_URL : origin).replace(/\/+$/, '')
}

/**
 * 引き継ぎ QR / リンクに埋める URL（SPEC §7.4）。
 *
 * **https のランディングを符号化してはいけない。** iPhone のカメラで読むと Safari が
 * 開くだけでアプリに戻らない。Expo Go で直接開ける EAS Update のディープリンク
 * `exp://u.expo.dev/<projectId>?channel-name=…&runtime-version=…&transfer=<token>`
 * を返す（ランディングの「コトコトバを開く」と同じ形 + `transfer`）。
 *
 * 既定値は contracts（`EXPO_PROJECT_ID` / `EXPO_UPDATE_CHANNEL` / `EXPO_RUNTIME_VERSION`）。
 * デプロイ側で `EXPO_PROJECT_ID` / `EXPO_CHANNEL` / `EXPO_RUNTIME_VERSION` を上書きできる。
 * どれかを**空に潰した**ときだけ、ランディングの `?transfer=` にフォールバックする
 * （ランディングが受け取って `exp://` のボタンを出す）。`token` は URL とは別に必ず返すので、
 * URL がどちらの形でも手入力で引き継げる。
 */
function transferUrl(token: string): string {
  const projectId = envOr('EXPO_PROJECT_ID', EXPO_PROJECT_ID)
  const channel = envOr('EXPO_CHANNEL', EXPO_UPDATE_CHANNEL)
  const runtimeVersion = envOr('EXPO_RUNTIME_VERSION', EXPO_RUNTIME_VERSION)
  if (projectId.length === 0 || channel.length === 0 || runtimeVersion.length === 0) {
    return `${landingOrigin()}/?transfer=${token}`
  }
  const query = new URLSearchParams({
    'channel-name': channel,
    'runtime-version': runtimeVersion,
    transfer: token,
  })
  return `${EXPO_UPDATE_ORIGIN}/${projectId}?${query.toString()}`
}

/** 引き継ぎコードの発行（SPEC §7.4）。 */
meRoutes.post('/transfer', async (c) => {
  const me = c.get('authUser')
  const token = readableToken(TRANSFER_TOKEN_LENGTH)
  const expiresAt = new Date(Date.now() + TRANSFER_TOKEN_TTL_MINUTES * 60_000)
  await db.insert(transferTokens).values({ token, userId: me.id, expiresAt })
  return c.json({
    token,
    expires_at: expiresAt.toISOString(),
    url: transferUrl(token),
  })
})

/**
 * 引き継ぎの適用。呼び出した**資格情報**（Better Auth のセッション行と、
 * フォールバックの端末トークン）を引き継ぎ先のユーザーに付け替える（SPEC §7.4）。
 *
 * セッション行を動かさないと、実アプリ（Better Auth）では 1 件も引き継がれないのに
 * 200 と引き継ぎ元の表示名だけが返り、クライアントが「引き継ぎました」と嘘をつく。
 * どちらも動かせなかった場合はトークンの消費を取り消して失敗させる。
 */
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

  // 1) Better Auth のセッション行を付け替える（実アプリの本命の経路）
  const current = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
  let moved = false
  if (current?.session && current.session.userId === me.id) {
    const updated = await db
      .update(session)
      .set({ userId: row.userId })
      .where(and(eq(session.id, current.session.id), eq(session.userId, me.id)))
      .returning({ id: session.id })
    moved ||= updated.length > 0
  }

  // 2) 端末トークン（/devices のフォールバックとブースモード）も付け替える
  const bearer = c.req.header('authorization')
  const raw = bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : null
  if (raw) {
    const updated = await db
      .update(deviceTokens)
      .set({ userId: row.userId })
      .where(and(eq(deviceTokens.token, raw), eq(deviceTokens.userId, me.id)))
      .returning({ token: deviceTokens.token })
    moved ||= updated.length > 0
  }

  if (!moved) {
    // 付け替え先が無い＝この呼び出しは引き継ぎを起こせない。
    // 成功を返すと嘘になるので、トークンの消費を取り消して失敗させる。
    await db
      .update(transferTokens)
      .set({ usedAt: null })
      .where(eq(transferTokens.token, token))
      .catch(() => {})
    throw appError('INTERNAL', '引き継ぎに失敗しました。アプリを再起動してやり直してください')
  }

  // 3) 旧匿名ユーザーを片付ける（SPEC §7.4）。付け替え済みのセッション行と端末トークンは
  //    引き継ぎ先を指しているので cascade の巻き添えにはならない。失敗しても引き継ぎ自体は成立。
  await db
    .delete(user)
    .where(and(eq(user.id, me.id), eq(user.isAnonymous, true)))
    .catch((e: unknown) => {
      console.warn('[transfer/claim] 旧匿名ユーザーの削除に失敗', e)
    })

  const target = await db
    .select({ displayName: user.displayName })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1)

  return c.json({ user_id: row.userId, display_name: target[0]?.displayName ?? '' })
})
