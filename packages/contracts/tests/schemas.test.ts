/**
 * zod スキーマの境界。サーバーの受け口そのものなので、
 * 「通ってはいけないものが通らない」ことを中心に見る。
 */
import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH, RATIOS } from '../src/constants'
import {
  createGameRequestSchema,
  dateStringSchema,
  hintResponseSchema,
  meResponseSchema,
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

describe('meResponseSchema の best_free_moves', () => {
  const base = {
    id: 'u1',
    display_name: '静かな蚕',
    booth: false,
    stats: {
      games_played: 0,
      games_cleared: 0,
      daily_streak: 0,
      words_met: 0,
      perfect_count: 0,
    },
  }

  // 新規ユーザーは必ずこの形。ここが落ちると設定画面が全部エラーになる。
  it('空オブジェクトを受け付ける', () => {
    expect(meResponseSchema.safeParse({ ...base, best_free_moves: {} }).success).toBe(true)
  })

  it('一部の難易度だけでも受け付ける', () => {
    expect(meResponseSchema.safeParse({ ...base, best_free_moves: { easy: 3 } }).success).toBe(true)
  })

  it('全難易度が揃っていても受け付ける', () => {
    expect(
      meResponseSchema.safeParse({
        ...base,
        best_free_moves: { easy: 3, normal: 5, hard: 9 },
      }).success,
    ).toBe(true)
  })

  it('知らない難易度キーは弾く', () => {
    expect(meResponseSchema.safeParse({ ...base, best_free_moves: { lunatic: 3 } }).success).toBe(
      false,
    )
  })

  it('手数が 0 以下なら弾く', () => {
    expect(meResponseSchema.safeParse({ ...base, best_free_moves: { easy: 0 } }).success).toBe(
      false,
    )
  })
})

describe('hintResponseSchema', () => {
  it('語と比率の組を受け付ける', () => {
    const parsed = hintResponseSchema.safeParse({
      hints: [{ word: '琥珀', ratio: 0.4 }],
      hint_count: 1,
    })
    expect(parsed.success).toBe(true)
  })

  // ヒントが提案する比率も 8 段階でなければ、そのまま打てない。
  it('8 段階にない比率は弾く', () => {
    expect(
      hintResponseSchema.safeParse({ hints: [{ word: '琥珀', ratio: 0.35 }], hint_count: 1 })
        .success,
    ).toBe(false)
  })

  it('語だけの旧形式は弾く', () => {
    expect(hintResponseSchema.safeParse({ hints: ['琥珀'], hint_count: 1 }).success).toBe(false)
  })

  // 候補が全滅したら「効かないヒント」で埋めずに件数を減らす設計なので、空も正当。
  it('空のヒントを受け付ける', () => {
    expect(hintResponseSchema.safeParse({ hints: [], hint_count: 3 }).success).toBe(true)
  })
})
