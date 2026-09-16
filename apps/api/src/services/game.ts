/**
 * ゲームのオーケストレーション（SPEC §5）。
 * ルール判定そのものは rules.ts（純粋関数）にあり、ここは DB との突き合わせを行う。
 * **クライアントの値は一切信用しない。** goal / current は games 行が唯一の権威。
 */
import {
  CLEAR_RANK,
  type Difficulty,
  type GameDetail,
  type Game as GameDto,
  HINT_CANDIDATE_COUNT,
  HINT_COUNT,
  HINT_RATIO,
  type HintResponse,
  type LeaderboardResponse,
  type MoveResponse,
  START_MAX_FREQ_RANK,
  START_RANK_RANGE,
  sharesKanji,
  tierForRank,
} from '@coto2ba/contracts'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import {
  calcCache,
  dailyChallenges,
  games,
  goalPool,
  hintCache,
  moves,
  user,
  wordDescriptions,
} from '../db/schema'
import { appError } from '../lib/errors'
import { jstDate } from '../lib/jst'
import { pickRandom } from '../lib/random'
import { evaluateAchievements, recordEncounters } from './achievements'
import { applyMove, updateBestFreeMoves, validateMove } from './rules'
import { hintWords, lookupWord, mixAndRank, rankOf, sampleStartWord } from './vector'

const LEADERBOARD_PAGE = 50
/** スタート語の候補を何件引いてから漢字チェックで絞るか。 */
const START_SAMPLE_SIZE = 24

type GameRow = typeof games.$inferSelect

function toDto(row: GameRow, goalDescription: string | null): GameDto {
  return {
    id: row.id,
    mode: row.mode as GameDto['mode'],
    daily_date: row.dailyDate,
    difficulty: row.difficulty as Difficulty,
    goal: row.goal,
    goal_description: goalDescription,
    start: row.start,
    current: row.current,
    current_rank: row.currentRank,
    move_count: row.moveCount,
    hint_count: row.hintCount,
    status: row.status as GameDto['status'],
    perfect: row.perfect,
    created_at: row.createdAt.toISOString(),
    cleared_at: row.clearedAt?.toISOString() ?? null,
  }
}

async function goalDescriptionOf(db: Db, goal: string): Promise<string | null> {
  const rows = await db
    .select({ description: goalPool.description })
    .from(goalPool)
    .where(eq(goalPool.word, goal))
    .limit(1)
  return rows[0]?.description ?? null
}

/** ゴールから見て妥当なスタート語を 1 つ選ぶ（SPEC §6.3）。 */
async function chooseStart(db: Db, goal: string, exclude: string[] = []): Promise<string> {
  const candidates = await sampleStartWord(
    db,
    goal,
    START_MAX_FREQ_RANK,
    START_RANK_RANGE[0],
    START_RANK_RANGE[1],
    START_SAMPLE_SIZE,
  )
  const filtered = candidates.filter((w) => !exclude.includes(w) && !sharesKanji(w, goal))
  const chosen = pickRandom(filtered.length > 0 ? filtered : candidates)
  if (!chosen) throw appError('INTERNAL', 'スタート語の候補が見つかりません')
  return chosen
}

/** フリーモードのゴールを難易度から抽選する。 */
async function chooseGoal(db: Db, difficulty: Difficulty): Promise<string> {
  const rows = await db.execute<{ word: string }>(sql`
    SELECT word FROM goal_pool
    WHERE enabled AND NOT review_needed AND difficulty = ${difficulty}
    ORDER BY random() LIMIT 1
  `)
  const word = rows.rows[0]?.word
  if (!word) throw appError('DAILY_NOT_READY', 'ゴールプールがまだ用意されていません')
  return word
}

async function insertGame(
  db: Db,
  input: {
    userId: string
    mode: 'daily' | 'free'
    dailyDate: string | null
    difficulty: Difficulty
    goal: string
    start: string
  },
): Promise<GameRow> {
  const startRank = (await rankOf(db, input.goal, input.start)) ?? START_RANK_RANGE[1]
  const rows = await db
    .insert(games)
    .values({
      userId: input.userId,
      mode: input.mode,
      dailyDate: input.dailyDate,
      difficulty: input.difficulty,
      goal: input.goal,
      start: input.start,
      current: input.start,
      currentRank: startRank,
    })
    .returning()
  const row = rows[0]
  if (!row) throw appError('INTERNAL', 'ゲームを作成できませんでした')
  await recordEncounters(db, input.userId, row.id, [
    { word: input.start, source: 'start', rank: startRank },
  ])
  return row
}

