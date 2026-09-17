/**
 * 対戦ルームの画面まわりの定数。
 *
 * ゲームのルールに関わる値（人数・コード長・ポーリング間隔）は
 * **packages/contracts**（`ROOM_MAX_PLAYERS` / `ROOM_CODE_LENGTH` /
 * `ROOM_POLL_INTERVAL_RACE_MS`）。ここに置くのは描画の都合だけ。
 */

/** 参加コードを読み上げやすい大きさで出すときの文字サイズ（pt）。 */
export const ROOM_CODE_FONT_SIZE = 64
/** コードの字間。4 桁を 1 文字ずつ読み上げてもらうので広めに取る。 */
export const ROOM_CODE_LETTER_SPACING = 8
/** QR カードの一辺の上限（pt）。ブースの離れた位置からでも読める大きさ。 */
export const ROOM_QR_MAX_SIZE = 240
/** 順位 1 行の最小の高さ（毎秒の更新で行が揺れないように固定する）。 */
export const ROOM_STANDING_ROW_MIN_HEIGHT = 34
/** 順位バッジの直径。 */
export const ROOM_RANK_BADGE_SIZE = 24
/** レース中の順位オーバーレイに出す最大人数（画面を埋めない）。 */
export const ROOM_STANDING_VISIBLE_LIMIT = 8
/** 自分の行の枠の太さ。 */
export const ROOM_ME_BORDER_WIDTH = 2

/**
 * 参加を投げ直す回数。ブースでは 8 人が一斉に QR を読むので、
 * 汎用のレート制限バケツ（5 req/s）と画面を開いた瞬間の他のクエリがぶつかる。
 */
export const ROOM_JOIN_RETRY_COUNT = 4
/** 投げ直すまでの基準の待ち（ms）。回数に比例して伸ばす。 */
export const ROOM_JOIN_RETRY_DELAY_MS = 700
