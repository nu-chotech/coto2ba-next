import type { Difficulty } from '@coto2ba/contracts'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, type Tx } from '../db/client'
import { craftGames } from '../db/schema'
import { appError } from '../lib/errors'
import { chooseGoal, chooseStart } from './game'
import { craftBeta } from './craft-config'
import { craftCandidateWords, lookupWord, similarityToGoal } from './vector'

type CraftRow = typeof craftGames.$inferSelect
type CraftOption = { id: string; word: string; score: number }

function state(row: CraftRow) {
  return {
    id: row.id, goal: row.goal, start: row.start, current: row.current,
    difficulty: row.difficulty, combo_enabled: row.comboEnabled,
    goal_bias_enabled: row.goalBiasEnabled, turn: row.turn, combo: row.combo,
    history: row.history, status: row.status,
  }
}

async function ownedLocked(tx: Tx, userId: string, id: string) {
  const rows = await tx.select().from(craftGames).where(eq(craftGames.id, id)).for('update').limit(1)
  const row = rows[0]
  if (!row) throw appError('GAME_NOT_FOUND')
  if (row.userId !== userId) throw appError('FORBIDDEN')
  return row
}

export async function createCraft(userId: string, input: {
  difficulty: Difficulty; combo_enabled: boolean; goal_bias_enabled: boolean
}) {
  const goal = await chooseGoal(db, input.difficulty)
  const start = await chooseStart(db, goal)
  const rows = await db.insert(craftGames).values({
    userId, difficulty: input.difficulty, goal, start, current: start,
    history: [start], comboEnabled: input.combo_enabled, goalBiasEnabled: input.goal_bias_enabled,
  }).returning()
  return state(rows[0]!)
}

export async function getCraft(userId: string, id: string) {
  const rows = await db.select().from(craftGames).where(and(eq(craftGames.id, id), eq(craftGames.userId, userId))).limit(1)
  if (!rows[0]) throw appError('GAME_NOT_FOUND')
  return state(rows[0])
}

export async function makeCraftCandidates(userId: string, id: string, input: {
  material_a: string; material_b: string; alpha: number
}) {
  return db.transaction(async (tx) => {
    const row = await ownedLocked(tx, userId, id)
    if (row.status !== 'playing') throw appError('GAME_FINISHED')
    const [a, b] = await Promise.all([
      lookupWord(tx, input.material_a), lookupWord(tx, input.material_b),
    ])
    if (!a?.isInput || !b?.isInput) throw appError('OOV')
    const beta = craftBeta(row.difficulty as Difficulty, row.combo, row.comboEnabled, row.goalBiasEnabled)
    const candidates = await craftCandidateWords(tx, a.word, b.word, row.goal, input.alpha, beta)
    if (candidates.length === 0) throw appError('OOV', '候補語を作れませんでした')
    const options: CraftOption[] = candidates.map((candidate) => ({ id: randomUUID(), ...candidate }))
    const setId = randomUUID()
    await tx.update(craftGames).set({ activeSetId: setId, activeOptions: options })
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
    const combo = row.comboEnabled && row.previousSimilarity !== null && similarity > row.previousSimilarity
      ? row.combo + 1 : 0
    const rows = await tx.update(craftGames).set({
      current: selected.word, turn: sql`${craftGames.turn} + 1`, combo,
      previousSimilarity: similarity, history: [...row.history, selected.word],
      activeSetId: null, activeOptions: null,
      status: selected.word === row.goal ? 'cleared' : 'playing',
    }).where(eq(craftGames.id, id)).returning()
    return state(rows[0]!)
  })
}
