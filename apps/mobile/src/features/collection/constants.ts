/**
 * 図鑑（3D ベクトル空間）の定数。
 *
 * ゲーム・データに関わる値は **packages/contracts**：
 * `SPACE_FOCAL` / `SPACE_GHOST_COUNT` / `SPACE_LABEL_LIMIT` / `SPACE_TAP_RADIUS`。
 * ここに置くのは「描画とカメラの手触り」だけ。
 * contracts に昇格させるべき値（深度フォールオフの帯など）は親に報告すること。
 */

import { SPACE_FOCAL } from '@coto2ba/contracts'
// 図鑑は宇宙なので、ライトモードでも暗いまま（意図的な例外、SPEC §4.3）。
// 線の色はダーク固定の tier パレットから取る。
import { tierPalettes } from '../../theme/tiers'

// ── カメラ ──────────────────────────────────────────────────
/**
 * 注視点からカメラまでの距離。小さいほど寄る。
 * カメラは **世界の原点ではなく `target`（選択中の経路の中心）のまわりを回る**。
 * 回しても主役が画面の真ん中から逃げないので、迷子になりにくい。
 */
export const SPACE_DISTANCE_DEFAULT = 3.2
/**
 * 短い経路にぴったり寄れるところまで許す。
 * 実データの軌跡は**空間全体に対してとても小さい**（半径 0.15 ほど）ので、
 * 以前の 1.5 のままだとどの経路も「画面中央の小さな点の塊」になる。
 */
export const SPACE_DISTANCE_MIN = 0.4
/** これ以上引くと経路が点にしか見えない。 */
export const SPACE_DISTANCE_MAX = 6
/** ピンチ中だけ許す行き過ぎ（離すとバネで戻る）。 */
export const SPACE_DISTANCE_OVERSHOOT = 1.3
/** 検索・近傍で語に寄るときの距離。 */
export const SPACE_FOCUS_DISTANCE = 2.1

/** ドラッグ 1pt あたりの回転量（ラジアン）。 */
export const SPACE_YAW_PER_PX = 0.0062
export const SPACE_PITCH_PER_PX = 0.0062
/**
 * 回転量に掛ける倍率の範囲（`SPACE_DISTANCE_DEFAULT / distance` を丸める）。
 * 寄るほど速く回す補正は残すが、**経路にぴったり寄せたときに暴れないよう**に
 * 上下限を付ける（距離 0.6 では素の倍率が 5 倍を超えて、指が触れた瞬間に
 * 宇宙が吹っ飛ぶ ＝ 迷子になる）。
 */
export const SPACE_ROTATE_GAIN_MIN = 0.7
export const SPACE_ROTATE_GAIN_MAX = 1.6
/**
 * 真上・真下を向くと方向感覚を失うので pitch は ±66° で止める。
 * （±80° まで許していたときは、ほぼ真上から見下ろして戻れなくなることがあった）
 */
export const SPACE_PITCH_MIN = -1.15
export const SPACE_PITCH_MAX = 1.15
/** 慣性の減衰（既定 0.998 より少しだけ短く滑る）。 */
export const SPACE_DECELERATION = 0.997
/** 端で戻すときのバネ。 */
export const SPACE_CAMERA_SPRING = { damping: 20, stiffness: 200, mass: 0.7 } as const
/** 初期の見下ろし角。 */
export const SPACE_PITCH_INITIAL = 0.3
/** 経路を切り替えたときにカメラが寄る時間（初回表示は待たせずに即座に置く）。 */
export const SPACE_FRAME_DURATION_MS = 420

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

// ── 経路のフレーミング ──────────────────────────────────────
/**
 * 画面の短辺いっぱいに写る画角。**投影と同じ値から導く**
 * （`projection.ts` は `screen = center + x * (SPACE_FOCAL / depth) * min(w, h) * SPACE_WORLD_SCALE`
 * なので、半径 r が短辺の半分に収まる距離は `r / tan(fov / 2)`）。
 * ここを手打ちの定数にすると投影と食い違って「収めたのにはみ出す」ことになる。
 */
