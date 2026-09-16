/** 実績判定（SPEC §8.4）。サーバーが唯一の権威。 */
import {
  ACHIEVEMENT_BY_ID,
  type AchievementId,
  CLEAR_RANK,
  MEET_THRESHOLDS,
  STREAK_THRESHOLDS,
  type UnlockedAchievement,
} from '@coto2ba/contracts'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { games, userAchievements, wordEncounters } from '../db/schema'
import { addDays } from '../lib/jst'

/** 「宇宙」帯に入るランクの上限。TIERS の cosmos.maxRank と同じ。 */
const COSMOS_MAX_RANK = 300
/** 「手際」実績の手数。 */
const QUICK_CLEAR_MOVES = 5

export interface AchievementContext {
  userId: string
  gameId: string
  mode: 'daily' | 'free'
  dailyDate: string | null
  status: 'playing' | 'cleared' | 'gave_up'
  rank: number
  perfect: boolean
  moveCount: number
  hintCount: number
}

/** 累計の出会い語数（distinct word）。 */
async function countEncounters(db: Db, userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(DISTINCT word)::int AS n FROM word_encounters WHERE user_id = ${userId}`,
  )
  return Number(rows.rows[0]?.n ?? 0)
}

/** デイリーの連続クリア日数（その日を含む）。 */
async function dailyStreak(db: Db, userId: string, today: string): Promise<number> {
  const rows = await db
    .select({ date: games.dailyDate })
    .from(games)
    .where(and(eq(games.userId, userId), eq(games.status, 'cleared'), eq(games.mode, 'daily')))
  const cleared = new Set(rows.map((r) => r.date).filter((d): d is string => d !== null))
  let streak = 0
  let cursor = today
  while (cleared.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

/** 前日ギブアップ → 当日クリア。 */
async function isComeback(db: Db, userId: string, today: string): Promise<boolean> {
  const yesterday = addDays(today, -1)
  const rows = await db
    .select({ status: games.status })
    .from(games)
    .where(and(eq(games.userId, userId), eq(games.dailyDate, yesterday)))
    .limit(1)
  return rows[0]?.status === 'gave_up'
}

/** 未解除の実績を判定して解除する。解除できたものを返す。 */
export async function evaluateAchievements(
  db: Db,
  ctx: AchievementContext,
): Promise<UnlockedAchievement[]> {
  const existing = await db
    .select({ achievement: userAchievements.achievement })
    .from(userAchievements)
    .where(eq(userAchievements.userId, ctx.userId))
  const already = new Set(existing.map((r) => r.achievement))
  const candidates: AchievementId[] = []

  const add = (id: AchievementId) => {
    if (!already.has(id) && !candidates.includes(id)) candidates.push(id)
  }

  const met = await countEncounters(db, ctx.userId)
  for (const t of MEET_THRESHOLDS) {
    if (met >= t.count) add(t.id)
  }

  if (ctx.rank <= COSMOS_MAX_RANK) add('reach_cosmos')
  if (ctx.rank <= CLEAR_RANK) add('reach_gold')
  if (ctx.perfect) add('perfect')

  if (ctx.status === 'cleared') {
    if (ctx.hintCount === 0) add('no_hint_clear')
    if (ctx.moveCount <= QUICK_CLEAR_MOVES) add('clear_5')

    if (ctx.mode === 'daily' && ctx.dailyDate) {
      const streak = await dailyStreak(db, ctx.userId, ctx.dailyDate)
      for (const t of STREAK_THRESHOLDS) {
        if (streak >= t.days) add(t.id)
      }
      if (await isComeback(db, ctx.userId, ctx.dailyDate)) add('comeback')
    }
  }

  if (candidates.length === 0) return []

  await db
    .insert(userAchievements)
    .values(candidates.map((id) => ({ userId: ctx.userId, achievement: id, gameId: ctx.gameId })))
    .onConflictDoNothing()

  return candidates.map((id) => {
    const def = ACHIEVEMENT_BY_ID[id]
    return { id, title: def.title, description: def.description }
  })
}

/** 語との出会いを記録する。 */
export async function recordEncounters(
  db: Db,
  userId: string,
  gameId: string,
  entries: { word: string; source: 'start' | 'result' | 'input'; rank?: number }[],
): Promise<void> {
  if (entries.length === 0) return
  await db
    .insert(wordEncounters)
    .values(
      entries.map((e) => ({
        userId,
        word: e.word,
        source: e.source,
        firstGameId: gameId,
        firstRank: e.rank ?? null,
        count: 1,
      })),
    )
    .onConflictDoUpdate({
      target: [wordEncounters.userId, wordEncounters.word, wordEncounters.source],
      set: { count: sql`${wordEncounters.count} + 1` },
    })
}
