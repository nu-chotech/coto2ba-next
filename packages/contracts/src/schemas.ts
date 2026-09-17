import { z } from 'zod'
import { ACHIEVEMENT_IDS } from './achievements'
import {
  DIFFICULTIES,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  ENCOUNTER_SOURCES,
  GAME_MODES,
  GAME_STATUSES,
  normalizeRatio,
  RATIOS,
  TIER_IDS,
} from './constants'
import { ERROR_CODES } from './errors'

// ── 基本型 ──────────────────────────────────────────────────
export const wordSchema = z.string().min(1).max(64)
export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
export const difficultySchema = z.enum(DIFFICULTIES)
export const gameModeSchema = z.enum(GAME_MODES)
export const gameStatusSchema = z.enum(GAME_STATUSES)
export const tierSchema = z.enum(TIER_IDS)
export const encounterSourceSchema = z.enum(ENCOUNTER_SOURCES)
export const achievementIdSchema = z.enum(ACHIEVEMENT_IDS)
export const errorCodeSchema = z.enum(ERROR_CODES)

/** 8 段階のいずれか。丸めずに一致判定する（constants.normalizeRatio と同じ規則）。 */
export const ratioSchema = z
  .number()
  .refine((v) => normalizeRatio(v) !== null, {
    message: `ratio must be one of ${RATIOS.join(', ')}`,
  })
  .transform((v) => normalizeRatio(v) as number)

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
})

// ── ユーザー ────────────────────────────────────────────────
export const userStatsSchema = z.object({
  games_played: z.number().int().nonnegative(),
  games_cleared: z.number().int().nonnegative(),
  daily_streak: z.number().int().nonnegative(),
  words_met: z.number().int().nonnegative(),
  perfect_count: z.number().int().nonnegative(),
})

/**
 * フリーモードの自己ベスト 1 件。
 *
 * **手数だけでは記録にならない。** ヒント 1 回で出した「1 手」が永久に残り、
 * 以後どれだけ真面目に遊んでも更新できなくなるため。良さの基準はランキングと同じ
 * **(ヒント数, 手数) の辞書順**（SPEC §5.7 / §5.8）。
 */
export const freeBestSchema = z.object({
  moves: z.number().int().positive(),
  hints: z.number().int().nonnegative(),
})

export const meResponseSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  booth: z.boolean(),
  // Zod 4 の z.record(enum, …) は **列挙キーの網羅を要求する**。
  // best_free_moves は新規ユーザーだと {} なので、partialRecord でないと
  // /api/me のレスポンスが常に検証に落ちる（実際に起きた）。
  best_free_moves: z.partialRecord(difficultySchema, freeBestSchema),
  stats: userStatsSchema,
})

export const patchMeRequestSchema = z
  .object({
    display_name: z.string().min(DISPLAY_NAME_MIN_LENGTH).max(DISPLAY_NAME_MAX_LENGTH).optional(),
    booth: z.boolean().optional(),
  })
  .refine((v) => v.display_name !== undefined || v.booth !== undefined, {
    message: 'at least one field required',
  })

// ── 手（move）────────────────────────────────────────────────
export const moveSchema = z.object({
  seq: z.number().int().positive(),
  input_word: wordSchema,
  ratio: z.number(),
  result: wordSchema,
  rank: z.number().int().nonnegative(),
  tier: tierSchema,
  created_at: z.string(),
})

export const moveRequestSchema = z.object({
  input_word: wordSchema,
  ratio: ratioSchema,
})

export const unlockedAchievementSchema = z.object({
  id: achievementIdSchema,
  title: z.string(),
  description: z.string(),
})

export const moveResponseSchema = z.object({
  result: wordSchema,
  rank: z.number().int().nonnegative(),
  tier: tierSchema,
  prev_rank: z.number().int().nonnegative(),
  prev_tier: tierSchema,
  move_count: z.number().int().nonnegative(),
  hint_count: z.number().int().nonnegative(),
  status: gameStatusSchema,
  perfect: z.boolean(),
  unlocked_achievements: z.array(unlockedAchievementSchema),
})

// ── ゲーム ──────────────────────────────────────────────────
export const gameSchema = z.object({
  id: z.string(),
  mode: gameModeSchema,
  daily_date: dateStringSchema.nullable(),
  difficulty: difficultySchema,
  goal: wordSchema,
  goal_description: z.string().nullable(),
  start: wordSchema,
  current: wordSchema,
  current_rank: z.number().int().nonnegative(),
  move_count: z.number().int().nonnegative(),
  hint_count: z.number().int().nonnegative(),
  status: gameStatusSchema,
  perfect: z.boolean(),
  created_at: z.string(),
  cleared_at: z.string().nullable(),
})

export const gameDetailSchema = gameSchema.extend({
  moves: z.array(moveSchema),
})

export const createGameRequestSchema = z.object({
  mode: gameModeSchema,
  difficulty: difficultySchema.optional(),
})