export const SPACE_FRAMING_FOV = 2 * Math.atan(1 / (2 * SPACE_FOCAL * SPACE_WORLD_SCALE))
/** 経路の外側に取る余白（1.0 で短辺ぴったり）。ラベルが画面外に出ないぶん。 */
export const SPACE_FRAMING_MARGIN = 1.45
/** 1 点だけの経路（半径 0）でもこれ以上は寄らない。カメラがめり込む。 */
export const SPACE_FRAMING_DISTANCE_MIN = 0.45
/**
 * 経路のいちばん手前の節と、カメラの間に必ず空ける距離。
 * 画角だけで決めると、半径の小さい経路では手前側の節が near plane
 * （`SPACE_NEAR_PLANE` = 0.25）の向こうに入って**線が途切れる**。
 *
 * 幾何的に要るのは near plane ぶんだけなので、そのすぐ外側に置く。
 * ここを大きくすると、実データ（半径 0.15 ほど）では**この値だけで距離が決まり**、
 * 画角も余白も効かなくなって軌跡が小さく写る。
 */
export const SPACE_FRAMING_NEAR_GAP = 0.3
/**
 * 経路が 1 本も無いときに、宇宙そのものを画面に収めるために使う標本数。
 * `yawPitchToFace` が総当たりで 2 点を選ぶので、全点は渡さない。
 */
export const SPACE_OVERVIEW_SAMPLE = 64
/**
 * フレーミングでわずかに見下ろす角。
 * 0 にすると経路がぴったり画面と平行になり、奥行きのある宇宙に見えない。
 */
export const SPACE_FRAMING_PITCH_TILT = 0.18

// ── 点 ──────────────────────────────────────────────────────
/** Atlas に貼る白いドットのテクスチャの一辺（px）。 */
export const SPACE_DOT_TEXTURE_SIZE = 32
/** 所持語の基準サイズ（pt）。 */
export const SPACE_DOT_OWNED_PT = 13
/**
 * ゴースト点（未取得語）の基準サイズ（pt）。
 * **背景に降格させてある。** 主役は自分の軌跡で、ここは「宇宙がそこにある」ことの
 * 気配だけを担う（大きいと経路が点群に埋もれる）。
 */
export const SPACE_DOT_GHOST_PT = 3.4
/** 今日のゴールの基準サイズ（pt）。金の輪をさらに重ねる。 */
export const SPACE_DOT_GOAL_PT = 18
/** ゴースト点の色と濃さ。 */
export const SPACE_GHOST_COLOR = '#8A8A96'
export const SPACE_GHOST_ALPHA = 0.34
/** 選択中の語を示す輪の太さと大きさ（基準サイズに対する比）。 */
export const SPACE_RING_WIDTH = 2
export const SPACE_SELECTED_RING_SCALE = 1.8
/** ゴールの金の輪の半径（基準サイズに対する比）。 */
export const SPACE_GOAL_RING_SCALE = 1.9

// ── 経路（この画面の主役）────────────────────────────────────
/**
 * 軌跡の線の色。**結果画面のクリア演出と同じ色を使う**
 * （同じ「意味空間を歩いた」という現象を、同じ絵で見せるため）。
 * 灰（スタート）から金（到達）へ。歩くほど温まる、という tier の物語に合わせる。
 */
export const SPACE_TRAIL_COLOR_START = tierPalettes.mono.accent
export const SPACE_TRAIL_COLOR_END = tierPalettes.gold.accent

/** 選んでいない経路の線（背景側）。 */
export const SPACE_PATH_WIDTH = 1.1
export const SPACE_PATH_ALPHA = 0.16
/** 選択中の経路の線（主役）。太いこと自体が「これが軌跡だ」の合図。 */
export const SPACE_PATH_ACTIVE_WIDTH = 3.2
/** 主役の線の下に敷く発光。星座のように光らせる。 */
export const SPACE_PATH_GLOW_WIDTH = 10
export const SPACE_PATH_GLOW_ALPHA = 0.4
export const SPACE_PATH_GLOW_BLUR = 7
/** 節（各手）に打つ輪。点の基準サイズに対する比。 */
export const SPACE_PATH_NODE_RING_SCALE = 1.5
export const SPACE_PATH_NODE_RING_WIDTH = 1.6
export const SPACE_PATH_NODE_RING_ALPHA = 0.75
/** スタートと到達点だけの大きい輪。 */
export const SPACE_PATH_END_RING_SCALE = 2.5
export const SPACE_PATH_END_RING_WIDTH = 2.2
/** 一度に描く経路の上限（多すぎると線だらけになる）。 */
export const SPACE_PATH_LIMIT = 30

