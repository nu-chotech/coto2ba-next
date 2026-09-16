import { createGameRequestSchema, dateStringSchema, moveRequestSchema } from '@coto2ba/contracts'
import { Hono } from 'hono'
import { db } from '../db/client'
import { appError } from '../lib/errors'
import { jstDate } from '../lib/jst'
import type { AuthVariables } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'
import { rateLimit, rateLimitGameCreate } from '../middleware/rateLimit'
import {
  createGame,
  findDailyGame,
  getGameDetail,
  giveUp,
  leaderboard,
  openHints,
  playMove,
  shuffleStart,
  todaysChallenge,
} from '../services/game'

export const gamesRoutes = new Hono<{ Variables: AuthVariables }>()

gamesRoutes.use('*', requireAuth, rateLimit)

/** 今日のデイリー（SPEC §7.5）。goal の rank は返さない。 */
gamesRoutes.get('/daily', async (c) => {
  const date = jstDate()
  const challenge = await todaysChallenge(db, date)
  if (!challenge) throw appError('DAILY_NOT_READY')
  const mine = await findDailyGame(db, c.get('authUser').id, date)
  return c.json({
    date,
    difficulty: challenge.difficulty,
    goal: challenge.goal,
    description: challenge.description,
    start: challenge.start,
    my_game: mine
      ? {
          id: mine.id,
          mode: mine.mode,
          daily_date: mine.dailyDate,
          difficulty: mine.difficulty,
          goal: mine.goal,
          goal_description: challenge.description,
          start: mine.start,
          current: mine.current,
          current_rank: mine.currentRank,
          move_count: mine.moveCount,
          hint_count: mine.hintCount,
          status: mine.status,
          perfect: mine.perfect,
          created_at: mine.createdAt.toISOString(),
          cleared_at: mine.clearedAt?.toISOString() ?? null,
        }
      : null,
  })
})

gamesRoutes.post('/games', rateLimitGameCreate, async (c) => {
  const body = createGameRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) throw appError('VALIDATION', body.error.message)
  const game = await createGame(db, c.get('authUser').id, body.data.mode, body.data.difficulty)
  return c.json(game)
})

gamesRoutes.get('/games/:id', async (c) => {
  const detail = await getGameDetail(db, c.get('authUser').id, c.req.param('id'))
  return c.json(detail)
})

gamesRoutes.post('/games/:id/shuffle-start', async (c) => {
  const game = await shuffleStart(db, c.get('authUser').id, c.req.param('id'))
  return c.json(game)
})

gamesRoutes.post('/games/:id/moves', async (c) => {
  const body = moveRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) throw appError('VALIDATION', body.error.message)
  const result = await playMove(
    db,
    c.get('authUser').id,
    c.req.param('id'),
    body.data.input_word,
    body.data.ratio,
  )
  return c.json(result)
})

gamesRoutes.post('/games/:id/hints', async (c) => {
  const hints = await openHints(db, c.get('authUser').id, c.req.param('id'))
  return c.json(hints)
})

gamesRoutes.post('/games/:id/give-up', async (c) => {
  const game = await giveUp(db, c.get('authUser').id, c.req.param('id'))
  return c.json(game)
})

gamesRoutes.get('/leaderboard/daily', async (c) => {
  const raw = c.req.query('date') ?? jstDate()
  const parsed = dateStringSchema.safeParse(raw)
  if (!parsed.success) throw appError('VALIDATION', 'date は YYYY-MM-DD')
  const board = await leaderboard(db, c.get('authUser').id, parsed.data)
  return c.json(board)
})
