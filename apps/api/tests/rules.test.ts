import {
  CLEAR_RANK,
  MAX_MOVES,
  normalizeRatio,
  normalizeWord,
  RATIOS,
  rankToHeat,
  tierForRank,
} from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import {
  applyMove,
  compareLeaderboard,
  movesLeft,
  updateBestFreeMoves,
  validateMove,
} from '../src/services/rules'

const base = {
  status: 'playing' as const,
  goal: '蚕',
  current: '絹',
  inputInVocab: null,
}

describe('ratio の検証（SPEC §5.3-2）', () => {
  it('8 段階は 0.1 から 0.8 の 8 個', () => {
    expect(RATIOS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
  })

  it.each(RATIOS)('%s は通る', (r) => {
    expect(normalizeRatio(r)).toBe(r)
  })

  it('浮動小数の表現誤差は吸収する', () => {
    expect(normalizeRatio(0.1 + 0.2)).toBe(0.3)
  })

  it.each([0, 0.05, 0.35, 0.9, 1, -0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    '%s は弾く（丸めない）',
    (r) => {
      expect(normalizeRatio(r)).toBeNull()
    },
  )

  it('0.35 を 0.4 に丸めない（プレイヤーの意図を変えない）', () => {
    const res = validateMove({ ...base, rawInput: '糸', ratio: 0.35 })
    expect(res).toEqual({ ok: false, code: 'INVALID_RATIO' })
  })
})

describe('禁止入力（SPEC §5.3-4）', () => {
  it('ゴール語そのものは弾く', () => {
    expect(validateMove({ ...base, rawInput: '蚕', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'GOAL_INPUT',
    })
  })

  it('現在の語と同じものは弾く', () => {
    expect(validateMove({ ...base, rawInput: '絹', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'SAME_AS_CURRENT',
    })
  })

  it('語彙に無いものは弾く', () => {
    expect(
      validateMove({ ...base, rawInput: 'ぎゃぴぴぴ', ratio: 0.5, inputInVocab: false }),
    ).toEqual({ ok: false, code: 'OOV' })
  })

  it('空文字は OOV', () => {
    expect(validateMove({ ...base, rawInput: '   ', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'OOV',
    })
  })

  it('終了したゲームには打てない', () => {
    expect(validateMove({ ...base, status: 'cleared', rawInput: '糸', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'GAME_FINISHED',
    })
    expect(validateMove({ ...base, status: 'gave_up', rawInput: '糸', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'GAME_FINISHED',
    })
  })

  it('正規化してから判定する（全角・NFKC・空白）', () => {
    // 全角の「蚕」は NFKC で同じ文字なので GOAL_INPUT になる
    expect(validateMove({ ...base, rawInput: ' 蚕 ', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'GOAL_INPUT',
    })
  })

  it('正常な入力は正規化した語と ratio を返す', () => {
    expect(validateMove({ ...base, rawInput: ' 糸 ', ratio: 0.3 })).toEqual({
      ok: true,
      input: '糸',
      ratio: 0.3,
    })
  })

  it('判定順序: ratio が先、禁止入力が後', () => {
    // goal と同じ語でも ratio が不正ならまず INVALID_RATIO
    expect(validateMove({ ...base, rawInput: '蚕', ratio: 0.99 })).toEqual({
      ok: false,
      code: 'INVALID_RATIO',
    })
  })
})

describe('語の正規化', () => {
  it('全角英数を半角にする', () => {
    expect(normalizeWord('ＡＢＣ１２３')).toBe('ABC123')
  })
  it('半角カナを全角にする', () => {
    expect(normalizeWord('ｶﾞｯｷ')).toBe('ガッキ')
  })
  it('内部の空白を落とす', () => {
    expect(normalizeWord('宇宙 飛行士')).toBe('宇宙飛行士')
  })
  it('前後の空白を落とす', () => {
    expect(normalizeWord('  蚕  ')).toBe('蚕')
  })
})

describe('クリア判定と 20 手ギブアップ（SPEC §5.3-9）', () => {
  it(`rank <= ${CLEAR_RANK} でクリア`, () => {
    expect(applyMove(3, CLEAR_RANK).status).toBe('cleared')
    expect(applyMove(3, 1).status).toBe('cleared')
    expect(applyMove(3, 0).status).toBe('cleared')
  })

  it(`rank > ${CLEAR_RANK} なら継続`, () => {
    expect(applyMove(3, CLEAR_RANK + 1).status).toBe('playing')
  })

  it('rank 0 は完全錬成', () => {
    expect(applyMove(3, 0).perfect).toBe(true)
    expect(applyMove(3, 1).perfect).toBe(false)
  })

  it(`${MAX_MOVES} 手目でクリアできなければ自動ギブアップ`, () => {
    expect(applyMove(MAX_MOVES - 1, 5000).status).toBe('gave_up')
    expect(applyMove(MAX_MOVES - 1, 5000).moveCount).toBe(MAX_MOVES)
  })

  it(`${MAX_MOVES} 手目でもクリアならクリアが優先`, () => {
    expect(applyMove(MAX_MOVES - 1, 3).status).toBe('cleared')
  })

  it('手数は必ず 1 増える', () => {
    expect(applyMove(0, 100).moveCount).toBe(1)
    expect(applyMove(7, 100).moveCount).toBe(8)
  })

  it('残り手数', () => {
    expect(movesLeft(0)).toBe(MAX_MOVES)
    expect(movesLeft(MAX_MOVES)).toBe(0)
    expect(movesLeft(MAX_MOVES + 5)).toBe(0)
  })
})

describe('演出帯（SPEC §5.5）', () => {
  it.each([
    [0, 'gold'],
    [1, 'gold'],
    [10, 'gold'],
    [11, 'cosmos'],
    [300, 'cosmos'],
    [301, 'color'],
    [3000, 'color'],
    [3001, 'mono'],
    [99999, 'mono'],
  ])('rank %i → %s', (rank, tier) => {
    expect(tierForRank(rank)).toBe(tier)
  })
})

describe('温度（対数変換）', () => {
  it('rank 0（完全錬成）は 1', () => {
    expect(rankToHeat(0)).toBe(1)
  })
  it('rank 1 は 1', () => {
    expect(rankToHeat(1)).toBe(1)
  })
  it('rank が大きいほど小さい', () => {
    expect(rankToHeat(10)).toBeGreaterThan(rankToHeat(100))
    expect(rankToHeat(100)).toBeGreaterThan(rankToHeat(10000))
  })
  it('0〜1 の範囲に収まる', () => {
    for (const r of [0, 1, 10, 1000, 99805, 1_000_000]) {
      expect(rankToHeat(r)).toBeGreaterThanOrEqual(0)
      expect(rankToHeat(r)).toBeLessThanOrEqual(1)
    }
  })
})

describe('ランキングの並び順（SPEC §5.8）', () => {
  const a = { moveCount: 5, hintCount: 0, clearedAt: '2026-09-17T01:00:00Z' }

  it('手数が少ないほうが上', () => {
    expect(compareLeaderboard(a, { ...a, moveCount: 6 })).toBeLessThan(0)
  })
  it('手数が同じならヒントが少ないほうが上', () => {
    expect(compareLeaderboard(a, { ...a, hintCount: 1 })).toBeLessThan(0)
  })
  it('手数もヒントも同じならクリアが早いほうが上', () => {
    expect(compareLeaderboard(a, { ...a, clearedAt: '2026-09-17T02:00:00Z' })).toBeLessThan(0)
  })
  it('完全に同値なら 0', () => {
    expect(compareLeaderboard(a, { ...a })).toBe(0)
  })
  it('並べ替えると仕様通りの順になる', () => {
    const rows = [
      { moveCount: 6, hintCount: 0, clearedAt: '2026-09-17T01:00:00Z', id: 'c' },
      { moveCount: 5, hintCount: 1, clearedAt: '2026-09-17T01:00:00Z', id: 'b' },
      { moveCount: 5, hintCount: 0, clearedAt: '2026-09-17T03:00:00Z', id: 'a' },
    ]
    expect(rows.sort(compareLeaderboard).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('フリーモードの自己ベスト（SPEC §5.7）', () => {
  it('初回は記録される', () => {
    expect(updateBestFreeMoves({}, 'normal', 8)).toEqual({ normal: 8 })
  })
  it('更新されるのは縮んだときだけ', () => {
    expect(updateBestFreeMoves({ normal: 8 }, 'normal', 6)).toEqual({ normal: 6 })
    expect(updateBestFreeMoves({ normal: 6 }, 'normal', 9)).toEqual({ normal: 6 })
  })
  it('難易度ごとに独立', () => {
    expect(updateBestFreeMoves({ normal: 6 }, 'hard', 12)).toEqual({ normal: 6, hard: 12 })
  })
})

describe('ゴールに近すぎる語の禁止（デイリーのランキングを守るため）', () => {
  const withBan = { ...base, forbiddenInputs: ['絹糸', '養蚕', '桑'] }

  it('ゴール近傍の語は弾く', () => {
    expect(validateMove({ ...withBan, rawInput: '養蚕', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'TOO_CLOSE_TO_GOAL',
    })
  })

  it('近傍でない語は通る', () => {
    expect(validateMove({ ...withBan, rawInput: '糸', ratio: 0.5 })).toEqual({
      ok: true,
      input: '糸',
      ratio: 0.5,
    })
  })

  it('正規化してから判定する', () => {
    expect(validateMove({ ...withBan, rawInput: ' 養蚕 ', ratio: 0.5 })).toEqual({
      ok: false,
      code: 'TOO_CLOSE_TO_GOAL',
    })
  })

  it('禁止リストが無ければ何も起きない', () => {
    expect(validateMove({ ...base, rawInput: '養蚕', ratio: 0.5 })).toEqual({
      ok: true,
      input: '養蚕',
      ratio: 0.5,
    })
  })

  it('ゴール語そのものの判定が優先される', () => {
    expect(
      validateMove({ ...withBan, forbiddenInputs: ['蚕', '養蚕'], rawInput: '蚕', ratio: 0.5 }),
    ).toEqual({ ok: false, code: 'GOAL_INPUT' })
  })
})
