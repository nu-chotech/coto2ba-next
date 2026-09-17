import { config } from 'dotenv'

config({ path: ['.env.local', '../../.env.local'], quiet: true })

/**
 * DB が無い環境（CI など）でもテストを走らせるための細工。
 *
 * vector / transfer の統合テストは `beforeAll` で接続を試し、失敗したら
 * スキップするように書いてある。ところが `src/db/client.ts` は
 * DATABASE_URL が未設定だと **import の時点で** throw するので、
 * `beforeAll` に到達する前にファイルごと落ちていた。
 *
 * client.ts の throw は本番の設定ミスを大声で知らせるための防波堤なので弱めたくない。
 * 代わりにここで「絶対に繋がらない接続先」を入れておく。
 * pg は最初のクエリまで接続しないので import は通り、`beforeAll` の
 * SELECT が ECONNREFUSED で失敗して、意図どおりスキップに落ちる。
 *
 * ポート 1 は予約済みで即座に拒否されるため、タイムアウトを待たされない。
 * localhost を指すので client.ts 側で TLS も切れる。
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://ci:ci@127.0.0.1:1/coto2ba_absent'
}
