import {
  createCraftRequestSchema, craftCandidatesRequestSchema, craftConfirmRequestSchema,
} from '@coto2ba/contracts'
import { Hono } from 'hono'
import { z } from 'zod'
import { appError } from '../lib/errors'
import type { AuthVariables } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'
import { rateLimit, rateLimitGameCreate } from '../middleware/rateLimit'
import { confirmCraft, createCraft, getCraft, makeCraftCandidates } from '../services/craft'

export const craftRoutes = new Hono<{ Variables: AuthVariables }>()
craftRoutes.use('*', requireAuth, rateLimit)

function gameId(raw: string): string {
  const parsed = z.string().uuid().safeParse(raw)
  if (!parsed.success) throw appError('VALIDATION', 'ゲームIDが不正です')
  return parsed.data
}

craftRoutes.post('/craft/games', rateLimitGameCreate, async (c) => {
  const parsed = createCraftRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw appError('VALIDATION', parsed.error.message)
  return c.json(await createCraft(c.get('authUser').id, parsed.data))
})

craftRoutes.get('/craft/games/:id', async (c) =>
  c.json(await getCraft(c.get('authUser').id, gameId(c.req.param('id')))))

craftRoutes.post('/craft/games/:id/candidates', async (c) => {
  const parsed = craftCandidatesRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw appError('VALIDATION', parsed.error.message)
  return c.json(await makeCraftCandidates(c.get('authUser').id, gameId(c.req.param('id')), parsed.data))
})

craftRoutes.post('/craft/games/:id/confirm', async (c) => {
  const parsed = craftConfirmRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw appError('VALIDATION', parsed.error.message)
  return c.json(await confirmCraft(
    c.get('authUser').id, gameId(c.req.param('id')), parsed.data.candidate_set_id, parsed.data.candidate_id,
  ))
})
