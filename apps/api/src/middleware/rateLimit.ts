/**
 * ユーザー単位の簡易 token bucket（SPEC §7.8）。
 * Vercel のインスタンスを跨ぐと甘くなるのは許容範囲（仕様に明記）。
 *
 * ## 容量（バースト）と補充（持続レート）は別物
 *
 * 以前はどちらにも `RATE_LIMIT_PER_USER_PER_SECOND`（5）を渡していた。
 * 守りたいのは「持続 5 req/s」だけなのに、**一度に許す本数まで 5 に縛って**いたので、
 * アプリを開いた瞬間のバースト（タブ 4 枚ぶんのクエリが一斉に走る）が必ず溢れ、
 * **起動のたびに 429 が出ていた**（実測で 1 秒以内に 7 本）。
 *
 * いまは容量だけを上げ、補充は据え置いてある。
 * - 起動時の一斉リクエストは通る
 * - 叩き続ける相手は従来どおり持続レートで頭打ちになる
 *   （容量を使い切ったあとは 1 秒あたり持続レートぶんしか戻らない）
 *
 * 値と根拠は `packages/contracts/src/constants.ts` のコメント。
 */
import {
  RATE_LIMIT_BURST_PER_USER,
  RATE_LIMIT_GAMES_PER_MINUTE,
  RATE_LIMIT_PER_USER_PER_SECOND,
  RATE_LIMIT_ROOM_POLL_BURST,
  RATE_LIMIT_ROOM_POLL_PER_SECOND,
} from '@coto2ba/contracts'
import { createMiddleware } from 'hono/factory'
import { appError } from '../lib/errors'
import type { AuthVariables } from './auth'

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

const MS_PER_SECOND = 1000

/**
 * トークンを 1 つ取る。取れなければ false。
 *
 * @param capacity        一度に許す本数（バースト）。バケツの満タン。
 * @param refillPerSecond 1 秒あたりに戻る本数（持続レート）。**capacity と混同しないこと。**
 */
function take(key: string, capacity: number, refillPerSecond: number): boolean {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updatedAt) * refillPerSecond) / MS_PER_SECOND)
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

/** 汎用: バースト `RATE_LIMIT_BURST_PER_USER` 本 / 持続 `RATE_LIMIT_PER_USER_PER_SECOND` req/s */
export const rateLimit = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const id = c.get('authUser')?.id ?? c.req.header('x-forwarded-for') ?? 'anon'
  if (!take(`u:${id}`, RATE_LIMIT_BURST_PER_USER, RATE_LIMIT_PER_USER_PER_SECOND)) {
    throw appError('RATE_LIMITED')
  }
  await next()
})

/**
 * ゲーム作成: ユーザーごと 10 req/min。
 * ここは**起動時のバーストに乗らない**（必ず人の操作で 1 本ずつ飛ぶ）ので、
 * 容量と持続レートを分ける理由が無い。10 本使ったら 6 秒に 1 本ずつ戻る。
 */
export const rateLimitGameCreate = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const id = c.get('authUser')?.id ?? 'anon'
    if (!take(`g:${id}`, RATE_LIMIT_GAMES_PER_MINUTE, RATE_LIMIT_GAMES_PER_MINUTE / 60)) {
      throw appError('RATE_LIMITED')
    }
    await next()
  },
)

/**
 * 部屋の状態取得（1 秒ポーリング）。
 * バースト `RATE_LIMIT_ROOM_POLL_BURST` 本 / 持続 `RATE_LIMIT_ROOM_POLL_PER_SECOND` req/s。
 *
 * **汎用の `rateLimit` と必ず別のバケツにする。** 同じバケツだと
 * 毎秒のポーリングがゲーム操作の枠を食い、レース中に手を打った瞬間に 429 が出る。
 */
export const rateLimitRoomPoll = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const id = c.get('authUser')?.id ?? 'anon'
  if (!take(`rp:${id}`, RATE_LIMIT_ROOM_POLL_BURST, RATE_LIMIT_ROOM_POLL_PER_SECOND)) {
    throw appError('RATE_LIMITED')
  }
  await next()
})
