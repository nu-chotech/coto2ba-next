/**
 * Vercel 用のエントリ。
 * **ファイル名を index.ts / app.ts / server.ts にしないこと**
 * （Vercel がそれらを別の関数として自動検出し、二重デプロイになる）。
 */
import { handle } from 'hono/vercel'
import { app } from './app'

export default { fetch: handle(app) }
