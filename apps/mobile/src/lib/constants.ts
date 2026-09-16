/**
 * クライアント専用の定数。
 *
 * ゲームのルールに関わる定数は **packages/contracts** にある。ここには
 * 「サーバーと共有する必要がないもの」だけを置く（ネットワークの待ち時間、
 * SecureStore のキー、語彙ロードのチャンクサイズなど）。
 * contracts に足すべき定数を見つけたら親に報告すること。
 */

// ── ネットワーク ────────────────────────────────────────────
/** API の応答待ち上限。 */
export const API_TIMEOUT_MS = 15_000
/** 開発時に Metro のホストへ向けるときのポート（apps/api の dev サーバ）。 */
export const DEV_API_PORT = 8787
/** hostUri も env も取れないときの最後の砦。 */
export const FALLBACK_API_URL = `http://localhost:${DEV_API_PORT}`

// ── react-query ────────────────────────────────────────────
export const QUERY_RETRY_COUNT = 1
export const QUERY_STALE_TIME_MS = 30_000
export const QUERY_GC_TIME_MS = 5 * 60_000

// ── 認証 ────────────────────────────────────────────────────
/**
 * SecureStore のキー。**コロンを含めない**
 * （iOS のキーチェーンで扱えない文字が混ざると黙って失敗する）。
 */
export const SECURE_STORE_AUTH_TOKEN_KEY = 'coto2ba_auth_token'
/** Better Auth が Bearer トークンを返すレスポンスヘッダ。 */
export const AUTH_TOKEN_HEADER = 'set-auth-token'

// ── 語彙ロード ──────────────────────────────────────────────
/** Set を作るときに一度に処理する語数。多すぎると JS スレッドが詰まる。 */
export const VOCAB_CHUNK_SIZE = 20_000
/** 進捗を store に書き戻す間隔（チャンク数）。 */
export const VOCAB_PROGRESS_CHUNK_INTERVAL = 2

// ── 効果音 ──────────────────────────────────────────────────
/** SE の音量。展示会場で鳴りすぎないように控えめ。 */
export const SOUND_VOLUME = 0.6
/** `clear` の 2 発目のハプティクスまでの間隔（SPEC §8.6）。 */
export const CLEAR_HAPTIC_DELAY_MS = 300
/** `perfect` の追加ハプティクスの間隔。 */
export const PERFECT_HAPTIC_DELAY_MS = 140
