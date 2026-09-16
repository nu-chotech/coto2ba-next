/**
 * 設定画面まわりの定数。
 *
 * 表示名の長さ・引き継ぎトークンの有効期間は **packages/contracts**
 * （`DISPLAY_NAME_MIN_LENGTH` / `DISPLAY_NAME_MAX_LENGTH` / `TRANSFER_TOKEN_TTL_MINUTES`）。
 * ここに置くのは描画の都合だけ。
 */

/** QR の周囲に必ず取る静穏帯（モジュール数）。ISO の推奨は 4。 */
export const QR_QUIET_ZONE_MODULES = 4
/** QR カードの一辺（pt）。画面幅からこれと余白の小さい方を取る。 */
export const QR_MAX_SIZE = 260
/** 引き継ぎ QR の誤り訂正レベル。ブースの照明でも読めるよう少し強めにする。 */
export const QR_EC_LEVEL = 'Q' as const
/**
 * 上の強さでは収まらないときに落とす誤り訂正レベル。
 * `qr.ts` はバージョン 1〜10 までなので、EAS Update のディープリンク
 * （`exp://u.expo.dev/<projectId>?channel-name=…&runtime-version=…&transfer=…` ＝ 150 字前後）は
 * Q だと容量を超える。**QR が消えるより、少し弱い QR が出る方がよい。**
 */
export const QR_EC_FALLBACK_LEVEL = 'M' as const

/** トークン文字列を読み上げやすく区切る長さ。 */
export const TOKEN_CHUNK_SIZE = 4
/** 「コピーしました」を出しておく時間。 */
export const COPY_FEEDBACK_MS = 1600

/** 設定の 1 行の最小の高さ（スイッチが縦に揺れないように）。 */
export const SETTINGS_ROW_MIN_HEIGHT = 44
