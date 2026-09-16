/**
 * ゲームの全定数。サーバー・クライアント双方がここだけを参照する。
 * マジックナンバーをコードに書かないこと（SPEC §3 規約）。
 */

// ── 混合比率 ────────────────────────────────────────────────
export const RATIO_MIN = 0.1
export const RATIO_MAX = 0.8
export const RATIO_STEP = 0.1
/** 0.1 〜 0.8 の 8 段階。浮動小数の誤差を避けるため整数から生成する。 */
export const RATIOS: readonly number[] = Array.from(
  { length: Math.round((RATIO_MAX - RATIO_MIN) / RATIO_STEP) + 1 },
  (_, i) => Math.round((RATIO_MIN + i * RATIO_STEP) * 10) / 10,
)
export const RATIO_STEP_COUNT = RATIOS.length
export const RATIO_DEFAULT = 0.5

/** 浮動小数の表現誤差（0.30000000000000004 のような値）を吸収する許容差。 */
const RATIO_EPSILON = 1e-6

/**
 * ratio が 8 段階のいずれかであることを確認する。違えば null（サーバーは 422）。
 * **丸めない。** 0.35 を 0.4 に丸めるとプレイヤーの意図を勝手に変えることになる。
 */
export function normalizeRatio(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const match = RATIOS.find((r) => Math.abs(r - value) < RATIO_EPSILON)
  return match ?? null
}

/** ratio のインデックス（スライダー用）。 */
export function ratioToIndex(ratio: number): number {
  const i = RATIOS.indexOf(Math.round(ratio * 10) / 10)
  return i < 0 ? RATIOS.indexOf(RATIO_DEFAULT) : i
}

export function indexToRatio(index: number): number {
  const clamped = Math.min(Math.max(Math.round(index), 0), RATIOS.length - 1)
  return RATIOS[clamped] ?? RATIO_DEFAULT
}

// ── クリア条件・手数 ────────────────────────────────────────
/** rank <= CLEAR_RANK でクリア。 */
export const CLEAR_RANK = 10
/** MAX_MOVES 手を打ち切ったらギブアップ扱い。 */
export const MAX_MOVES = 20
/** result === goal（rank 0）は完全錬成。 */
export const PERFECT_RANK = 0
/**
 * ゴールに近すぎる語は混ぜる語として使えない（ゴールから見た近傍 N 語）。
 *
 * SPEC §5.3-4 はゴール語そのものしか禁止していないが、それだと
 * 「温泉」に対して「温泉旅館」を打つだけで 1 手クリアできてしまい、
 * デイリーのランキング（手数順）が成立しない。近傍 N 語だけを塞ぐことで
 * 通常のプレイには影響を与えずに最短手の抜け道を消す。
 * 0 にすると無効化される。詳細は docs/QUESTIONS.md。
 */
export const GOAL_NEIGHBOR_BAN = 12

// ── ヒント ──────────────────────────────────────────────────
export const HINT_COUNT = 6
/** v_hint = (1 - HINT_RATIO) * v_current + HINT_RATIO * v_goal */
export const HINT_RATIO = 0.2
/** ヒント候補を取る近傍数（ここから除外して先頭 HINT_COUNT 件）。 */
export const HINT_CANDIDATE_COUNT = 30

// ── 演出帯（tier）────────────────────────────────────────────
export const TIERS = [
  { id: 'gold', maxRank: 10 },
  { id: 'cosmos', maxRank: 300 },
  { id: 'color', maxRank: 3000 },
  { id: 'mono', maxRank: Number.POSITIVE_INFINITY },
] as const

export type TierId = (typeof TIERS)[number]['id']
export const TIER_IDS = TIERS.map((t) => t.id) as readonly TierId[]

// ── デイリー ────────────────────────────────────────────────
export const DAILY_TZ = 'Asia/Tokyo'
/** 事前生成する日数。 */
export const DAILY_SCHEDULE_DAYS = 120
/** 曜日 → 難易度（0 = 日曜）。SPEC §6.4: 月〜金 Normal / 土 Hard / 日 Easy */
export const DAILY_DIFFICULTY_BY_WEEKDAY = [
  'easy',
  'normal',
  'normal',
  'normal',
  'normal',
  'normal',
  'hard',
] as const

// ── スタート語 ──────────────────────────────────────────────
/** ゴールから見たランクがこの範囲に入る語をスタートにする。 */
export const START_RANK_RANGE = [3000, 30000] as const
/** スタート語の頻度順位上限。 */
export const START_MAX_FREQ_RANK = 20000

