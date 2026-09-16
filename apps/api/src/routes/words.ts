import { normalizeWord, SPACE_GHOST_COUNT, tierForRank } from '@coto2ba/contracts'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client'
import { games, moves, vocab, wordDescriptions, wordEncounters } from '../db/schema'
import type { AuthVariables } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'
import { lookupWord, nearestAmong } from '../services/vector'

export const wordsRoutes = new Hono<{ Variables: AuthVariables }>()

/** 端末側判定の保険（認証不要、SPEC §7.5）。 */
wordsRoutes.get('/words/check', async (c) => {
  const w = normalizeWord(c.req.query('w') ?? '')
  if (!w) return c.json({ ok: false })
  const row = await lookupWord(db, w)
  return c.json({ ok: Boolean(row?.isInput) })
})

/** 図鑑のゴースト点（認証不要）。頻度上位の出力語彙 + 3D 座標。 */
wordsRoutes.get('/words/ghosts', async (c) => {
  const rows = await db.execute<{ word: string; pos3: number[] | null }>(sql`
    SELECT word, pos3 FROM vocab
    WHERE is_output AND pos3 IS NOT NULL
    ORDER BY freq_rank
    LIMIT ${SPACE_GHOST_COUNT}
  `)
  return c.json({ ghosts: rows.rows.map((r) => ({ word: r.word, pos3: r.pos3 })) })
})

wordsRoutes.use('/words/:word/*', requireAuth, rateLimit)
wordsRoutes.use('/collection', requireAuth, rateLimit)

const WIKIPEDIA_UA = 'coto2ba-next/0.1 (https://coto2ba-next.chotech.dev)'

/** 語の説明。キャッシュを見て、無ければ Wikipedia REST を引く（SPEC §7.6）。 */
wordsRoutes.get('/words/:word/description', async (c) => {
  const word = normalizeWord(decodeURIComponent(c.req.param('word')))
  const cached = await db
    .select({ text: wordDescriptions.text, source: wordDescriptions.source })
    .from(wordDescriptions)
    .where(eq(wordDescriptions.word, word))
    .limit(1)
  const hit = cached[0]
  if (hit) return c.json({ word, text: hit.text, source: hit.source })

  try {
    const res = await fetch(
      `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`,
      { headers: { 'User-Agent': WIKIPEDIA_UA, Accept: 'application/json' }, redirect: 'follow' },
    )
    if (res.ok) {
      const data = (await res.json()) as { extract?: string; type?: string }
      const extract = data.extract?.trim()
      if (extract && data.type !== 'disambiguation') {
        const firstSentence = `${extract.split('。')[0] ?? extract}。`
        await db
          .insert(wordDescriptions)
          .values({ word, text: firstSentence, source: 'wikipedia' })
          .onConflictDoNothing()
        return c.json({ word, text: firstSentence, source: 'wikipedia' })
      }
    }
  } catch {
    // 説明が取れなくても UI は壊れない（SPEC §7.6）
  }
  return c.json({ word, text: null, source: null })
})

/** 図鑑の語の詳細（説明 + 所持語のうち近い 5 語）。 */
wordsRoutes.get('/words/:word/detail', async (c) => {
  const word = normalizeWord(decodeURIComponent(c.req.param('word')))
  const me = c.get('authUser')

  const owned = await db
    .selectDistinct({ word: wordEncounters.word })
    .from(wordEncounters)
    .where(eq(wordEncounters.userId, me.id))
    .limit(2000)

  const [desc, info, neighbors] = await Promise.all([
    db
      .select({ text: wordDescriptions.text })
      .from(wordDescriptions)
      .where(eq(wordDescriptions.word, word))
      .limit(1),
    db.select({ pos3: vocab.pos3 }).from(vocab).where(eq(vocab.word, word)).limit(1),
    nearestAmong(
      db,
      word,
      owned.map((o) => o.word),
      5,
    ),
  ])

  const pos3 = info[0]?.pos3
  return c.json({
    word,
    description: desc[0]?.text ?? null,
    pos3: pos3 && pos3.length === 3 ? [pos3[0], pos3[1], pos3[2]] : null,
    neighbors,
  })
})

/** 図鑑（SPEC §9.3）。 */
wordsRoutes.get('/collection', async (c) => {
  const me = c.get('authUser')

  const encounters = await db.execute<{
    word: string
    source: string
    first_seen_at: string
    count: number
    first_rank: number | null
    pos3: number[] | null
  }>(sql`
    SELECT e.word, e.source, e.first_seen_at, e.count, e.first_rank, v.pos3
    FROM word_encounters e
    LEFT JOIN vocab v ON v.word = e.word
    WHERE e.user_id = ${me.id}
    ORDER BY e.first_seen_at DESC
    LIMIT 2000
  `)

  const clearedGames = await db
    .select({ id: games.id, dailyDate: games.dailyDate, start: games.start, goal: games.goal })
    .from(games)
    .where(and(eq(games.userId, me.id), eq(games.status, 'cleared')))
    .orderBy(asc(games.createdAt))
    .limit(100)

  const paths: { game_id: string; daily_date: string | null; words: string[] }[] = []
  for (const g of clearedGames) {
    const seq = await db
      .select({ result: moves.result })
      .from(moves)
      .where(eq(moves.gameId, g.id))
      .orderBy(asc(moves.seq))
    paths.push({
      game_id: g.id,
      daily_date: g.dailyDate,
      words: [g.start, ...seq.map((s) => s.result)],
    })
  }

  return c.json({
    encounters: encounters.rows.map((r) => ({
      word: r.word,
      source: r.source,
      first_seen_at: new Date(r.first_seen_at).toISOString(),
      count: Number(r.count),
      pos3: r.pos3 && r.pos3.length === 3 ? [r.pos3[0], r.pos3[1], r.pos3[2]] : null,
      first_tier: tierForRank(r.first_rank ?? Number.POSITIVE_INFINITY),
    })),
    cleared_paths: paths,
  })
})