// ── 主役と背景の重みづけ（`paths.ts` の buildEmphasis）──────
/** 選択中の経路に乗っている語を大きく見せる倍率。 */
export const SPACE_EMPHASIS_PATH_SIZE = 1.45
/** 経路を選んでいるときの、経路外の所持語の濃さ。 */
export const SPACE_EMPHASIS_OFF_PATH_ALPHA = 0.4
/** 経路を選んでいるときのゴースト点の濃さの倍率（さらに背景へ沈める）。 */
export const SPACE_EMPHASIS_GHOST_ACTIVE = 0.6
/**
 * 経路を選んでいないときのゴースト点の濃さの倍率。
 * 1 より大きい：主役が居ない画面を真っ暗にしないため、少しだけ強く出す。
 */
export const SPACE_EMPHASIS_GHOST_IDLE = 1.35

// ── ゴールの輪 ──────────────────────────────────────────────
/** 今日のゴールを囲む金の輪の太さ。 */
export const SPACE_GOAL_RING_WIDTH = 2.4

// ── ラベル ──────────────────────────────────────────────────
/** 和文ラベルの位置を JS 側に送り直す間隔。短くすると滑らかだが JS が忙しくなる。 */
export const SPACE_LABEL_UPDATE_MS = 110
/** ラベル 1 枚の最大幅。 */
export const SPACE_LABEL_MAX_WIDTH = 104
/** 点の中心からラベルまでの縦のずれ。 */
export const SPACE_LABEL_OFFSET_Y = 10
/** 画面の外側この pt までは描く（端で急に消えないように）。 */
export const SPACE_LABEL_MARGIN = 24
/**
 * 選択中の経路の節のラベルの、いちばん薄いときの濃さ。
 * 主役なので、奥に回っても読めるところで止める。
 */
export const SPACE_PATH_LABEL_MIN_OPACITY = 0.55
/**
 * 節のラベルが重なったときに下へずらす段の高さと、段数の上限。
 * **実データで必要になった**：「広角レンズ → レンズ」のように 2 手が
 * ほとんど同じ場所に来ると、語と手数が完全に重なって読めなくなる。
 *
 * 高さは**ラベル 1 枚ぶん**（語 `typography.body` の行 23 + 余白 4 + 手数
 * `typography.label` の行 18）。これより小さいと、ずらしたのにまだ重なる。
 */
export const SPACE_LABEL_STACK_STEP = 45
export const SPACE_LABEL_STACK_MAX = 3
/**
 * ラベルの幅の見積もりに使う 1 文字ぶんの幅（和文は全角なのでほぼ字送り＝字幅）。
 * 固定幅で衝突を見ると、**十分離れている短い語まで段下げ**されてしまう。
 * `typography.body` / `typography.label` の fontSize に合わせること。
 */
export const SPACE_LABEL_WORD_CHAR_WIDTH = 17
export const SPACE_LABEL_STEP_CHAR_WIDTH = 13

// ── タップ ──────────────────────────────────────────────────
/**
 * タップと認めるまでに指が動いてよい距離（pt）。
 * RNGH の既定は「無制限」なので、これを付けないと宇宙を回すフリックでも
 * 指を離した位置の近くの語が開いてしまう。
 */
export const SPACE_TAP_MAX_DISTANCE = 10
/** タップと認める最大の長さ（ms）。RNGH の既定 500ms より短くして流し見と分ける。 */
export const SPACE_TAP_MAX_DURATION_MS = 250
/**
 * 慣性でまだ流れている、と見なす時間（ms）。
 * カメラが動いてからこの時間内に触ったタップは「止める」操作として扱い、
 * 語のシートは開かない（回している最中に開かないことを優先する）。
 */
export const SPACE_TAP_SETTLE_MS = 140

// ── 検索・シート ────────────────────────────────────────────
/** 検索欄のサジェスト件数。 */
export const SPACE_SEARCH_LIMIT = 8
/** ボトムシートの最大高さ（画面比）。 */
export const SPACE_SHEET_MAX_HEIGHT_RATIO = 0.55
/** 検索欄の高さ。 */
export const SPACE_SEARCH_HEIGHT = 44
/** 上に浮かべる検索ボタン（丸）の一辺。最小タップ領域に合わせる。 */
export const SPACE_SEARCH_BUTTON_SIZE = 44
