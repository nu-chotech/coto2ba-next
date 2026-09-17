/**
 * ポーリングのレート制限が **ゲーム操作の枠を食わない**こと（SPEC §9.4）。
 *
 * これは展示で必ず踏む種類の事故で、しかも「たまに手が打てない」という
 * 分かりにくい形で出る。1 秒ポーリングが汎用バケツ（5 req/s）を削ると、
 * レース中に手を打った瞬間だけ 429 になる。
 *
 * DB を使わない（ミドルウェアだけを組んだ小さなアプリで確かめる）。
 */
import { RATE_LIMIT_PER_USER_PER_SECOND, RATE_LIMIT_ROOM_POLL_PER_SECOND } from '@coto2ba/contracts'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/errors'
import type { AuthVariables } from '../src/middleware/auth'
import { rateLimit, rateLimitRoomPoll } from '../src/middleware/rateLimit'

/** 認証を通した体で `authUser` だけを立てる小さなアプリ。 */
function probeApp(userId: string) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', async (c, next) => {
    c.set('authUser', { id: userId, displayName: null, booth: false, bestFreeMoves: {} })
    await next()
  })
  app.get('/poll', rateLimitRoomPoll, (c) => c.text('ok'))
  app.post('/act', rateLimit, (c) => c.text('ok'))
  // 本体（app.ts）と同じく AppError をステータスに変換する。
  app.onError((err, c) =>
    err instanceof AppError ? c.json(err.toBody(), err.status) : c.text('boom', 500),
  )
  return app
}

describe('部屋のポーリングのレート制限', () => {
  it('ポーリングを使い切っても、ゲーム操作の枠は満タンのまま', async () => {
    const app = probeApp(`poll-${crypto.randomUUID()}`)

    // ポーリングのバケツをきっかり使い切る。
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_PER_SECOND; i += 1) {
      const res = await app.request('/poll')
      expect(res.status).toBe(200)
    }

    // 同じバケツを共有していたら、ここで 429 が出る。
    for (let i = 0; i < RATE_LIMIT_PER_USER_PER_SECOND; i += 1) {
      const res = await app.request('/act', { method: 'POST' })
      expect(res.status).toBe(200)
    }
  })

  it('ポーリング自体は枠を超えると 429', async () => {
    const app = probeApp(`poll-over-${crypto.randomUUID()}`)
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_PER_SECOND; i += 1) {
      expect((await app.request('/poll')).status).toBe(200)
    }
    expect((await app.request('/poll')).status).toBe(429)
  })

  it('ユーザーが違えばバケツも違う（同じ部屋の 8 人が互いを詰まらせない）', async () => {
    const a = probeApp(`poll-a-${crypto.randomUUID()}`)
    const b = probeApp(`poll-b-${crypto.randomUUID()}`)
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_PER_SECOND; i += 1) {
      expect((await a.request('/poll')).status).toBe(200)
    }
    expect((await b.request('/poll')).status).toBe(200)
  })
})