/**
 * ヒントは「語」ではなく「**その語をどの比率で混ぜるか**」まで含めた 1 つの提案。
 * 比率が無いとプレイヤーは自分で探すことになり、提案どおりの結果にならない。
 */
export const hintSchema = z.object({
  word: wordSchema,
  ratio: ratioSchema,
})

export const hintResponseSchema = z.object({
  // 検証を通った候補が無ければ空になりうる。効かない語で埋めない（SPEC §3.3）。
  hints: z.array(hintSchema),
  hint_count: z.number().int().nonnegative(),
})

// ── デイリー ────────────────────────────────────────────────
export const dailyResponseSchema = z.object({
  date: dateStringSchema,
  difficulty: difficultySchema,
  goal: wordSchema,
  description: z.string().nullable(),
  start: wordSchema,
  my_game: gameSchema.nullable(),
})

// ── ランキング ──────────────────────────────────────────────
export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  user_id: z.string(),
  display_name: z.string(),
  move_count: z.number().int().nonnegative(),
  hint_count: z.number().int().nonnegative(),
  perfect: z.boolean(),
  cleared_at: z.string(),
  is_me: z.boolean(),
})

export const leaderboardResponseSchema = z.object({
  date: dateStringSchema,
  entries: z.array(leaderboardEntrySchema),
  me: leaderboardEntrySchema.nullable(),
  total: z.number().int().nonnegative(),
})

// ── 語の説明 ────────────────────────────────────────────────
export const wordDescriptionResponseSchema = z.object({
  word: wordSchema,
  text: z.string().nullable(),
  source: z.string().nullable(),
})

export const wordCheckResponseSchema = z.object({ ok: z.boolean() })

// ── 図鑑 ────────────────────────────────────────────────────
export const encounterSchema = z.object({
  word: wordSchema,
  source: encounterSourceSchema,
  first_seen_at: z.string(),
  count: z.number().int().positive(),
  pos3: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  first_tier: tierSchema,
})

export const clearedPathSchema = z.object({
  game_id: z.string(),
  daily_date: dateStringSchema.nullable(),
  words: z.array(wordSchema),
})

export const collectionResponseSchema = z.object({
  encounters: z.array(encounterSchema),
  cleared_paths: z.array(clearedPathSchema),
})

export const neighborSchema = z.object({
  word: wordSchema,
  similarity: z.number(),
})

export const wordDetailResponseSchema = z.object({
  word: wordSchema,
  description: z.string().nullable(),
  pos3: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  neighbors: z.array(neighborSchema),
})

// ── 実績 ────────────────────────────────────────────────────
export const achievementStateSchema = z.object({
  id: achievementIdSchema,
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  unlocked_at: z.string().nullable(),
})

export const achievementsResponseSchema = z.object({
  achievements: z.array(achievementStateSchema),
})

// ── 引き継ぎ ────────────────────────────────────────────────
export const transferCreateResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  url: z.string(),
})

export const transferClaimRequestSchema = z.object({ token: z.string().min(1) })
export const transferClaimResponseSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
})

// ── 端末トークン認証（フォールバック / ブースモード）────────
export const deviceRegisterResponseSchema = z.object({
  token: z.string(),
  user_id: z.string(),
  display_name: z.string(),
})

// ── 型 ──────────────────────────────────────────────────────
export type ApiError = z.infer<typeof apiErrorSchema>
export type UserStats = z.infer<typeof userStatsSchema>
export type FreeBest = z.infer<typeof freeBestSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
export type PatchMeRequest = z.infer<typeof patchMeRequestSchema>
export type Move = z.infer<typeof moveSchema>
export type MoveRequest = z.infer<typeof moveRequestSchema>
export type MoveResponse = z.infer<typeof moveResponseSchema>
export type UnlockedAchievement = z.infer<typeof unlockedAchievementSchema>
export type Game = z.infer<typeof gameSchema>
export type GameDetail = z.infer<typeof gameDetailSchema>
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>
export type Hint = z.infer<typeof hintSchema>
export type HintResponse = z.infer<typeof hintResponseSchema>
export type DailyResponse = z.infer<typeof dailyResponseSchema>
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>
export type WordDescriptionResponse = z.infer<typeof wordDescriptionResponseSchema>
export type Encounter = z.infer<typeof encounterSchema>
export type ClearedPath = z.infer<typeof clearedPathSchema>
export type CollectionResponse = z.infer<typeof collectionResponseSchema>
export type WordDetailResponse = z.infer<typeof wordDetailResponseSchema>
export type AchievementState = z.infer<typeof achievementStateSchema>
export type AchievementsResponse = z.infer<typeof achievementsResponseSchema>
export type TransferCreateResponse = z.infer<typeof transferCreateResponseSchema>
export type TransferClaimRequest = z.infer<typeof transferClaimRequestSchema>
export type TransferClaimResponse = z.infer<typeof transferClaimResponseSchema>
export type DeviceRegisterResponse = z.infer<typeof deviceRegisterResponseSchema>