/** 今日のデイリー課題。無ければ null。 */
export async function todaysChallenge(db: Db, date = jstDate()) {
  const rows = await db
    .select({
      date: dailyChallenges.date,
      goal: dailyChallenges.goal,
      start: dailyChallenges.start,
      difficulty: dailyChallenges.difficulty,
      description: goalPool.description,
    })
    .from(dailyChallenges)
    .leftJoin(goalPool, eq(goalPool.word, dailyChallenges.goal))
    .where(eq(dailyChallenges.date, date))
    .limit(1)
  return rows[0] ?? null
}

/** ユーザーのその日のデイリーゲーム。 */
export async function findDailyGame(db: Db, userId: string, date: string): Promise<GameRow | null> {
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.userId, userId), eq(games.dailyDate, date)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * ゲームを作る。
 * デイリーは 1 日 1 回なので、既にあればそれを返す（新規作成しない）。
 */
export async function createGame(
  db: Db,
  userId: string,
  mode: 'daily' | 'free',
  difficulty?: Difficulty,
): Promise<GameDto> {
  if (mode === 'daily') {
    const date = jstDate()
    const existing = await findDailyGame(db, userId, date)
    if (existing) return toDto(existing, await goalDescriptionOf(db, existing.goal))

    const challenge = await todaysChallenge(db, date)
    if (!challenge) throw appError('DAILY_NOT_READY')
    const row = await insertGame(db, {
      userId,
      mode: 'daily',
      dailyDate: date,
      difficulty: challenge.difficulty as Difficulty,
      goal: challenge.goal,
      start: challenge.start,
    })
    return toDto(row, challenge.description)
  }

  const diff: Difficulty = difficulty ?? 'normal'
  const goal = await chooseGoal(db, diff)
  const start = await chooseStart(db, goal)
  const row = await insertGame(db, {
    userId,
    mode: 'free',
    dailyDate: null,
    difficulty: diff,
    goal,
    start,
  })
  return toDto(row, await goalDescriptionOf(db, goal))
}

async function loadGame(db: Db, userId: string, gameId: string): Promise<GameRow> {
  const rows = await db.select().from(games).where(eq(games.id, gameId)).limit(1)
  const row = rows[0]
  if (!row) throw appError('GAME_NOT_FOUND')
  if (row.userId !== userId) throw appError('FORBIDDEN')
  return row
}

export async function getGameDetail(db: Db, userId: string, gameId: string): Promise<GameDetail> {
  const row = await loadGame(db, userId, gameId)
  const moveRows = await db
    .select()
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.seq))
  return {
    ...toDto(row, await goalDescriptionOf(db, row.goal)),
    moves: moveRows.map((m) => ({
      seq: m.seq,
      input_word: m.inputWord,
      ratio: m.ratio,
      result: m.result,
      rank: m.rank,
      tier: tierForRank(m.rank),
      created_at: m.createdAt.toISOString(),
    })),
  }
}

/** フリーモードで 1 手も打っていないときだけスタート語を引き直せる（SPEC §7.5）。 */
export async function shuffleStart(db: Db, userId: string, gameId: string): Promise<GameDto> {
  const row = await loadGame(db, userId, gameId)
  if (row.mode !== 'free') throw appError('NOT_FREE_MODE')
  if (row.moveCount > 0) throw appError('ALREADY_MOVED')
  if (row.status !== 'playing') throw appError('GAME_FINISHED')

  const start = await chooseStart(db, row.goal, [row.start])
  const startRank = (await rankOf(db, row.goal, start)) ?? row.currentRank
  const updated = await db
    .update(games)
    .set({ start, current: start, currentRank: startRank })
    .where(eq(games.id, gameId))
    .returning()
  const next = updated[0]
  if (!next) throw appError('INTERNAL')
  await recordEncounters(db, userId, gameId, [{ word: start, source: 'start', rank: startRank }])
  return toDto(next, await goalDescriptionOf(db, next.goal))
}

/**
 * 1 手打つ（SPEC §5.3）。
 *
 * **games 行を FOR UPDATE でロックしたトランザクションの中で実行する。**
 * ロック無しだと同じゲームへの同時リクエストが同じ move_count を読み、
 * 同じ seq を insert して `moves_game_id_seq_pk` の一意制約違反で 500 になる
 * （負荷試験で実際に 642 件発生した）。UI 側でボタンを無効化していても、
 * 通信が遅いときの二度押しや再送で起こりうる。
 */
export async function playMove(
  db: Db,
  userId: string,
  gameId: string,
  rawInput: string,
  rawRatio: number,
): Promise<MoveResponse> {
  if (!('transaction' in db)) {
    throw appError('INTERNAL', 'playMove はトランザクションを開始できる接続で呼ぶこと')
  }
  return db.transaction((tx) => playMoveLocked(tx, userId, gameId, rawInput, rawRatio))
}

