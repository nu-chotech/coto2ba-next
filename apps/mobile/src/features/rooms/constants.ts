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
/**
 * レース中の順位オーバーレイを**畳まずに全員出せる人数の上限**。
 *
 * **8 人を全部出すとゲームの入力欄と「混ぜる」が画面外に落ちる**
 * （390×844 で input の top が 987 になっていた。満員に近いほど遊べなくなるという本末転倒）。
 * この人数までは全員出しても操作系を押し下げないので、そのまま出す。
 * 超えたら自分の 1 行だけにして、広げたいときだけ広げてもらう（`collapsedRowsFor`）。
 */
export const ROOM_STANDING_COLLAPSED_ROWS = 3
/** 広げたときに出す最大人数（＝ 1 部屋の上限）。 */
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
