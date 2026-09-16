import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __coto2baPool: Pool | undefined
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** 接続先がローカルホストか。ホスト名で厳密に判定する。 */
function isLocalHost(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname.replace(/^\[|\]$/g, ''))
  } catch {
    return false
  }
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL が設定されていません')
  }
  const pool = new Pool({
    connectionString,
    // Vercel の Fluid Compute では warm なインスタンスを跨いで使い回されるので小さく保つ
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon は公開 CA なので検証を有効にしたままでよい。ローカル Docker だけ TLS を切る。
    // 部分一致ではなくホスト名で判定する（'localhost' を含むだけの外部ホストに騙されないため）。
    ssl: isLocalHost(connectionString) ? false : true,
  })
  // Vercel Functions で invocation を跨いだ接続リークを防ぐ
  void import('@vercel/functions')
    .then((m) => {
      if (typeof m.attachDatabasePool === 'function') m.attachDatabasePool(pool)
    })
    .catch(() => {
      /* ローカル実行時は @vercel/functions が無くてもよい */
    })
  return pool
}

export const pool: Pool = globalThis.__coto2baPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalThis.__coto2baPool = pool

export const db = drizzle(pool, { schema })
export type Db = typeof db
