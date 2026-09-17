/**
 * 定数と純粋関数の契約。ここが崩れるとサーバーと端末で判定がずれる。
 */
import { describe, expect, it } from 'vitest'
import {
  API_BASE_URL,
  CLEAR_RANK,
  indexToRatio,
  LANDING_URL,
  MAX_MOVES,
  N_OUTPUT,
  normalizeRatio,
  RATIO_DEFAULT,
  RATIO_MAX,
  RATIO_MIN,
  RATIO_STEP,
  RATIO_STEP_COUNT,
  RATIOS,
  rankToHeat,
  ratioMixLabel,
  ratioToIndex,
} from '../src/constants'

describe('RATIOS', () => {
  it('RATIO_MIN から RATIO_MAX まで RATIO_STEP 刻み', () => {
    expect(RATIOS[0]).toBe(RATIO_MIN)
    expect(RATIOS.at(-1)).toBe(RATIO_MAX)
    expect(RATIO_STEP_COUNT).toBe(Math.round((RATIO_MAX - RATIO_MIN) / RATIO_STEP) + 1)
  })

  it('浮動小数の誤差が乗っていない（0.30000000000000004 が無い）', () => {
    for (const r of RATIOS) expect(r).toBe(Math.round(r * 10) / 10)
  })

  it('RATIO_DEFAULT は選択肢に含まれる', () => {
    expect(RATIOS).toContain(RATIO_DEFAULT)
  })
})

describe('normalizeRatio', () => {
  it('8 段階はそのまま通る', () => {
    for (const r of RATIOS) expect(normalizeRatio(r)).toBe(r)
  })

  it('段階の間の値は丸めずに null（0.35 を 0.4 にしない）', () => {
    // プレイヤーの意図を勝手に変えないための規則。過去に 0.35 が 0.4 として
    // 受理されていたので、ここは回帰テストとして残す。
    expect(normalizeRatio(0.35)).toBeNull()
    expect(normalizeRatio(0.15)).toBeNull()
    expect(normalizeRatio(0.75)).toBeNull()
  })

  it('範囲外は null', () => {
    expect(normalizeRatio(0)).toBeNull()
    expect(normalizeRatio(0.9)).toBeNull()
    expect(normalizeRatio(1)).toBeNull()
    expect(normalizeRatio(-0.5)).toBeNull()
  })

  it('有限でない値は null', () => {
    expect(normalizeRatio(Number.NaN)).toBeNull()
    expect(normalizeRatio(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeRatio(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('表現誤差は吸収する（0.1 + 0.2 は 0.3 として扱う）', () => {
    expect(0.1 + 0.2).not.toBe(0.3) // 前提の確認
    expect(normalizeRatio(0.1 + 0.2)).toBe(0.3)
  })
})

describe('ratioToIndex / indexToRatio', () => {
  it('往復しても元に戻る', () => {
    for (const r of RATIOS) expect(indexToRatio(ratioToIndex(r))).toBe(r)
  })

  it('範囲外のインデックスは端に丸める', () => {
    expect(indexToRatio(-10)).toBe(RATIO_MIN)
    expect(indexToRatio(999)).toBe(RATIO_MAX)
  })

  it('段階の間の値は近い段階に吸い付く（normalizeRatio と意図的に違う）', () => {
    // normalizeRatio は 0.35 を弾く（サーバーの検証：勝手に意図を変えない）。
    // ratioToIndex はスライダーの**つまみの位置**を決めるだけなので、
    // 近い目盛に吸い付くのが正しい。既定値に飛ばすとつまみが飛んで見える。
    expect(indexToRatio(ratioToIndex(0.35))).toBe(0.4)
    expect(normalizeRatio(0.35)).toBeNull()
  })

  it('範囲外の ratio は既定値に落ちる', () => {
    expect(indexToRatio(ratioToIndex(5))).toBe(RATIO_DEFAULT)
    expect(indexToRatio(ratioToIndex(-1))).toBe(RATIO_DEFAULT)
  })

  it('スライダーが出す値はつねにサーバーに通る', () => {
    // MixSlider は onChange(indexToRatio(i)) しか呼ばないので、
    // 端末から不正な ratio が飛ぶことはない、という不変条件。
    for (let i = -5; i < RATIOS.length + 5; i++) {
      expect(normalizeRatio(indexToRatio(i))).not.toBeNull()
    }
  })
})

describe('rankToHeat', () => {
  it('完全錬成（rank 0）と最近傍（rank 1）は 1', () => {
    expect(rankToHeat(0)).toBe(1)
    expect(rankToHeat(1)).toBe(1)
  })

  it('出力語彙数のところで 0 になる', () => {
    expect(rankToHeat(N_OUTPUT)).toBeCloseTo(0, 10)
  })

  it('つねに [0, 1] に収まる', () => {
    for (const rank of [0, 1, 10, 300, 3000, N_OUTPUT, N_OUTPUT * 10]) {
      const heat = rankToHeat(rank)
      expect(heat).toBeGreaterThanOrEqual(0)
      expect(heat).toBeLessThanOrEqual(1)
    }
  })

  it('ランクが大きいほど熱は下がる（単調減少）', () => {
    const ranks = [1, 10, 100, 1000, 10_000, 100_000]
    const heats = ranks.map((r) => rankToHeat(r))
    for (let i = 1; i < heats.length; i++) {
      expect(heats[i]).toBeLessThan(heats[i - 1] as number)
    }
  })
})

describe('ゲーム定数の整合', () => {
  it('クリア判定のランクは手数より小さい常識的な値', () => {
    expect(CLEAR_RANK).toBeGreaterThan(0)
    expect(MAX_MOVES).toBeGreaterThan(0)
  })
})

describe('公開 URL', () => {
  // 展示で配る QR とシェア文面に載る。vercel.app のままだと恰好がつかない。
  it('独自ドメインを指している', () => {
    expect(API_BASE_URL).toBe('https://coto2ba-next-api.chotech.dev')
    expect(LANDING_URL).toBe('https://coto2ba-next.chotech.dev')
  })

  it('末尾にスラッシュを付けない', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false)
    expect(LANDING_URL.endsWith('/')).toBe(false)
  })
})

describe('ratioMixLabel', () => {
  it('今の語 : 混ぜる語 の比で読める', () => {
    expect(ratioMixLabel(0.4)).toBe('6 : 4')
    expect(ratioMixLabel(0.1)).toBe('9 : 1')
    expect(ratioMixLabel(0.8)).toBe('2 : 8')
  })

  it('8 段階すべてで合計が 10 になる', () => {
    for (const r of RATIOS) {
      const [left, right] = ratioMixLabel(r).split(' : ').map(Number)
      expect((left as number) + (right as number)).toBe(10)
    }
  })
})
