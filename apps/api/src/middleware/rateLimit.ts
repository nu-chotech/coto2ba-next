/**
 * ユーザー単位の簡易 token bucket（SPEC §7.8）。
 * Vercel のインスタンスを跨ぐと甘くなるのは許容範囲（仕様に明記）。
 */
import { RATE_LIMIT_GAMES_PER_MINUTE, RATE_LIMIT_PER_USER_PER_SECOND } from '@coto2ba/contracts'
import { createMiddleware } from 'hono/factory'
import { appError } from '../lib/errors'
import type { AuthVariables } from './auth'

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

function take(key: string, capacity: number, refillPerMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now }
  b.tokens = Math.min(capacity, b.tokens + (now - b.updatedAt) * refillPerMs)
  b.updatedAt = now
  if (b.tokens < 1) {
    buckets.set(key, b)
    return false
  }
  b.tokens -= 1
  if (buckets.size > MAX_BUCKETS) buckets.clear()
  buckets.set(key, b)
  return true
}

/** 汎用: ユーザーごと 5 req/s */
export const rateLimit = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const id = c.get('authUser')?.id ?? c.req.header('x-forwarded-for') ?? 'anon'
  if (!take(`u:${id}`, RATE_LIMIT_PER_USER_PER_SECOND, RATE_LIMIT_PER_USER_PER_SECOND / 1000)) {
    throw appError('RATE_LIMITED')
  }
  await next()
})

/** ゲーム作成: ユーザーごと 10 req/min */
export const rateLimitGameCreate = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const id = c.get('authUser')?.id ?? 'anon'
    if (!take(`g:${id}`, RATE_LIMIT_GAMES_PER_MINUTE, RATE_LIMIT_GAMES_PER_MINUTE / 60_000)) {
      throw appError('RATE_LIMITED')
    }
    await next()
  },
)
