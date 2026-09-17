import { randomUUID } from 'node:crypto'
import {
  type Difficulty,
  type ExperimentOperation,
  normalizeWord,
  tierForRank,
} from '@coto2ba/contracts'
import { and, eq, sql } from 'drizzle-orm'
import { db, type Tx } from '../db/client'
import { craftGames } from '../db/schema'
import { appError } from '../lib/errors'
import { craftBeta } from './craft-config'
import {
  operateVector,
  pickExperimentalWord,
  scoreExperimentalWord,
} from './experimental-operators'
import { chooseGoal, chooseStart } from './game'
import { applyMove } from './rules'
import {
  craftCandidateWords,
  experimentalNeighbors,
  experimentalVectors,
  lookupWord,
  rankOf,
  similarityToGoal,
} from './vector'

type CraftRow = typeof craftGames.$inferSelect
type CraftOption = { id: string; word: string; score: number }

function state(row: CraftRow) {
  return {
    id: row.id,
    goal: row.goal,
    start: row.start,
    current: row.current,
    current_rank: row.currentRank,
    current_tier: tierForRank(row.currentRank),
    perfect: row.currentRank === 0,
    difficulty: row.difficulty,
    combo_enabled: row.comboEnabled,
    goal_bias_enabled: row.goalBiasEnabled,
    turn: row.turn,
    move_count: row.turn,
    combo: row.combo,
    history: row.history,
    status: row.status,
  }
}

async function ownedLocked(tx: Tx, userId: string, id: string) {
  const rows = await tx
    .select()
    .from(craftGames)
    .where(eq(craftGames.id, id))
    .for('update')
    .limit(1)
  const row = rows[0]
  if (!row) throw appError('GAME_NOT_FOUND')
  if (row.userId !== userId) throw appError('FORBIDDEN')
  return row
}

export async function createCraft(
  userId: string,
  input: {
    difficulty: Difficulty
    combo_enabled: boolean
    goal_bias_enabled: boolean
  },
) {
  const goal = await chooseGoal(db, input.difficulty)
  const start = await chooseStart(db, goal)
  const startRank = await rankOf(db, goal, start)
  if (startRank === null) throw appError('INTERNAL', 'スタート語の順位を取得できませんでした')
  const rows = await db
    .insert(craftGames)
    .values({
      userId,
      difficulty: input.difficulty,
      goal,
      start,
      current: start,
      currentRank: startRank,
      history: [start],
      comboEnabled: input.combo_enabled,
      goalBiasEnabled: input.goal_bias_enabled,
    })
    .returning()
  return state(rows[0]!)
}

export async function getCraft(userId: string, id: string) {
  const rows = await db
    .select()
    .from(craftGames)
    .where(and(eq(craftGames.id, id), eq(craftGames.userId, userId)))
    .limit(1)
  if (!rows[0]) throw appError('GAME_NOT_FOUND')
  return state(rows[0])
}

export async function makeCraftCandidates(
  userId: string,
  id: string,
  input: {
    material_a: string
    material_b: string
    alpha: number
  },
) {
  return db.transaction(async (tx) => {
    const row = await ownedLocked(tx, userId, id)
    if (row.status !== 'playing') throw appError('GAME_FINISHED')
    const [a, b] = await Promise.all([
      lookupWord(tx, input.material_a),
      lookupWord(tx, input.material_b),
    ])
    if (!a?.isInput || !b?.isInput) throw appError('OOV')
    const beta = craftBeta(
      row.difficulty as Difficulty,
      row.combo,
      row.comboEnabled,
      row.goalBiasEnabled,
    )
    const candidates = await craftCandidateWords(tx, a.word, b.word, row.goal, input.alpha, beta)
    if (candidates.length === 0) throw appError('OOV', '候補語を作れませんでした')
    const options: CraftOption[] = candidates.map((candidate) => ({
      id: randomUUID(),
      ...candidate,
    }))
    const setId = randomUUID()
    await tx
      .update(craftGames)
      .set({ activeSetId: setId, activeOptions: options })
      .where(eq(craftGames.id, id))
    return { candidate_set_id: setId, beta, candidates: options }
  })
}

