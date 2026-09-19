/**
 * ゲームのオーケストレーション（SPEC §5）。
 * ルール判定そのものは rules.ts（純粋関数）にあり、ここは DB との突き合わせを行う。
 * **クライアントの値は一切信用しない。** goal / current は games 行が唯一の権威。
 */
import {
  CLEAR_RANK,
  type CreatableGameMode,
  type Difficulty,
  type GameDetail,
  type Game as GameDto,
  type GameMode,
  GOAL_NEIGHBOR_BAN,
  HINT_CACHE_VERSION,
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
  hintCandidateCache,
  moves,
  user,
  wordDescriptions,
} from '../db/schema'
import { appError } from '../lib/errors'
import { jstDate } from '../lib/jst'
import { pickRandom } from '../lib/random'
import { evaluateAchievements, recordEncounters } from './achievements'
import { selectHints } from './hint-pool'
// 対戦ルーム（設計 §9）。`rooms.ts` も `game.ts` を使うので相互参照になるが、
// **どちらも相手を関数の中でしか呼ばない**（モジュール評価時に触らない）ので安全。
import { roomStandingsForGame } from './rooms'
import { applyMove, parseBestFreeMoves, updateBestFreeMoves, validateMove } from './rules'
import {
  goalNeighborhood,
  lookupWord,
  mixAndRank,
  rankOf,
  sampleStartWord,
  verifiedHintPool,
} from './vector'

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

/**
 * フリーモードのゴールを難易度から抽選する。
 * `vocab.is_concrete` を必ず条件に入れること — ゴールプールには過去の実行で入った
 * 抽象語（顧み・促進・提唱）が残っている可能性があり、目的地として弱い。
 */
async function chooseGoal(db: Db, difficulty: Difficulty): Promise<string> {
  const rows = await db.execute<{ word: string }>(sql`
    SELECT g.word FROM goal_pool g
    JOIN vocab v ON v.word = g.word
    WHERE g.enabled AND NOT g.review_needed AND g.difficulty = ${difficulty}
      AND v.is_concrete
    ORDER BY random() LIMIT 1
  `)
  const word = rows.rows[0]?.word
  if (!word) throw appError('DAILY_NOT_READY', 'ゴールプールがまだ用意されていません')
  return word
}

/**
 * お題（goal / start）とそれに付随する値。
 *
 * 対戦ルームは **部屋で 1 度だけ抽選して全員に配る**ので、抽選結果をこの形で持ち回る。
 * 抽選そのものは `chooseGoal` / `chooseStart` で、**ルーム側に複製しない**。
 */
export interface Challenge {
  goal: string
  start: string
  startRank: number
  forbiddenInputs: string[]
}

/** ゴール・スタート・禁止語をまとめて 1 回だけ引く。 */
export async function pickChallenge(db: Db, difficulty: Difficulty): Promise<Challenge> {
  const goal = await chooseGoal(db, difficulty)
  const start = await chooseStart(db, goal)
  const [startRank, forbiddenInputs] = await Promise.all([
    rankOf(db, goal, start),
    goalNeighborhood(db, goal, GOAL_NEIGHBOR_BAN),
  ])
  return { goal, start, startRank: startRank ?? START_RANK_RANGE[1], forbiddenInputs }
}

async function insertGame(
  db: Db,
  input: {
    userId: string
    mode: GameMode
    dailyDate: string | null
    difficulty: Difficulty
    goal: string
    start: string
    roomId?: string | null
    /** 既に引いてある場合（対戦ルーム）。渡さなければここで引く。 */
    challenge?: Pick<Challenge, 'startRank' | 'forbiddenInputs'>
  },
): Promise<GameRow> {
  let resolved: Pick<Challenge, 'startRank' | 'forbiddenInputs'>
  if (input.challenge === undefined) {
    const [startRank, forbiddenInputs] = await Promise.all([
      rankOf(db, input.goal, input.start),
      goalNeighborhood(db, input.goal, GOAL_NEIGHBOR_BAN),
    ])
    resolved = { startRank: startRank ?? START_RANK_RANGE[1], forbiddenInputs }
  } else {
    resolved = input.challenge
  }
  const rows = await db
    .insert(games)
    .values({
      userId: input.userId,
      mode: input.mode,
      dailyDate: input.dailyDate,
      roomId: input.roomId ?? null,
      difficulty: input.difficulty,
      goal: input.goal,
      start: input.start,
      current: input.start,
      currentRank: resolved.startRank,
      forbiddenInputs: resolved.forbiddenInputs,
    })
    .returning()
  const row = rows[0]
  if (!row) throw appError('INTERNAL', 'ゲームを作成できませんでした')
  await recordEncounters(db, input.userId, row.id, [
    { word: input.start, source: 'start', rank: resolved.startRank },
  ])
  return row
}

/**
 * 対戦ルームの 1 戦ぶんのゲームを作る（`services/rooms.ts` から呼ぶ）。
 * **お題は部屋が決めたものをそのまま配る**（全員が同じ盤面を解く）。
 */
