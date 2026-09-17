/**
 * レート制限（SPEC §7.8）。**容量（バースト）と補充（持続レート）は別物**であることを固定する。
 *
 * ここで守りたいのは 2 つで、どちらも展示で直接効く。
 *
 * 1. **アプリを開いた瞬間に 429 を出さない。** 起動時はタブ 4 枚ぶんのクエリが
 *    一斉に走り、対戦の参加リンクから開くと参加とポーリングも重なる。
 *    以前は容量を持続レートと同じ 5 に縛っていたため、**起動のたびに 429 が出ていた**。
 * 2. **バースト許容が防御を無効化しない。** 使い切ったあとは持続レートぶんしか戻らない。
 *
 * もう 1 つ、**ポーリングがゲーム操作の枠を食わない**ことも見る。
 * 混ざると「レース中にたまに手が打てない」という分かりにくい形で出る。
 *
 * 前半はミドルウェアだけを組んだ小さなアプリで確かめる（DB 不要）。
 * 最後の 1 群だけは**ルートの登録の仕方**を見るので本物のアプリを叩く（DB が要る）。
 */
import {
  RATE_LIMIT_BURST_PER_USER,
  RATE_LIMIT_PER_USER_PER_SECOND,
  RATE_LIMIT_ROOM_POLL_BURST,
  RATE_LIMIT_ROOM_POLL_PER_SECOND,
} from '@coto2ba/contracts'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import { db, pool } from '../src/db/client'
import { user } from '../src/db/schema'
import { AppError } from '../src/lib/errors'
import type { AuthVariables } from '../src/middleware/auth'
import { rateLimit, rateLimitRoomPoll } from '../src/middleware/rateLimit'
import { SKIP_WITHOUT_DB } from './db-available'

/**
 * **Web でアプリを開いた瞬間に飛ぶリクエスト本数の実測値**（2026-09-18）。
 *
 * 対戦の参加リンク（`/play/room/<code>`）で起動したときが最大で、開始から 1 秒以内に 7 本。
 * 62ms 以内に 6 本（参加・`/me`・`/collection`・`/daily`・`/leaderboard/daily`・
 * `/words/:w/detail`）＋ 429 を踏んだ参加の投げ直しが 1 本。
 * 測り方は `performance.getEntriesByType('resource')` を 1 秒のスライディングウィンドウで数えた。
 */
const STARTUP_BURST_MEASURED = 7

/**
 * 画面が切り替わる瞬間に部屋のポーリングが重なった本数の実測値（1 秒以内）。
 * 定常状態は 1 秒 1 本だが、着地直後の初回取得と Web の hydrate による作り直しが重なる。
 */
const ROOM_POLL_BURST_MEASURED = 4

/** 実測に対して最低限確保したい余裕。 */
const REQUIRED_HEADROOM = 2

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

