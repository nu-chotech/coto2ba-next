/** ゲーム側のテーブル定義（SPEC §4.3, §6.6, §7.3）。 */
import type { Hint } from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

export * from './auth-schema'

// ── 語彙とベクトル空間 ──────────────────────────────────────
export const vocab = pgTable(
  'vocab',
  {
    word: text('word').primaryKey(),
    /** 元ファイルの行番号（1 始まり）= 頻度順位 */
    freqRank: integer('freq_rank').notNull(),
    isInput: boolean('is_input').notNull().default(true),
    isOutput: boolean('is_output').notNull().default(false),
    /** ゴールプール候補（名詞-普通名詞のみで構成される語） */
    isCommonNoun: boolean('is_common_noun').notNull().default(false),
    /**
     * モノ・生き物・場所など「絵になる」語か（サ変名詞・連用形名詞を除く）。
     * ゴール語とスタート語の抽選に使う。これが無いと
     * 「促進 / 捜査 / 提唱 / 目指し」ばかりになる。02_prune が判定する。
     */
    isConcrete: boolean('is_concrete').notNull().default(false),
    pos: text('pos'),
    /** 単位長に正規化済みの word2vec ベクトル */
    w2v: halfvec('w2v', { dimensions: 200 }).notNull(),
    /** 図鑑用 3D 座標 [-1,1]^3（出力語彙のみ） */
    pos3: real('pos3').array(),
  },
  (t) => [index('vocab_output_freq').on(t.freqRank).where(sql`${t.isOutput}`)],
)

export const goalPool = pgTable('goal_pool', {
  word: text('word')
    .primaryKey()
    .references(() => vocab.word),
  difficulty: text('difficulty').notNull(),
  botMoves: real('bot_moves').notNull(),
  description: text('description'),
  reviewNeeded: boolean('review_needed').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
})

export const dailyChallenges = pgTable('daily_challenges', {
  /** JST の日付 */
  date: date('date').primaryKey(),
  goal: text('goal')
    .notNull()
    .references(() => goalPool.word),
  start: text('start')
    .notNull()
    .references(() => vocab.word),
  difficulty: text('difficulty').notNull(),
})

/** 表示名の自動生成に使う語（形容詞 / 名詞）。 */
export const nameParts = pgTable('name_parts', {
  word: text('word').primaryKey(),
  kind: text('kind').notNull(),
})

// ── 対戦ルーム（マルチプレイ・SPEC §9）──────────────────────
/**
 * 部屋。ホストが作り、参加者はコードか QR で入る。
 * **お題（goal / start / forbidden_inputs）は部屋で 1 度だけ抽選して全員に配る。**
 * ゲーム本体は既存の `games` をそのまま使い、`room_id` で紐づける。
 *
 * `games` より先に宣言してあるのは、`games.room_id` がここを参照するため。
 */
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 参加コード。大文字英数 4 桁。同時に生きている部屋の中で一意。 */
    code: text('code').notNull(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    difficulty: text('difficulty').notNull(),
    goal: text('goal').notNull(),
    start: text('start').notNull(),
    /** ゴールに近すぎる語。games と同じものを部屋で 1 度だけ計算して配る。 */
    forbiddenInputs: text('forbidden_inputs').array().notNull().default(sql`ARRAY[]::text[]`),
    status: text('status').notNull().default('waiting'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // 終わった部屋のコードは再利用できる。生きている部屋だけ一意にする。
    uniqueIndex('rooms_code_live_uq').on(t.code).where(sql`status <> 'finished'`),
    index('rooms_created_at_idx').on(t.createdAt),
  ],
)

// ── ゲーム ──────────────────────────────────────────────────
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    /** mode=daily のとき JST 日付 */
    dailyDate: date('daily_date'),
    /**
     * mode=room のとき、その手番が属する部屋。
     * `games_user_daily_uq` は daily_date が NULL だと効かないので、
     * 1 ユーザーが複数のルーム戦を持てる。これは意図どおり。
     */
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    difficulty: text('difficulty').notNull(),
    goal: text('goal').notNull(),
    start: text('start').notNull(),
    current: text('current').notNull(),
    currentRank: integer('current_rank').notNull(),
    moveCount: integer('move_count').notNull().default(0),
    hintCount: integer('hint_count').notNull().default(0),
    status: text('status').notNull().default('playing'),
    perfect: boolean('perfect').notNull().default(false),
    /**
     * ゴールに近すぎて「混ぜる語」として使えない語（ゲーム作成時に 1 度だけ計算）。
     * 毎手ランクを引くと 90ms かかるので、作成時に近傍を取って配列で持つ。
     */
    forbiddenInputs: text('forbidden_inputs').array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [
    // デイリーは 1 ユーザー 1 日 1 回
    uniqueIndex('games_user_daily_uq').on(t.userId, t.dailyDate),
    // 並び順（SPEC §5.8: ヒント数 → 手数 → クリア時刻）に合わせる。
    index('games_daily_leaderboard')
      .on(t.dailyDate, t.hintCount, t.moveCount, t.clearedAt)
      .where(sql`${t.status} = 'cleared'`),
    index('games_user_created').on(t.userId, t.createdAt),
  ],
)

export const moves = pgTable(
  'moves',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    inputWord: text('input_word').notNull(),
    ratio: real('ratio').notNull(),
    result: text('result').notNull(),
    rank: integer('rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seq] })],
)

/**
 * 部屋の参加者。開始時に 1 人 1 つ `games` を作って `game_id` に持つ。
 * `finished_at` はサーバーが埋める（**勝敗の権威はここ**）。
 */
export const roomPlayers = pgTable(
  'room_players',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
)

// ── キャッシュ ──────────────────────────────────────────────
export const calcCache = pgTable(
  'calc_cache',
  {
    goal: text('goal').notNull(),
    current: text('current').notNull(),
    input: text('input').notNull(),
    ratio: real('ratio').notNull(),
    result: text('result').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [primaryKey({ columns: [t.goal, t.current, t.input, t.ratio] })],
)

export const hintCache = pgTable(
  'hint_cache',
  {
    goal: text('goal').notNull(),
    current: text('current').notNull(),
    /**
     * `{ word, ratio }[]`（`@coto2ba/contracts` の `Hint`）。
     * 語だけでは「どう混ぜるか」が落ちるので text[] から jsonb に変えた（0004）。
     */
    hints: jsonb('hints').$type<Hint[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.goal, t.current] })],
)

export const wordDescriptions = pgTable('word_descriptions', {
  word: text('word').primaryKey(),
  text: text('text').notNull(),
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
})

// ── ユーザーの記録 ──────────────────────────────────────────
export const wordEncounters = pgTable(
  'word_encounters',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    source: text('source').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    firstGameId: uuid('first_game_id'),
    /** 初遭遇時の rank（図鑑の色に使う） */
    firstRank: integer('first_rank'),
    count: integer('count').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.word, t.source] })],
)

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    achievement: text('achievement').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
    gameId: uuid('game_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievement] })],
)

export const transferTokens = pgTable('transfer_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

/**
 * Better Auth を通さない端末トークン（ブースモードのフォールバックと、
 * Better Auth が Expo Go で詰まった場合の避難路）。SPEC §7.4。
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    meta: jsonb('meta').notNull().default({}),
  },
  (t) => [index('device_tokens_user').on(t.userId)],
)
