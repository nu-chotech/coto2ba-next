/**
 * DB（と、そこに入っているデータ）の有無を **テストの収集時に** 判定する。
 *
 * 以前は各ファイルが `beforeAll` で接続を試し、テスト本体の先頭で
 * `if (!hasDb) return` していた。これだと DB が無いとき、テストは skipped ではなく
 * **「実行 0 件で passed」** になる。CI には postgres の service が無かったので、
 * 看板機能（外挿ヒント / ヒント数優先ランキング / 対戦ルーム）を壊しても
 * CI は全緑のまま通ってしまっていた。
 *
 * `it.skipIf` / `describe.skipIf` の条件は **収集時** に読まれるので、
 * 判定は `beforeAll` より前に終わっている必要がある。そのためここでは
 * top-level await を使い、モジュールの評価時に 1 度だけ probe する。
 *
 * probe には共有プール（`src/db/client` の `pool`）ではなく使い捨ての `Client` を
 * 使って必ず閉じる。ファイル内の全テストがスキップになると `afterAll` の
 * `pool.end()` は走らないので、共有プールに接続を残さないため。
 */
import { Client } from 'pg'
import { isLocalHost } from '../src/db/client'

/**
 * vocab が「入っている」とみなす最低行数。
 * 数行だけ入った中途半端な DB を「データあり」と誤判定しないための閾値で、
 * 本番の語彙数（N_OUTPUT）とは関係しない。
 */
const VOCAB_MIN_ROWS = 1000

interface Probe {
  /** マイグレーション済みの DB に繋がるか（`user` が引けるか）。 */
  db: boolean
  /** `enabled` な `goal_pool` の行があるか（パイプラインが流したデータが要る）。 */
  goalPoolRows: boolean
  /** `is_output` な vocab が十分入っているか（word2vec のデータが要る）。 */
  vocab: boolean
}

/** クエリが通るか（テーブルの有無を見る）。 */
async function queryable(client: Client, text: string): Promise<boolean> {
  try {
    await client.query(text)
    return true
  } catch {
    return false
  }
}

/** count クエリの結果。引けなければ 0。 */
async function count(client: Client, text: string): Promise<number> {
  try {
    const r = await client.query<{ n: number }>(text)
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

async function probe(): Promise<Probe> {
  const absent: Probe = { db: false, goalPoolRows: false, vocab: false }
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return absent

  const client = new Client({
    connectionString,
    ssl: !isLocalHost(connectionString),
    connectionTimeoutMillis: 10_000,
  })
  try {
    await client.connect()
  } catch {
    // 繋がらない＝DB 無し。`tests/setup.ts` が入れる「絶対に繋がらない接続先」もここに来る。
    return absent
  }
  try {
    return {
      db: await queryable(client, 'SELECT 1 FROM "user" LIMIT 1'),
      goalPoolRows:
        (await count(client, 'SELECT count(*)::int AS n FROM goal_pool WHERE enabled')) > 0,
      vocab:
        (await count(client, 'SELECT count(*)::int AS n FROM vocab WHERE is_output')) >
        VOCAB_MIN_ROWS,
    }
  } finally {
    await client.end().catch(() => {})
  }
}

const probed = await probe()

/** `SKIP_DB_TESTS=1` で DB を使うテストを明示的に止められる（従来どおりの逃がし口）。 */
const FORCED_SKIP = process.env.SKIP_DB_TESTS === '1'

/** マイグレーション済みの DB が要るテストを飛ばすか。 */
export const SKIP_WITHOUT_DB = FORCED_SKIP || !probed.db
/** `goal_pool` の行が要るテストを飛ばすか。 */
export const SKIP_WITHOUT_GOAL_POOL_ROWS = FORCED_SKIP || !probed.goalPoolRows
/** vocab のデータが要るテストを飛ばすか。 */
export const SKIP_WITHOUT_VOCAB = FORCED_SKIP || !probed.vocab

if (!FORCED_SKIP) {
  const missing = [
    probed.db ? null : 'DB（マイグレーション）',
    probed.goalPoolRows ? null : 'goal_pool の行',
    probed.vocab ? null : 'vocab のデータ',
  ].filter((x): x is string => x !== null)
  if (missing.length > 0) {
    console.warn(
      `[db-available] ${missing.join(' / ')} が無いので、依存するテストはスキップされます`,
    )
  }
}