function uniqueUser(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/** 立て続けに投げて、200 が何本続いたかを返す。 */
async function countConsecutiveOk(
  app: ReturnType<typeof probeApp>,
  path: string,
  method: 'GET' | 'POST',
  attempts: number,
): Promise<number> {
  let ok = 0
  for (let i = 0; i < attempts; i += 1) {
    const res = await app.request(path, { method })
    if (res.status !== 200) break
    ok += 1
  }
  return ok
}

describe('汎用のレート制限（バーストと持続レート）', () => {
  it('アプリを開いた瞬間のリクエストは 429 にならない（実測 7 本）', async () => {
    const app = probeApp(uniqueUser('startup'))
    for (let i = 0; i < STARTUP_BURST_MEASURED; i += 1) {
      const res = await app.request('/act', { method: 'POST' })
      expect(res.status).toBe(200)
    }
  })

  // 実測より容量が下がったら、起動時 429 が再発する。定数で止める。
  it('容量は実測のバーストに対して余裕がある', () => {
    expect(RATE_LIMIT_BURST_PER_USER).toBeGreaterThanOrEqual(
      STARTUP_BURST_MEASURED * REQUIRED_HEADROOM,
    )
  })

  // バーストを緩めた代わりに防御が消えていないこと。
  it('バーストを使い切ったら 429', async () => {
    const app = probeApp(uniqueUser('burst'))
    for (let i = 0; i < RATE_LIMIT_BURST_PER_USER; i += 1) {
      expect((await app.request('/act', { method: 'POST' })).status).toBe(200)
    }
    expect((await app.request('/act', { method: 'POST' })).status).toBe(429)
  })

  /**
   * **持続レートは据え置き。** 使い切ったあと 1 秒待っても、戻るのは
   * `RATE_LIMIT_PER_USER_PER_SECOND` ぶんだけで、容量ぶん（20）は戻らない。
   * 補充に容量を渡す取り違えをすると、ここが落ちる。
   */
  it('使い切ったあと 1 秒で戻るのは持続レートぶんだけ', async () => {
    const app = probeApp(uniqueUser('sustained'))
    for (let i = 0; i < RATE_LIMIT_BURST_PER_USER; i += 1) {
      await app.request('/act', { method: 'POST' })
    }
    expect((await app.request('/act', { method: 'POST' })).status).toBe(429)

    await new Promise<void>((resolve) => setTimeout(resolve, 1000))

    const refilled = await countConsecutiveOk(app, '/act', 'POST', RATE_LIMIT_BURST_PER_USER)
    expect(refilled).toBeGreaterThanOrEqual(RATE_LIMIT_PER_USER_PER_SECOND)
    // タイマーの誤差ぶん 1 本だけ多めを許す。容量ぶん戻っていたらここで落ちる。
    expect(refilled).toBeLessThanOrEqual(RATE_LIMIT_PER_USER_PER_SECOND + 1)
  })
})

describe('部屋のポーリングのレート制限', () => {
  it('画面が切り替わる瞬間に重なっても 429 にならない（実測 4 本）', async () => {
    const app = probeApp(uniqueUser('poll-burst'))
    for (let i = 0; i < ROOM_POLL_BURST_MEASURED; i += 1) {
      expect((await app.request('/poll')).status).toBe(200)
    }
  })

  it('容量は実測の重なりに対して余裕がある', () => {
    expect(RATE_LIMIT_ROOM_POLL_BURST).toBeGreaterThanOrEqual(
      ROOM_POLL_BURST_MEASURED * REQUIRED_HEADROOM,
    )
  })

  it('ポーリングを使い切っても、ゲーム操作の枠は満タンのまま', async () => {
    const app = probeApp(uniqueUser('poll-vs-act'))

    // ポーリングのバケツをきっかり使い切る。
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_BURST; i += 1) {
      expect((await app.request('/poll')).status).toBe(200)
    }

    // 同じバケツを共有していたら、ここで 429 が出る。
    for (let i = 0; i < RATE_LIMIT_BURST_PER_USER; i += 1) {
      expect((await app.request('/act', { method: 'POST' })).status).toBe(200)
    }
  })

  it('ポーリング自体も枠を超えると 429', async () => {
    const app = probeApp(uniqueUser('poll-over'))
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_BURST; i += 1) {
      expect((await app.request('/poll')).status).toBe(200)
    }
    expect((await app.request('/poll')).status).toBe(429)
  })

  it('使い切ったあと 1 秒で戻るのは持続レートぶんだけ', async () => {
    const app = probeApp(uniqueUser('poll-sustained'))
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_BURST; i += 1) {
      await app.request('/poll')
    }
    expect((await app.request('/poll')).status).toBe(429)

    await new Promise<void>((resolve) => setTimeout(resolve, 1000))

    const refilled = await countConsecutiveOk(app, '/poll', 'GET', RATE_LIMIT_ROOM_POLL_BURST)
    expect(refilled).toBeGreaterThanOrEqual(RATE_LIMIT_ROOM_POLL_PER_SECOND)
    expect(refilled).toBeLessThanOrEqual(RATE_LIMIT_ROOM_POLL_PER_SECOND + 1)
  })

  it('ユーザーが違えばバケツも違う（同じ部屋の 8 人が互いを詰まらせない）', async () => {
    const a = probeApp(uniqueUser('poll-a'))
    const b = probeApp(uniqueUser('poll-b'))
    for (let i = 0; i < RATE_LIMIT_ROOM_POLL_BURST; i += 1) {
      expect((await a.request('/poll')).status).toBe(200)
    }
    expect((await b.request('/poll')).status).toBe(200)
  })
})

/**
 * **1 リクエストで食うトークンは 1 つだけ**であることを、本物のアプリで確かめる。
 *
 * Hono では `use('/x/*')` が `/x` 自身にも一致する。`use('/x')` と `use('/x/*')` を
 * 両方書くと `rateLimit` が 1 リクエストで 2 回走り、**枠を倍に食う**。
 * 実際に `/api/me` と `POST /api/transfer` がそうなっていて、
 * アプリの起動（必ず `/api/me` を呼ぶ）で 429 を出やすくしていた。
 *
 * ミドルウェアの単体試験では見つからない（ルートの登録の仕方の問題なので）。
 * DB が無ければ skipped として報告する（実行 0 件の passed にしない）。
 */
describe.skipIf(SKIP_WITHOUT_DB)('1 リクエストが食うトークンは 1 つ', () => {
  const createdUserIds: string[] = []

  afterAll(async () => {
    for (const id of createdUserIds) {
      await db
        .delete(user)
        .where(eq(user.id, id))
        .catch(() => {})
    }
    await pool.end().catch(() => {})
  })

  /** 端末トークンで入る（Better Auth を通さない。レート制限の対象外の経路）。 */
  async function device(): Promise<string> {
    const res = await app.request('/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const body = (await res.json()) as { token: string; user_id: string }
    createdUserIds.push(body.user_id)
    return body.token
  }

  /** 429 が出るまでに何本通ったか。 */
  async function okBefore429(
    path: string,
    bearer: string,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<number> {
    let ok = 0
    for (let i = 0; i < RATE_LIMIT_BURST_PER_USER * 2; i += 1) {
      const res = await app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      })
      if (res.status === 429) break
      ok += 1
    }
    return ok
  }

  // `/api/me` は起動時に必ず呼ぶので、ここが 2 倍食うと起動 429 が出やすくなる。
  it('GET /api/me は 1 本につき 1 トークン', async () => {
    expect(await okBefore429('/api/me', await device())).toBeGreaterThanOrEqual(
      RATE_LIMIT_BURST_PER_USER,
    )
  })

  it('POST /api/transfer は 1 本につき 1 トークン', async () => {
    expect(await okBefore429('/api/transfer', await device(), 'POST')).toBeGreaterThanOrEqual(
      RATE_LIMIT_BURST_PER_USER,
    )
  })

  // 二重登録していない対照。ここが壊れたら原因は別にある。
  it('GET /api/daily も 1 本につき 1 トークン', async () => {
    expect(await okBefore429('/api/daily', await device())).toBeGreaterThanOrEqual(
      RATE_LIMIT_BURST_PER_USER,
    )
  })
})
