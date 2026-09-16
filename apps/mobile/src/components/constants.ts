/**
 * コンポーネント専用の定数。
 *
 * ゲームのルールに関わる値は **packages/contracts**、色・余白・タイポは **src/theme**。
 * ここに置くのは「この UI 部品でしか使わない寸法・時間」だけ。
 * contracts に昇格させるべき値を見つけたら親に報告すること。
 */

// ── 混合演出（MixOverlay）──────────────────────────────────
/** 2 語が中央に寄って溶けるまで。 */
export const MIX_CONVERGE_MS = 420
/** 溶けた光が脈打つ周期（結果待ちのループ）。 */
export const MIX_PULSE_MS = 700
/** 結果の語が現れる時間。 */
export const MIX_REVEAL_MS = 380
/** 結果を見せてから画面に戻すまでの余韻。 */
export const MIX_HOLD_MS = 420
/** 溶ける前の 2 語の初期オフセット（画面中央からの距離、pt）。 */
export const MIX_WORD_OFFSET = 86

// ── ratio スライダー ────────────────────────────────────────
/** トラックの左右の余白（サムがはみ出さないように）。 */
export const SLIDER_EDGE_PADDING = 18
/** ディテントの目盛りの直径。 */
export const SLIDER_TICK_SIZE = 4
/** サムを押し込んだときの拡大率。 */
export const SLIDER_THUMB_ACTIVE_SCALE = 1.18
/** タップ判定を広げるための当たり判定の高さ。 */
export const SLIDER_HIT_HEIGHT = 44

// ── 温度バー（RankMeter）────────────────────────────────────
export const RANK_METER_HEIGHT = 8
/** バーの伸び縮みにかける時間。 */
export const RANK_METER_DURATION_MS = 520

// ── スケルトン ──────────────────────────────────────────────
export const SKELETON_PULSE_MS = 900
export const SKELETON_MIN_OPACITY = 0.25
export const SKELETON_MAX_OPACITY = 0.55

// ── 履歴チップ ──────────────────────────────────────────────
export const HISTORY_CHIP_MIN_WIDTH = 132
export const HISTORY_STRIP_HEIGHT = 64

// ── 入力欄 ──────────────────────────────────────────────────
/** 候補チップの高さ。 */
export const SUGGEST_CHIP_HEIGHT = 34
/** 入力欄の最大文字数は **付けない**（ARCHITECTURE §5: CJK IME のバグ）。
 *  代わりに送信時にこの長さを超えていたら弾く。 */
export const INPUT_SANITY_MAX_LENGTH = 32

// ── ヒントシート ────────────────────────────────────────────
/** シートの最大高さ（画面比）。 */
export const HINT_SHEET_MAX_HEIGHT_RATIO = 0.62

// ── ボタン ──────────────────────────────────────────────────
export const BUTTON_PRESSED_SCALE = 0.97

// ── 結果画面 ────────────────────────────────────────────────
/** 経路のマス 1 つの文字サイズ。 */
export const PATH_CELL_FONT_SIZE = 26
/** 実績バッジが順番に出てくる間隔。 */
export const ACHIEVEMENT_STAGGER_MS = 120

// ── 背景 ────────────────────────────────────────────────────
/** tier が切り替わるときの背景の補間時間。 */
export const TIER_TRANSITION_MS = 680
/** 背景に重ねる光のにじみの大きさ（画面幅に対する比）。 */
export const TIER_GLOW_SCALE = 1.35
