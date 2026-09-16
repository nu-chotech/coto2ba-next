/** ローカル開発サーバー。`pnpm --filter @coto2ba/api dev` */
import './env'

import { serve } from '@hono/node-server'
import { app } from './app'

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`coto2ba api: http://localhost:${info.port}`)
})
