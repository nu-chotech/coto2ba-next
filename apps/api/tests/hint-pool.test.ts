import { describe, expect, it } from 'vitest'
import { selectHints } from '../src/services/hint-pool'

const pool = Array.from({ length: 9 }, (_, i) => ({ word: `候補${i}`, ratio: 0.5 }))

describe('shared verified hint pool', () => {
  it('applies each game history on cache misses and hits without changing the shared pool', () => {
    const original = structuredClone(pool)
    const gameA = ['候補0', '候補1', '候補2'] // start, previous input, previous result
    const gameB = ['候補3']
    const a = selectHints(pool, 'goal', 'current', gameA) // freshly verified pool
    const b = selectHints(structuredClone(pool), 'goal', 'current', gameB) // cached JSONB pool
    expect(a).toHaveLength(6)
    for (const word of gameA) expect(a.map((h) => h.word)).not.toContain(word)
    expect(b.map((h) => h.word)).not.toContain('候補3')
    expect(b.map((h) => h.word)).toContain('候補0')
    expect(selectHints(pool, 'goal', 'current', gameA)).toEqual(a)
    expect(pool).toEqual(original)
  })

  it('does not fill shortages, deduplicates and is deterministic on ties', () => {
    const small = [pool[0]!, pool[0]!, pool[1]!]
    expect(selectHints(small, 'goal', 'current', [])).toEqual(
      selectHints(small, 'goal', 'current', []),
    )
    expect(selectHints(small, 'goal', 'current', [])).toHaveLength(2)
    expect(selectHints(small, 'goal', 'current', ['候補0'])).toHaveLength(1)
    expect(selectHints([], 'goal', 'current', [])).toEqual([])
  })

  it('excludes goal and current even when malformed cache data contains them', () => {
    const malformed = [{ word: 'goal', ratio: 0.5 }, { word: 'current', ratio: 0.5 }, pool[0]!]
    expect(selectHints(malformed, 'goal', 'current', [])).toEqual([pool[0]])
  })
})
