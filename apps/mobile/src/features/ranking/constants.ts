/**
 * ランキング画面だけで使う定数。
 *
 * ゲームのルールに関わる値は **packages/contracts**（`LEADERBOARD_LIMIT` など）。
 * ここに置くのは表示・日付計算の都合だけ。contracts に昇格させるべき値を見つけたら
 * 親に報告すること（`JST_UTC_OFFSET_MINUTES` は候補）。
 */

/**
 * JST の UTC からのオフセット（分）。日本には夏時間が無いので固定値でよい。
 *
 * **`Intl` / `toLocaleDateString` に頼らない。** Hermes の Intl はビルド構成で
 * 有無が変わるため、端末によって日付が 1 日ずれる事故になりうる。
 * contracts の `DAILY_TZ`（'Asia/Tokyo'）と同じ意味の値。
 */
export const JST_UTC_OFFSET_MINUTES = 9 * 60

/** 順位バッジの直径。 */
export const RANK_BADGE_SIZE = 40
/** 1 行の最小の高さ（名前が 1 行でも 2 行でも並びが崩れないように）。 */
export const LEADERBOARD_ROW_MIN_HEIGHT = 56
/** 自分の行を強調する枠の太さ。 */
export const ME_ROW_BORDER_WIDTH = 2
/** スケルトンで並べる行数。 */
export const LEADERBOARD_SKELETON_ROWS = 8
