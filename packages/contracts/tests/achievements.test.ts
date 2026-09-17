import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_IDS,
  ACHIEVEMENTS,
  MEET_THRESHOLDS,
  STREAK_THRESHOLDS,
} from '../src/achievements'

describe('ACHIEVEMENTS', () => {
  it('SPEC v1 の 12 個', () => {
    expect(ACHIEVEMENTS).toHaveLength(12)
  })

  it('id が重複しない', () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length)
  })

  it('title / description / icon がすべて埋まっている', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.title, a.id).toBeTruthy()
      expect(a.description, a.id).toBeTruthy()
      expect(a.icon, a.id).toBeTruthy()
    }
  })

  it('ACHIEVEMENT_BY_ID から全件引ける', () => {
    for (const id of ACHIEVEMENT_IDS) {
      expect(ACHIEVEMENT_BY_ID[id]?.id, id).toBe(id)
    }
    expect(Object.keys(ACHIEVEMENT_BY_ID).sort()).toEqual([...ACHIEVEMENT_IDS].sort())
  })
})

describe('しきい値', () => {
  it('出会い系は昇順で、実在する実績を指す', () => {
    for (let i = 1; i < MEET_THRESHOLDS.length; i++) {
      expect(MEET_THRESHOLDS[i]?.count).toBeGreaterThan(MEET_THRESHOLDS[i - 1]?.count as number)
    }
    for (const t of MEET_THRESHOLDS) expect(ACHIEVEMENT_IDS).toContain(t.id)
  })

  it('連続日数は昇順で、実在する実績を指す', () => {
    for (let i = 1; i < STREAK_THRESHOLDS.length; i++) {
      expect(STREAK_THRESHOLDS[i]?.days).toBeGreaterThan(STREAK_THRESHOLDS[i - 1]?.days as number)
    }
    for (const t of STREAK_THRESHOLDS) expect(ACHIEVEMENT_IDS).toContain(t.id)
  })
})