async function playMoveLocked(
  db: Db,
  userId: string,
  gameId: string,
  rawInput: string,
  rawRatio: number,
): Promise<MoveResponse> {
  const rows = await db.select().from(games).where(eq(games.id, gameId)).limit(1).for('update')
  const game = rows[0]
  if (!game) throw appError('GAME_NOT_FOUND')
  if (game.userId !== userId) throw appError('FORBIDDEN')

  const pre = validateMove({
    status: game.status as GameDto['status'],
    goal: game.goal,
    current: game.current,
    rawInput,
    ratio: rawRatio,
    inputInVocab: null,
  })
  if (!pre.ok) throw appError(pre.code)

  const vocabRow = await lookupWord(db, pre.input)
  if (!vocabRow || !vocabRow.isInput) throw appError('OOV')

  // 決定論的なのでキャッシュが効く
  const cached = await db
    .select({ result: calcCache.result, rank: calcCache.rank })
    .from(calcCache)
    .where(
      and(
        eq(calcCache.goal, game.goal),
        eq(calcCache.current, game.current),
        eq(calcCache.input, pre.input),
        eq(calcCache.ratio, pre.ratio),
      ),
    )
    .limit(1)

  let result: string
  let rank: number
  const hit = cached[0]
  if (hit) {
    result = hit.result
    rank = hit.rank
  } else {
    const computed = await mixAndRank(db, game.goal, game.current, pre.input, pre.ratio)
    if (!computed) throw appError('INTERNAL', '混合結果を計算できませんでした')
    result = computed.result
    rank = computed.rank
    await db
      .insert(calcCache)
      .values({
        goal: game.goal,
        current: game.current,
        input: pre.input,
        ratio: pre.ratio,
        result,
        rank,
      })
      .onConflictDoNothing()
  }

  const prevRank = game.currentRank
  const outcome = applyMove(game.moveCount, rank)

  await db.insert(moves).values({
    gameId,
    seq: outcome.moveCount,
    inputWord: pre.input,
    ratio: pre.ratio,
    result,
    rank,
  })

  const updated = await db
    .update(games)
    .set({
      current: result,
      currentRank: rank,
      moveCount: outcome.moveCount,
      status: outcome.status,
      perfect: game.perfect || outcome.perfect,
      clearedAt: outcome.status === 'cleared' ? new Date() : game.clearedAt,
    })
    .where(eq(games.id, gameId))
    .returning()
  const next = updated[0]
  if (!next) throw appError('INTERNAL')

  await recordEncounters(db, userId, gameId, [
    { word: result, source: 'result', rank },
    { word: pre.input, source: 'input' },
  ])

  if (outcome.status === 'cleared' && next.mode === 'free') {
    const current = (
      await db.select({ best: user.bestFreeMoves }).from(user).where(eq(user.id, userId)).limit(1)
    )[0]?.best as Record<string, number> | undefined
    await db
      .update(user)
      .set({
        bestFreeMoves: updateBestFreeMoves(
          current ?? {},
          next.difficulty as Difficulty,
          outcome.moveCount,
        ),
      })
      .where(eq(user.id, userId))
  }

  const unlocked = await evaluateAchievements(db, {
    userId,
    gameId,
    mode: next.mode as 'daily' | 'free',
    dailyDate: next.dailyDate,
    status: outcome.status,
    rank,
    perfect: outcome.perfect,
    moveCount: outcome.moveCount,
    hintCount: next.hintCount,
  })

  return {
    result,
    rank,
    tier: tierForRank(rank),
    prev_rank: prevRank,
    prev_tier: tierForRank(prevRank),
    move_count: outcome.moveCount,
    hint_count: next.hintCount,
    status: outcome.status,
    perfect: next.perfect,
    unlocked_achievements: unlocked,
  }
}

/** ヒントを開く（SPEC §5.4）。同じ current なら同じ 6 語。カウントは開くたびに増える。 */
export async function openHints(db: Db, userId: string, gameId: string): Promise<HintResponse> {
  const game = await loadGame(db, userId, gameId)
  if (game.status !== 'playing') throw appError('GAME_FINISHED')

  const cached = await db
    .select({ hints: hintCache.hints })
    .from(hintCache)
    .where(and(eq(hintCache.goal, game.goal), eq(hintCache.current, game.current)))
    .limit(1)

  let hints = cached[0]?.hints ?? null

  if (!hints) {
    // そのゲームで既に登場した語を除く
    const history = await db
      .select({ result: moves.result, input: moves.inputWord })
      .from(moves)
      .where(eq(moves.gameId, gameId))
    const exclude = new Set<string>([game.goal, game.current, game.start])
    for (const h of history) {
      exclude.add(h.result)
      exclude.add(h.input)
    }
    hints = await hintWords(
      db,
      game.goal,
      game.current,
      [...exclude],
      HINT_RATIO,
      HINT_CANDIDATE_COUNT,
      HINT_COUNT,
    )
    await db
      .insert(hintCache)
      .values({ goal: game.goal, current: game.current, hints })
      .onConflictDoNothing()
  }

  const updated = await db
    .update(games)
    .set({ hintCount: sql`${games.hintCount} + 1` })
    .where(eq(games.id, gameId))
    .returning({ hintCount: games.hintCount })

  return { hints, hint_count: updated[0]?.hintCount ?? game.hintCount + 1 }
}

