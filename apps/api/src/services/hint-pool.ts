import { HINT_COUNT, type Hint } from '@coto2ba/contracts'
import { deterministicShuffle } from '../lib/random'

/**
 * Cache entries are ordered by verified improvement. Filter each game's start,
 * forbidden words and move history before taking at most six; never mutate the pool.
 * An exhausted pool yields fewer than six hints, including zero. Do not refill it
 * with previously seen or unverified words.
 * The chosen six keep the existing deterministic display shuffle, so slot order
 * does not imply strength and stays stable for the same board and exclusions.
 */
export function selectHints(
  pool: readonly Hint[],
  goal: string,
  current: string,
  excluded: readonly string[],
): Hint[] {
  const banned = new Set([goal, current, ...excluded])
  const seen = new Set<string>()
  const selected: Hint[] = []
  for (const hint of pool) {
    if (banned.has(hint.word) || seen.has(hint.word)) continue
    seen.add(hint.word)
    selected.push({ ...hint })
    if (selected.length === HINT_COUNT) break
  }
  return deterministicShuffle(selected, `${goal}\u0000${current}`)
}
