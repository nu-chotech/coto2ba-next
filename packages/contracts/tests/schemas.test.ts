/**
 * zod スキーマの境界。サーバーの受け口そのものなので、
 * 「通ってはいけないものが通らない」ことを中心に見る。
 */
import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH, RATIOS } from '../src/constants'
import {
  createGameRequestSchema,
  dateStringSchema,
  moveRequestSchema,
  patchMeRequestSchema,
  ratioSchema,
} from '../src/schemas'

describe('ratioSchema', () => {
  it('8 段階は通る', () => {
    for (const r of RATIOS) expect(ratioSchema.parse(r)).toBe(r)
  })

  it('段階の間は弾く（constants.normalizeRatio と同じ規則）', () => {
    expect(ratioSchema.safeParse(0.35).success).toBe(false)
    expect(ratioSchema.safeParse(0).success).toBe(false)
    expect(ratioSchema.safeParse(1).success).toBe(false)
  })

  it('数値でないものは弾く', () => {
    expect(ratioSchema.safeParse('0.5').success).toBe(false)
    expect(ratioSchema.safeParse(null).success).toBe(false)
    expect(ratioSchema.safeParse(Number.NaN).success).toBe(false)
  })

  it('表現誤差の乗った値は正規化して返す', () => {
    expect(ratioSchema.parse(0.1 + 0.2)).toBe(0.3)
  })
})

describe('moveRequestSchema', () => {
  it('正しい手は通る', () => {
    expect(moveRequestSchema.parse({ input_word: '流星', ratio: 0.5 })).toEqual({
      input_word: '流星',
      ratio: 0.5,
    })
  })

  it('空の語は弾く', () => {
    expect(moveRequestSchema.safeParse({ input_word: '', ratio: 0.5 }).success).toBe(false)
  })

  it('長すぎる語は弾く', () => {
    const long = 'あ'.repeat(65)
    expect(moveRequestSchema.safeParse({ input_word: long, ratio: 0.5 }).success).toBe(false)
  })

  it('ratio が欠けていたら弾く', () => {
    expect(moveRequestSchema.safeParse({ input_word: '流星' }).success).toBe(false)
  })
})

describe('createGameRequestSchema', () => {
  it('難易度は省略できる', () => {
    expect(createGameRequestSchema.safeParse({ mode: 'free' }).success).toBe(true)
  })

  it('知らないモードは弾く', () => {
    expect(createGameRequestSchema.safeParse({ mode: 'sandbox' }).success).toBe(false)
  })

  it('知らない難易度は弾く', () => {
    expect(createGameRequestSchema.safeParse({ mode: 'free', difficulty: 'lunatic' }).success).toBe(
      false,
    )
  })
})

describe('patchMeRequestSchema', () => {
  it('どちらか一方があればよい', () => {
    expect(patchMeRequestSchema.safeParse({ display_name: 'ほし' }).success).toBe(true)
    expect(patchMeRequestSchema.safeParse({ booth: true }).success).toBe(true)
  })

  it('空のオブジェクトは弾く', () => {
    expect(patchMeRequestSchema.safeParse({}).success).toBe(false)
  })

  it('表示名の長さの境界', () => {
    const ok = 'あ'.repeat(DISPLAY_NAME_MAX_LENGTH)
    const tooLong = 'あ'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)
    expect(patchMeRequestSchema.safeParse({ display_name: ok }).success).toBe(true)
    expect(patchMeRequestSchema.safeParse({ display_name: tooLong }).success).toBe(false)
    expect(
      patchMeRequestSchema.safeParse({ display_name: 'あ'.repeat(DISPLAY_NAME_MIN_LENGTH - 1) })
        .success,
    ).toBe(false)
  })
})

describe('dateStringSchema', () => {
  it('YYYY-MM-DD だけ通す', () => {
    expect(dateStringSchema.safeParse('2026-09-17').success).toBe(true)
    expect(dateStringSchema.safeParse('2026-9-17').success).toBe(false)
    expect(dateStringSchema.safeParse('2026/09/17').success).toBe(false)
    expect(dateStringSchema.safeParse('').success).toBe(false)
  })
})
