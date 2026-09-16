import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth'
import { AppError } from './lib/errors'
import type { AuthVariables } from './middleware/auth'
import { gamesRoutes } from './routes/games'
import { meRoutes } from './routes/me'
import { wordsRoutes } from './routes/words'

export const app = new Hono<{ Variables: AuthVariables }>()

if (process.env.API_LOG !== '0') app.use('*', logger())

app.use(
  '*',
  cors({
    // ネイティブクライアントは Origin を持たないか exp:// を送る。
    // Cookie を使わない Bearer 運用なので credentials は不要。
    origin: (origin) => origin ?? '*',
    allowHeaders: ['Content-Type', 'Authorization', 'expo-origin'],
    exposeHeaders: ['set-auth-token'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
)

app.get('/api/health', (c) =>
  c.json({ ok: true, now: new Date().toISOString(), region: process.env.VERCEL_REGION ?? 'local' }),
)

// Better Auth（/api/auth/*）
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.route('/api', meRoutes)
app.route('/api', gamesRoutes)
app.route('/api', wordsRoutes)

app.notFound((c) => c.json({ code: 'GAME_NOT_FOUND', message: 'そのパスはありません' }, 404))

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(err.toBody(), err.status)
  }
  console.error('[unhandled]', err)
  return c.json({ code: 'INTERNAL', message: 'サーバーエラーが発生しました' }, 500)
})
