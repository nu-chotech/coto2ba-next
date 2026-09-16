/**
 * 図鑑（3D ベクトル空間）の定数。
 *
 * ゲーム・データに関わる値は **packages/contracts**：
 * `SPACE_FOCAL` / `SPACE_GHOST_COUNT` / `SPACE_LABEL_LIMIT` / `SPACE_TAP_RADIUS`。
 * ここに置くのは「描画とカメラの手触り」だけ。
 * contracts に昇格させるべき値（深度フォールオフの帯など）は親に報告すること。
 */

// ── カメラ ──────────────────────────────────────────────────
/** 原点からカメラまでの距離。小さいほど寄る。 */
export const SPACE_DISTANCE_DEFAULT = 3.2
export const SPACE_DISTANCE_MIN = 1.5
export const SPACE_DISTANCE_MAX = 8
/** ピンチ中だけ許す行き過ぎ（離すとバネで戻る）。 */
export const SPACE_DISTANCE_OVERSHOOT = 1.3
/** 検索で語に寄るときの距離。 */
export const SPACE_FOCUS_DISTANCE = 2.1

/** ドラッグ 1pt あたりの回転量（ラジアン）。 */
export const SPACE_YAW_PER_PX = 0.0062
export const SPACE_PITCH_PER_PX = 0.0062
/** 極でひっくり返らないよう pitch は ±80° 程度で止める。 */
export const SPACE_PITCH_MIN = -1.4
export const SPACE_PITCH_MAX = 1.4
/** 慣性の減衰（既定 0.998 より少しだけ短く滑る）。 */
export const SPACE_DECELERATION = 0.997
/** 端で戻すときのバネ。 */
export const SPACE_CAMERA_SPRING = { damping: 20, stiffness: 200, mass: 0.7 } as const
/** 初期の見下ろし角。 */
export const SPACE_PITCH_INITIAL = 0.3

// ── 投影 ────────────────────────────────────────────────────
/**
 * 世界座標 1.0 が画面上で何 pt になるか（画面の短辺に対する比）。
 * `pos3` は各軸 [-1, 1] に正規化されている（SPEC §9.1）。
 */
export const SPACE_WORLD_SCALE = 0.58
/** これより手前（depth が小さい）の点は描かない。 */
export const SPACE_NEAR_PLANE = 0.25
/** `pos3` の取りうる最大の長さ（各軸 ±1 の立方体の対角）。深度の正規化に使う。 */
export const SPACE_WORLD_RADIUS = Math.sqrt(3)

/** 深度によるサイズのフォールオフ（SPEC §9.2）。 */
export const SPACE_DEPTH_SIZE_MIN = 0.6
export const SPACE_DEPTH_SIZE_MAX = 1.4
/** 深度によるアルファのフォールオフ（SPEC §9.2）。 */
export const SPACE_DEPTH_ALPHA_MIN = 0.35
export const SPACE_DEPTH_ALPHA_MAX = 1

// ── 点 ──────────────────────────────────────────────────────
/** Atlas に貼る白いドットのテクスチャの一辺（px）。 */
export const SPACE_DOT_TEXTURE_SIZE = 32
/** 所持語の基準サイズ（pt）。 */
export const SPACE_DOT_OWNED_PT = 13
/** ゴースト点（未取得語）の基準サイズ（pt）。 */
export const SPACE_DOT_GHOST_PT = 5
/** 今日のゴールの基準サイズ（pt）。金の輪をさらに重ねる。 */
export const SPACE_DOT_GOAL_PT = 18
/** ゴースト点の色と濃さ。 */
export const SPACE_GHOST_COLOR = '#8A8A96'
export const SPACE_GHOST_ALPHA = 0.55
/** 選択中の語を示す輪の太さ。 */
export const SPACE_RING_WIDTH = 2
/** ゴールの金の輪の半径（基準サイズに対する比）。 */
export const SPACE_GOAL_RING_SCALE = 1.9

// ── 経路 ────────────────────────────────────────────────────
/** クリア済みゲームの経路の線の太さ。 */
export const SPACE_PATH_WIDTH = 1.2
export const SPACE_PATH_ALPHA = 0.35
/** 強調中の経路。 */
export const SPACE_PATH_HIGHLIGHT_WIDTH = 2.4
export const SPACE_PATH_HIGHLIGHT_ALPHA = 0.9
/** 一度に描く経路の上限（多すぎると線だらけになる）。 */
export const SPACE_PATH_LIMIT = 30

// ── ラベル ──────────────────────────────────────────────────
/** 和文ラベルの位置を JS 側に送り直す間隔。短くすると滑らかだが JS が忙しくなる。 */
export const SPACE_LABEL_UPDATE_MS = 110
/** ラベル 1 枚の最大幅。 */
export const SPACE_LABEL_MAX_WIDTH = 104
/** 点の中心からラベルまでの縦のずれ。 */
export const SPACE_LABEL_OFFSET_Y = 10
/** 画面の外側この pt までは描く（端で急に消えないように）。 */
export const SPACE_LABEL_MARGIN = 24

// ── 検索・シート ────────────────────────────────────────────
/** 検索欄のサジェスト件数。 */
export const SPACE_SEARCH_LIMIT = 8
/** ボトムシートの最大高さ（画面比）。 */
export const SPACE_SHEET_MAX_HEIGHT_RATIO = 0.55
/** 検索欄の高さ。 */
export const SPACE_SEARCH_HEIGHT = 44