export async function giveUp(db: Db, userId: string, gameId: string): Promise<GameDto> {
  const game = await loadGame(db, userId, gameId)
  if (game.status !== 'playing') throw appError('GAME_FINISHED')
  const updated = await db
    .update(games)
    .set({ status: 'gave_up' })
    .where(eq(games.id, gameId))
    .returning()
  const next = updated[0]
  if (!next) throw appError('INTERNAL')
  return toDto(next, await goalDescriptionOf(db, next.goal))
}

/** デイリーランキング（SPEC §5.8）。 */
export async function leaderboard(
  db: Db,
  userId: string,
  date: string,
): Promise<LeaderboardResponse> {
  const rows = await db
    .select({
      userId: games.userId,
      displayName: user.displayName,
      moveCount: games.moveCount,
      hintCount: games.hintCount,
      perfect: games.perfect,
      clearedAt: games.clearedAt,
    })
    .from(games)
    .innerJoin(user, eq(user.id, games.userId))
    .where(and(eq(games.dailyDate, date), eq(games.status, 'cleared')))
    .orderBy(asc(games.moveCount), asc(games.hintCount), asc(games.clearedAt))
    .limit(1000)

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    user_id: r.userId,
    display_name: r.displayName ?? '名無し',
    move_count: r.moveCount,
    hint_count: r.hintCount,
    perfect: r.perfect,
    cleared_at: r.clearedAt?.toISOString() ?? new Date(0).toISOString(),
    is_me: r.userId === userId,
  }))

  return {
    date,
    entries: entries.slice(0, LEADERBOARD_PAGE),
    me: entries.find((e) => e.is_me) ?? null,
    total: entries.length,
  }
}

/** ゴール語の一行説明（word_descriptions を優先し、無ければ goal_pool）。 */
export async function describeWord(db: Db, word: string) {
  const rows = await db
    .select({ text: wordDescriptions.text, source: wordDescriptions.source })
    .from(wordDescriptions)
    .where(eq(wordDescriptions.word, word))
    .limit(1)
  return rows[0] ?? null
}

/** ユーザーの統計（/api/me 用）。 */
export async function userStats(db: Db, userId: string) {
  const played = await db.execute<{
    games_played: number
    games_cleared: number
    perfect_count: number
  }>(sql`
    SELECT count(*)::int AS games_played,
           count(*) FILTER (WHERE status = 'cleared')::int AS games_cleared,
           count(*) FILTER (WHERE perfect)::int AS perfect_count
    FROM games WHERE user_id = ${userId}
  `)
  const met = await db.execute<{ n: number }>(
    sql`SELECT count(DISTINCT word)::int AS n FROM word_encounters WHERE user_id = ${userId}`,
  )
  const streakRows = await db
    .select({ date: games.dailyDate })
    .from(games)
    .where(and(eq(games.userId, userId), eq(games.status, 'cleared'), eq(games.mode, 'daily')))
    .orderBy(desc(games.dailyDate))
    .limit(400)
  const cleared = new Set(streakRows.map((r) => r.date).filter((d): d is string => d !== null))
  let streak = 0
  let cursor = jstDate()
  // 今日まだ未クリアなら昨日から数える
  if (!cleared.has(cursor)) {
    const [y, m, d] = cursor.split('-').map(Number)
    const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
    dt.setUTCDate(dt.getUTCDate() - 1)
    cursor = dt.toISOString().slice(0, 10)
  }
  while (cleared.has(cursor)) {
    streak += 1
    const [y, m, d] = cursor.split('-').map(Number)
    const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
    dt.setUTCDate(dt.getUTCDate() - 1)
    cursor = dt.toISOString().slice(0, 10)
  }

  const p = played.rows[0]
  return {
    games_played: Number(p?.games_played ?? 0),
    games_cleared: Number(p?.games_cleared ?? 0),
    daily_streak: streak,
    words_met: Number(met.rows[0]?.n ?? 0),
    perfect_count: Number(p?.perfect_count ?? 0),
  }
}

export { CLEAR_RANK }