// ── 語彙 ────────────────────────────────────────────────────
/** 入力語彙に入れる頻度順位の上限（SPEC §4.2）。 */
export const INPUT_MAX_FREQ_RANK = 300_000
/** 出力語彙の頻度順位上限。これ以降は地名・人名の長い尾で混合結果の質が落ちる。 */
export const OUTPUT_MAX_FREQ_RANK = 180_000
/** 入力語彙のサイズ（02_prune の実測値）。 */
export const N_INPUT = 208_707
/**
 * 出力語彙のサイズ。heat の対数正規化に使う。
 * パイプライン（02_prune）の実測値でここを更新すること。
 */
export const N_OUTPUT = 99_805

// ── 難易度 ──────────────────────────────────────────────────
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]
/**
 * 難易度ごとのボット手数レンジ。
 * SPEC §6.2 は easy<=4 だが、実測で easy が候補の 0.5% しか出ず目標数に到達しないため
 * easy<=5 に緩めてある（docs/QUESTIONS.md）。
 */
export const DIFFICULTY_BOT_MOVES = {
  easy: [0, 5],
  normal: [5.01, 7],
  hard: [7.01, 12],
} as const satisfies Record<Difficulty, readonly [number, number]>
export const DIFFICULTY_LABELS_JA = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'むずかしい',
} as const satisfies Record<Difficulty, string>

// ── ゲームのモード・状態 ────────────────────────────────────
export const GAME_MODES = ['daily', 'free'] as const
export type GameMode = (typeof GAME_MODES)[number]
export const GAME_STATUSES = ['playing', 'cleared', 'gave_up'] as const
export type GameStatus = (typeof GAME_STATUSES)[number]
export const ENCOUNTER_SOURCES = ['start', 'result', 'input'] as const
export type EncounterSource = (typeof ENCOUNTER_SOURCES)[number]

// ── ユーザー ────────────────────────────────────────────────
export const DISPLAY_NAME_MIN_LENGTH = 1
export const DISPLAY_NAME_MAX_LENGTH = 12
/** 引き継ぎトークンの有効期間（分）。 */
export const TRANSFER_TOKEN_TTL_MINUTES = 10
export const TRANSFER_TOKEN_LENGTH = 32
/** デバイストークン（自前認証フォールバック）の長さ。 */
export const DEVICE_TOKEN_LENGTH = 48

// ── ランキング ──────────────────────────────────────────────
export const LEADERBOARD_LIMIT = 50

// ── レート制限（SPEC §7.8）──────────────────────────────────
export const RATE_LIMIT_PER_USER_PER_SECOND = 5
export const RATE_LIMIT_GAMES_PER_MINUTE = 10

// ── 演出タイミング ──────────────────────────────────────────
/** API 応答が速くても混合演出は最低これだけ見せる（体感の一貫性）。 */
export const MIX_ANIMATION_MIN_MS = 600
/** ブースモードの無操作タイムアウト。 */
export const BOOTH_IDLE_TIMEOUT_MS = 3 * 60 * 1000

// ── 図鑑 ────────────────────────────────────────────────────
/** 画面に和文ラベルを描く最大数。 */
export const SPACE_LABEL_LIMIT = 40
/** ゴースト点（未取得語）のサンプル数。 */
export const SPACE_GHOST_COUNT = 2000
/** タップ判定半径（pt）。 */
export const SPACE_TAP_RADIUS = 24
/** 透視投影の焦点距離。 */
export const SPACE_FOCAL = 1.5

// ── 入力候補 ────────────────────────────────────────────────
/** 端末側の前方一致サジェスト件数。 */
export const SUGGEST_LIMIT = 5

// ── 表示 ────────────────────────────────────────────────────
/** rank → 温度（0〜1）。rank 0（完全錬成）は 1。 */
export function rankToHeat(rank: number, nOutput: number = N_OUTPUT): number {
  if (rank <= 0) return 1
  const heat = 1 - Math.log10(Math.max(rank, 1)) / Math.log10(nOutput)
  return Math.min(1, Math.max(0, heat))
}

// ── アプリ ──────────────────────────────────────────────────
/** app.json の scheme と一致させること。Better Auth の trustedOrigins に使う。 */
export const APP_SCHEME = 'coto2ba'
/** セッションの有効期間（秒）。匿名アカウントなので長め。 */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 365
/** ベクトルの次元。 */
export const VECTOR_DIM = 200
/** 最近傍を取る候補数。除外後に枯れないよう多めに取る。 */
export const NEAREST_CANDIDATES = 32

// ── 共有 ────────────────────────────────────────────────────
/**
 * 本番 API のベース URL。独自ドメインを張ったらここと Vercel の環境変数、
 * apps/mobile/app.json の extra.apiUrl を同時に差し替えること。
 */
export const API_BASE_URL = 'https://coto2ba-next-api.vercel.app'
export const LANDING_URL = 'https://coto2ba-next.vercel.app'
export const TIER_EMOJI = {
  mono: '⬜',
  color: '🟩',
  cosmos: '🟦',
  gold: '🟨',
} as const satisfies Record<TierId, string>