export async function createRoomGame(
  db: Db,
  input: {
    userId: string
    roomId: string
    difficulty: Difficulty
    challenge: Challenge
  },
): Promise<GameRow> {
  return insertGame(db, {
    userId: input.userId,
    mode: 'room',
    dailyDate: null,
    roomId: input.roomId,
    difficulty: input.difficulty,
    goal: input.challenge.goal,
    start: input.challenge.start,
    challenge: input.challenge,
  })
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
  mode: CreatableGameMode,
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
  const challenge = await pickChallenge(db, diff)
  const row = await insertGame(db, {
    userId,
    mode: 'free',
    dailyDate: null,
    difficulty: diff,
    goal: challenge.goal,
    start: challenge.start,
    challenge,
  })
  return toDto(row, await goalDescriptionOf(db, challenge.goal))
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
  const rows = await db.select().from(games).where(eq(games.id, gameId)).limit(1)
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
    forbiddenInputs: game.forbiddenInputs,
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

  // **楽観ロック（compare-and-swap）。**
  // 読んだときの move_count と status が変わっていないときだけ書き込む。
  // 同じゲームへの同時リクエストは片方しか通らないので、
  // moves の一意制約違反（= 500）が構造的に起きない。
  // トランザクション + FOR UPDATE でも正しいが、BEGIN と COMMIT で
  // Neon への往復が 2 回増えて 1 手あたり約 140ms 遅くなる（実測）。
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
    .where(
      and(eq(games.id, gameId), eq(games.moveCount, game.moveCount), eq(games.status, 'playing')),
    )
    .returning()
  const next = updated[0]
  if (!next) {
    // 別のリクエストが先に 1 手進めた（通信が遅いときの二度押し・再送）。
    // ここで再計算して適用すると同じ入力が 2 手ぶん効いてしまうので、
    // 明示的に失敗させてクライアントに読み直させる。
    throw appError('ALREADY_MOVED', '直前の手が反映されました。画面を読み直してください')
  }

  // seq は CAS を通ったこの手にだけ割り当たるので一意制約に当たらない。

  await recordEncounters(db, userId, gameId, [
    { word: result, source: 'result', rank },
    { word: pre.input, source: 'input' },
  ])

  if (outcome.status === 'cleared' && next.mode === 'free') {
    const current = (
      await db.select({ best: user.bestFreeMoves }).from(user).where(eq(user.id, userId)).limit(1)
    )[0]?.best
    await db
      .update(user)
      .set({
        // ヒント数込みで記録する。手数だけだと「ヒント 1 回で 1 手」が永久に残る（SPEC §5.7）。
        bestFreeMoves: updateBestFreeMoves(
          parseBestFreeMoves(current),
          next.difficulty as Difficulty,
          { moves: outcome.moveCount, hints: next.hintCount },
        ),
      })
      .where(eq(user.id, userId))
  }

  const unlocked = await evaluateAchievements(db, {
    userId,
    gameId,
    mode: next.mode as GameMode,
    dailyDate: next.dailyDate,
    status: outcome.status,
    rank,
    perfect: outcome.perfect,
    moveCount: outcome.moveCount,
    hintCount: next.hintCount,
  })

  /**
   * ルーム戦なら、**その時点の順位をこの手のレスポンスに同梱する**（設計 §9）。
   *
   * 自分の手が即座に順位へ反映されるので、ポーリングは「他人の変化の検知」だけを
   * 担えばよくなる。間隔を緩めても体感が落ちない ＝ invocations が減る。
   *
   * ルーム戦でなければ 1 クエリも撃たない（`roomId` が null ならそこで返る）。
   * **`services/rooms.ts` を消しても、この 1 か所を外すだけで戻せる。**
   */
  const roomStandings = await roomStandingsForGame(db, userId, next.roomId)

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
    room_standings: roomStandings,
  }
}

/**
 * ヒントを開く（SPEC §5.4）。同じ current なら同じヒント。カウントは開くたびに増える。
 *
 * ヒントは「語 + 混ぜる比率」。**混ぜると実際にゴールへ近づく手だけ**を返すので、
 * 6 件に満たないことがある（効かない語で埋めると元の問題に戻る）。
 */
export async function openHints(db: Db, userId: string, gameId: string): Promise<HintResponse> {
  const game = await loadGame(db, userId, gameId)
  if (game.status !== 'playing') throw appError('GAME_FINISHED')

  const cached = await db
    .select({ hints: hintCandidateCache.hints })
    .from(hintCandidateCache)
    .where(
      and(
        eq(hintCandidateCache.goal, game.goal),
        eq(hintCandidateCache.current, game.current),
        eq(hintCandidateCache.hintVersion, HINT_CACHE_VERSION),
      ),
    )
    .limit(1)

  let pool = cached[0]?.hints ?? null

  if (!pool) {
    // Only goal/current-independent exclusions are applied before storing the pool.
    // forbiddenInputs は goal だけから決まる（goalNeighborhood）ので、共有キャッシュと整合する。
    pool = await verifiedHintPool(db, game.goal, game.current, game.forbiddenInputs)
    // **キャッシュに書けなくてもヒントは返す。** ここは速くするための保存でしかなく、
    // 正しいヒントはもう手元にある。書き込みの失敗（スキーマが古い・容量・権限など）で
    // ヒント機能ごと 500 にする理由が無い。
    // Migration 0008 must be applied before deploying this reader (SELECT also uses the table).
    try {
      await db
        .insert(hintCandidateCache)
        .values({
          goal: game.goal,
          current: game.current,
          hintVersion: HINT_CACHE_VERSION,
          hints: pool,
        })
        .onConflictDoNothing()
    } catch (e) {
      console.error('hint_candidate_cache への保存に失敗（ヒント自体は返す）', e)
    }
  }

  const history = await db
    .select({ result: moves.result, input: moves.inputWord })
    .from(moves)
    .where(eq(moves.gameId, gameId))
  const excluded = [
    game.start,
    ...game.forbiddenInputs,
    ...history.flatMap((h) => [h.input, h.result]),
  ]
  const hints = selectHints(pool, game.goal, game.current, excluded)

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
    // ヒント数が最優先（SPEC §5.8）。rules.ts の compareLeaderboard と同じ規則にすること。
    .orderBy(asc(games.hintCount), asc(games.moveCount), asc(games.clearedAt))
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
