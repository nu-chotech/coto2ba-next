/**
 * 読み取り専用の比較実験。
 * pnpm --filter @coto2ba/api exec tsx scripts/compare-mix.ts GOAL CURRENT INPUT RATIO [--explain]
 * pnpm --filter @coto2ba/api exec tsx scripts/compare-mix.ts --cases cases.json [--explain]
 * cases.json: [{"goal":"...","current":"...","input_word":"...","ratio":0.5}]
 */
import { readFile } from 'node:fs/promises'
import { normalizeRatio } from '@coto2ba/contracts'
import { sql } from 'drizzle-orm'
import { db, pool } from '../src/db/client'
import { compareMixCandidates, summarizeMixComparisons } from '../src/services/mix-scoring'
import {
  lookupWord,
  mixAndRank,
  mixCandidateMetrics,
  mixCandidateMetricsQuery,
} from '../src/services/vector'

type Case = { goal: string; current: string; input_word: string; ratio: number }
class InputError extends Error {}

function validCase(value: unknown): Case {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('case must be an object')
  }
  const item = value as Record<string, unknown>
  if (
    typeof item.goal !== 'string' || !item.goal ||
    typeof item.current !== 'string' || !item.current ||
    typeof item.input_word !== 'string' || !item.input_word ||
    typeof item.ratio !== 'number' || normalizeRatio(item.ratio) === null
  ) throw new InputError('case requires goal, current, input_word and a valid ratio')
  return item as Case
}

async function main() {
  const args = process.argv.slice(2)
  const explain = args.includes('--explain')
  const rest = args.filter((arg) => arg !== '--explain')
  if (rest[0] === '--cases' ? rest.length !== 2 : rest.length !== 4) {
    throw new InputError('use --cases FILE or GOAL CURRENT INPUT RATIO, optionally --explain')
  }
  let rawCases: unknown
  if (rest[0] === '--cases') {
    try {
      rawCases = JSON.parse(await readFile(rest[1]!, 'utf8'))
    } catch {
      throw new InputError('case file must be readable JSON')
    }
    if (!Array.isArray(rawCases)) throw new InputError('case file must contain an array')
  } else {
    rawCases = [{ goal: rest[0], current: rest[1], input_word: rest[2], ratio: Number(rest[3]) }]
  }
  const cases = (rawCases as unknown[]).map(validCase)
  if (cases.length === 0) throw new InputError('case list is empty')

  // SET TRANSACTION READ ONLY also protects against accidental future writes in helpers.
  const outputs = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`)
    const results = []
    for (const item of cases) {
      const [goal, current, ingredient] = await Promise.all([
        lookupWord(tx, item.goal),
        lookupWord(tx, item.current),
        lookupWord(tx, item.input_word),
      ])
      if (!goal || !current || !ingredient?.isInput) {
        throw new InputError('goal/current must exist and input_word must be input vocabulary')
      }
      const candidates = await mixCandidateMetrics(tx, item.goal, item.current, item.input_word, item.ratio)
      const comparison = compareMixCandidates(candidates)
      const production = await mixAndRank(tx, item.goal, item.current, item.input_word, item.ratio)
      const plan = explain
        ? (await tx.execute<{ 'QUERY PLAN': string }>(sql`
            EXPLAIN (ANALYZE, BUFFERS)
            ${mixCandidateMetricsQuery(item.goal, item.current, item.input_word, item.ratio)}
          `)).rows.map((row) => row['QUERY PLAN'])
        : undefined
      results.push({ input: item, candidate_count: candidates.length, comparison, production, plan })
    }
    return results
  })
  const formatted = outputs.map(({ input, candidate_count, comparison, production, plan }) => ({
    input,
    candidate_count,
    production_result: production?.result ?? null,
    classic_matches_production: comparison.classic?.word === production?.result,
    classic: comparison.classic && {
      word: comparison.classic.word,
      blend_similarity: comparison.classic.blendSimilarity,
      goal_similarity: comparison.classic.goalSimilarity,
      score: comparison.classic.score,
    },
    variants: comparison.variants.map((variant) => ({
      beta: variant.beta,
      word: variant.word,
      blend_similarity: variant.blendSimilarity,
      goal_similarity: variant.goalSimilarity,
      score: variant.score,
      changed_from_classic: variant.changedFromClassic,
      blend_difference: variant.blendDifference,
      goal_difference: variant.goalDifference,
    })),
    ...(plan ? { plan } : {}),
  }))
  const summary = summarizeMixComparisons(outputs.map((output) => output.comparison))
  process.stdout.write(`${JSON.stringify({ cases: formatted, summary }, null, 2)}\n`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `${error instanceof InputError ? error.message : 'Comparison failed; check test DB and inputs.'}\n`,
  )
  process.exitCode = 1
} finally {
  await pool.end()
}
