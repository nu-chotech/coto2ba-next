/**
 * 対戦ルーム（SPEC §9.4）。
 *
 * | メソッド | パス | 用途 |
 * | --- | --- | --- |
 * | POST | `/api/rooms`             | 部屋を作る（ホスト） |
 * | POST | `/api/rooms/:code/join`  | 参加する |
 * | POST | `/api/rooms/:code/start` | 開始（ホストのみ） |
 * | GET  | `/api/rooms/:code`       | 状態の取得（**1 秒ポーリング先**） |
 *
 * **`GET /api/rooms/:code` だけ専用のレート制限バケツを使う。** 汎用の `rateLimit`
 * （5 req/s）と共有すると、毎秒のポーリングがゲーム操作の枠を食って
 * レース中に手を打った瞬間に 429 が出る（§9.4）。
 *
 * この Hono ルータは `app.ts` の 1 行で外せる。**間に合わなければ機能ごと落とせる**
 * ようにするための境界なので、他のルートからここを import しないこと。
 */
import { createRoomRequestSchema, roomCodeSchema } from '@coto2ba/contracts'
import { Hono } from 'hono'
import { db } from '../db/client'
import { appError } from '../lib/errors'
import type { AuthVariables } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'
import { rateLimit, rateLimitGameCreate, rateLimitRoomPoll } from '../middleware/rateLimit'
import { createRoom, joinRoom, roomState, startRoom } from '../services/rooms'

export const roomsRoutes = new Hono<{ Variables: AuthVariables }>()

// **ここで rateLimit を全体に掛けないこと。** GET はポーリング専用のバケツを使う。
roomsRoutes.use('*', requireAuth)

/** パスの `:code` を正規化する（手入力の小文字・前後の空白を吸収）。 */
function codeOf(raw: string | undefined): string {
  const parsed = roomCodeSchema.safeParse(raw ?? '')
  if (!parsed.success) throw appError('ROOM_NOT_FOUND')
  return parsed.data
}

roomsRoutes.post('/rooms', rateLimit, rateLimitGameCreate, async (c) => {
  const body = createRoomRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) throw appError('VALIDATION', body.error.message)
  const room = await createRoom(db, c.get('authUser').id, body.data.difficulty ?? 'normal')
  return c.json(room)
})

roomsRoutes.post('/rooms/:code/join', rateLimit, async (c) => {
  const room = await joinRoom(db, c.get('authUser').id, codeOf(c.req.param('code')))
  return c.json(room)
})

roomsRoutes.post('/rooms/:code/start', rateLimit, async (c) => {
  const room = await startRoom(db, c.get('authUser').id, codeOf(c.req.param('code')))
  return c.json(room)
})

roomsRoutes.get('/rooms/:code', rateLimitRoomPoll, async (c) => {
  const room = await roomState(db, c.get('authUser').id, codeOf(c.req.param('code')))
  return c.json(room)
})
