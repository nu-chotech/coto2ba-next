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
/** 中央で溶けた光の玉の直径。 */
export const MIX_CORE_SIZE = 96
/** 演出の舞台の最小高さ（語が長くても跳ねないように）。 */
export const MIX_STAGE_MIN_HEIGHT = 180
/** 中央へ寄るときに 2 語が縮む量。 */
export const MIX_WORD_SHRINK = 0.25
/** 光の玉が脈打つ振幅。 */
export const MIX_CORE_PULSE = 0.18
/** 結果の語が現れるときの初期スケール。 */
export const MIX_RESULT_FROM_SCALE = 0.86

/** 語が入れ替わるとき、いったん縮む倍率。 */
export const WORD_FADE_SCALE = 0.92
/** 主役の語の行の高さ（フォントサイズに対する比）。 */
export const HERO_LINE_HEIGHT_RATIO = 1.18

// ── ratio の回転ホイール（MixWheel）────────────────────────
/**
 * ホイールの外径。
 *
 * ゲーム画面には主役の語・ランク・入力欄も載るので、**画面の主役を奪わない大きさ**にする。
 * 一方で指 1 本で回すものなので、半径が小さいと同じ指の移動量に対して角度が急になり、
 * 段を飛ばす。この 2 つの折り合いがこの値。
 */
export const WHEEL_SIZE = 216
/** ホイールが使う扇の角度（270°）。下の 90° は空けて、そこに両端の意味を書く。 */
export const WHEEL_SWEEP = Math.PI * 1.5
/** 外周の輪の太さ。 */
export const WHEEL_RING_WIDTH = 10
/** 外周の輪を外枠からどれだけ内側に置くか。**つまみがはみ出して切れないための余白**。 */
export const WHEEL_RING_INSET = 12
/** 中央の盤（比率を読む窓）の直径。 */
export const WHEEL_HUB_SIZE = 116
/** 目盛りの長さと太さ。 */
export const WHEEL_TICK_LENGTH = 10
export const WHEEL_TICK_WIDTH = 2
/** 今の段の目盛りだけ、長く太くする。 */
export const WHEEL_TICK_ACTIVE_LENGTH = 16
export const WHEEL_TICK_ACTIVE_WIDTH = 3
/** 目盛りの外端を外枠からどれだけ内側に置くか（輪の内側に並ぶ）。 */
export const WHEEL_TICK_INSET = WHEEL_RING_INSET + WHEEL_RING_WIDTH + 6
/** つまみの直径。最小タップ領域は輪全体で稼ぐので、見た目はこの大きさでよい。 */
export const WHEEL_KNOB_SIZE = 24
/** 回している間のつまみの拡大率。 */
export const WHEEL_KNOB_ACTIVE_SCALE = 1.16
/**
 * 指を離したあと、払った勢いをどれだけ先まで送るか（秒）。
 *
 * **段は 8 つしか無いので、ここを大きくすると端まで飛んでしまう。**
 * ゆっくり回したぶんには行き過ぎず、勢いよく払ったときだけ隣の段まで行く量
 * （Web で実測: 250°/秒 で 1 段ぶん、100°/秒 では行き過ぎない）。
 */
export const WHEEL_INERTIA_SEC = 0.08

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
/** 注意文の行。**常にこの高さを確保する**（出たり消えたりで下の UI をずらさない）。
 *  typography.label の lineHeight と同じ値。 */
export const INPUT_ERROR_ROW_HEIGHT = 18
/** 辞書外の警告を出すまでの待ち時間。
 *  IME の変換途中（1 打ごと）に判定すると警告が点滅するので、
 *  **入力が止まってから**判定する。短くすると打鍵中に出てしまう。 */
export const INPUT_OOV_DEBOUNCE_MS = 400

// ── ヒントシート ────────────────────────────────────────────
/** シートの最大高さ（画面比）。 */
export const HINT_SHEET_MAX_HEIGHT_RATIO = 0.62
/** ヒント 1 件ぶんの高さ（ローディング枠にも使う）。 */
export const HINT_SLOT_HEIGHT = 48

// ── ボタン ──────────────────────────────────────────────────
export const BUTTON_PRESSED_SCALE = 0.97
/** 押せるものの最小の当たり判定（Apple Human Interface Guidelines）。 */
export const MIN_TAP_SIZE = 44

// ── アイコン ────────────────────────────────────────────────
/** アイコン名の台帳は `components/symbols.ts`。寸法は `theme/tokens.ts` の `iconSize`。 */

// ── ロゴ ────────────────────────────────────────────────────
/**
 * ワードマークの縦横比（2714 × 1060）。**横長なので高さを指定して幅を追従させる。**
 * 正方形の枠に入れると余白だらけになる。
 * 将来 "Next" を足したものに差し替わる予定。同じファイル名で上書きすれば差し替わる。
 * 比率が変わったら `tests/logo.test.ts` が落ちるので、そのときはここを直す。
 */
export const LOGO_ASPECT_RATIO = 2714 / 1060
/** ロビーのヘッダに置くときの高さ。 */
export const LOGO_HEIGHT_HEADER = 40

// ── tier の印（TierDot / TierPath）──────────────────────────
/** 文字の横に置く丸の直径。 */
export const TIER_DOT_SIZE = 8
/** 経路の 1 手ぶんのマスの一辺。 */
export const TIER_CELL_SIZE = 14
export const TIER_CELL_RADIUS = 4
export const TIER_CELL_GAP = 5

// ── 結果画面 ────────────────────────────────────────────────
/** 実績バッジが順番に出てくる間隔。 */
export const ACHIEVEMENT_STAGGER_MS = 120

// ── 背景 ────────────────────────────────────────────────────
/** tier が切り替わるときの背景の補間時間。 */
export const TIER_TRANSITION_MS = 680
/** 背景に重ねる光のにじみの大きさ（画面幅に対する比）。 */
export const TIER_GLOW_SCALE = 1.35