export async function confirmCraft(userId: string, id: string, setId: string, candidateId: string) {
  return db.transaction(async (tx) => {
    const row = await ownedLocked(tx, userId, id)
    if (row.status !== 'playing') throw appError('GAME_FINISHED')
    if (row.activeSetId !== setId) throw appError('CRAFT_STALE_SET')
    const selected = row.activeOptions?.find((option) => option.id === candidateId)
    if (!selected) throw appError('CRAFT_STALE_SET')
    const similarity = await similarityToGoal(tx, selected.word, row.goal)
    const rank = await rankOf(tx, row.goal, selected.word)
    if (rank === null) throw appError('INTERNAL', '候補語の順位を取得できませんでした')
    const combo =
      row.comboEnabled && row.previousSimilarity !== null && similarity > row.previousSimilarity
        ? row.combo + 1
        : 0
    const outcome = applyMove(row.turn, rank)
    const rows = await tx
      .update(craftGames)
      .set({
        current: selected.word,
        currentRank: rank,
        turn: sql`${craftGames.turn} + 1`,
        combo,
        previousSimilarity: similarity,
        history: [...row.history, selected.word],
        activeSetId: null,
        activeOptions: null,
        status: outcome.status,
      })
      .where(eq(craftGames.id, id))
      .returning()
    return {
      ...state(rows[0]!),
      result: selected.word,
      rank,
      tier: outcome.tier,
      prev_rank: row.currentRank,
      prev_tier: tierForRank(row.currentRank),
    }
  })
}

/** Python のベクトル演算で1語を自動確定する実験経路。既存 games/moves は変更しない。 */
export async function playExperimentalMove(
  userId: string,
  id: string,
  input: {
    input_word: string
    ratio: number
    operation: ExperimentOperation
    expected_turn: number
  },
) {
  return db.transaction(async (tx) => {
    const row = await ownedLocked(tx, userId, id)
    if (row.status !== 'playing') throw appError('GAME_FINISHED')
    if (row.turn !== input.expected_turn) throw appError('CRAFT_STALE_TURN')
    const ingredient = normalizeWord(input.input_word)
    if (ingredient === row.goal) throw appError('GOAL_INPUT')
    const vocab = await lookupWord(tx, ingredient)
    if (!vocab?.isInput) throw appError('OOV')
    const vectors = await experimentalVectors(tx, [row.current, ingredient, row.goal])
    const current = vectors.get(row.current)
    const other = vectors.get(ingredient)
    const goal = vectors.get(row.goal)
    if (!current || !other || !goal) throw appError('OOV')
    let query: number[]
    try {
      query = operateVector(current, other, goal, input.operation, input.ratio)
    } catch {
      throw appError('VALIDATION', '演算ベクトルを作れませんでした')
    }
    const near = await experimentalNeighbors(tx, query, [...row.history, ingredient], 12)
    const result = pickExperimentalWord(
      near,
      `${row.id}:${row.turn}:${input.operation}:${ingredient}:${input.ratio}`,
    )
    if (!result) throw appError('OOV', '結果語を作れませんでした')
    const output = (await experimentalVectors(tx, [result])).get(result)
    if (!output) throw appError('INTERNAL', '結果語のベクトルがありません')
    const [neighbors, rank] = await Promise.all([
      experimentalNeighbors(tx, output, [result], 6),
      rankOf(tx, row.goal, result),
    ])
    if (rank === null) throw appError('INTERNAL', '結果語の順位を取得できませんでした')
    const metrics = scoreExperimentalWord({
      current,
      ingredient: other,
      goal,
      result: output,
      neighborSimilarities: neighbors.map((item) => item.similarity),
      operation: input.operation,
      previousCombo: row.combo,
      comboEnabled: row.comboEnabled,
    })
    const outcome = applyMove(row.turn, rank)
    const updated = await tx
      .update(craftGames)
      .set({
        current: result,
        currentRank: rank,
        turn: outcome.moveCount,
        combo: metrics.combo,
        previousSimilarity: metrics.target_similarity,
        history: [...row.history, result],
        status: outcome.status,
        activeSetId: null,
        activeOptions: null,
      })
      .where(eq(craftGames.id, id))
      .returning()
    return {
      ...state(updated[0]!),
      result,
      rank,
      tier: outcome.tier,
      prev_rank: row.currentRank,
      prev_tier: tierForRank(row.currentRank),
      operation: input.operation,
      ratio: input.ratio,
      experimental_score: metrics.score,
      multiplier: metrics.multiplier,
      target_similarity: metrics.target_similarity,
      delta_similarity: metrics.delta_similarity,
      breakdown: metrics.breakdown,
    }
  })
}
