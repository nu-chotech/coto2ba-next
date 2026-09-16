/**
 * Better Auth の設定（docs/ARCHITECTURE.md §2）。
 *
 * - 匿名アカウントのみ。ログイン画面は無い。
 * - クライアントは **Bearer トークン**で話す（Cookie を使わない）。
 *   Cookie ヘッダが無いリクエストではオリジン検証がスキップされるため、
 *   Expo Go の不安定な `exp://192.168.x.x:8081/--/` オリジン問題を構造的に回避できる。
 * - `trustedOrigins` は保険。`exp://*` は「/」を跨げず 403 になるので `exp://**`。
 * - **NODE_ENV で分岐しない**（Vercel の関数は常に production）。専用の環境変数で切る。
 */
import { expo } from '@better-auth/expo'
import { APP_SCHEME, SESSION_MAX_AGE_SEC } from '@coto2ba/contracts'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins/anonymous'
import { bearer } from 'better-auth/plugins/bearer'
import * as authSchema from './db/auth-schema'
import { db } from './db/client'

const allowExpoGoOrigins = process.env.ALLOW_EXPO_GO_ORIGINS === '1'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-do-not-use-in-production',

  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),

  trustedOrigins: [
    `${APP_SCHEME}://`,
    `exp+${APP_SCHEME}://**`,
    ...(process.env.LANDING_ORIGIN ? [process.env.LANDING_ORIGIN] : []),
    ...(process.env.API_ORIGIN ? [process.env.API_ORIGIN] : []),
    // Expo Go。ホストは開発機の DHCP 依存で予測不能なので全許可になるが、
    // ネイティブクライアントには ambient credential が無いのでオリジン検証の価値は元々低い。
    ...(allowExpoGoOrigins ? ['exp://**', 'http://**', 'https://**'] : []),
  ],

  emailAndPassword: { enabled: false },
  socialProviders: {},

  session: {
    expiresIn: SESSION_MAX_AGE_SEC,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  // 既定のメモリ内レート制限は Vercel ではインスタンス跨ぎに無意味で、偽 429 の原因になる
  rateLimit: { enabled: true, storage: 'database' },

  advanced: {
    // 匿名ユーザーの ID は crypto.randomUUID 相当でよい
    disableCSRFCheck: false,
  },

  plugins: [anonymous({ emailDomainName: 'anon.coto2ba.invalid' }), bearer(), expo()],
})

export type AuthSession = typeof auth.$Infer.Session
