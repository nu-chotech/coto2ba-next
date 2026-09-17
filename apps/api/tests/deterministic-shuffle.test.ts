/**
 * 決定的シャッフル。
 *
 * ヒントを「ゴールに近い順」に並べると 1 位が常に勝ち確定の手になり、
 * 人は反射的に一番上を押す。そこで並びを崩すが、**毎回変わってはいけない**:
 * - `hint_cache` は `(goal, current)` でキャッシュされ、同じ盤面なら同じヒントが要件
 * - 開き直すたびに並びが変わると探し直しになる
 * - 別の人と並びが違うと不公平
 *
 * よって `Math.random()` は使わず、盤面から作った種で並べ替える。
 */
import { describe, expect, it } from 'vitest'
import { deterministicShuffle } from '../src/lib/random'

const items = ['あ', 'い', 'う', 'え', 'お', 'か']

describe('deterministicShuffle', () => {
  it('同じ種なら何度呼んでも同じ並び', () => {
    const first = deterministicShuffle(items, '温泉 味噌汁')
    for (let i = 0; i < 20; i++) {
      expect(deterministicShuffle(items, '温泉 味噌汁')).toEqual(first)
    }
  })

  it('種が違えば並びが違いうる', () => {
    const orders = new Set(
      ['温泉 味噌汁', '銀河 宇宙', '山林 広域', '利益 枚数'].map((seed) =>
        deterministicShuffle(items, seed).join(''),
      ),
    )
    expect(orders.size).toBeGreaterThan(1)
  })

  it('集合そのものは変わらない（落とさない・増やさない）', () => {
    const shuffled = deterministicShuffle(items, '温泉 味噌汁')
    expect(shuffled).toHaveLength(items.length)
    expect([...shuffled].sort()).toEqual([...items].sort())
  })

  it('入力を破壊しない', () => {
    const input = [...items]
    deterministicShuffle(input, 'なにか')
    expect(input).toEqual(items)
  })

  it('0 件・1 件でも壊れない', () => {
    expect(deterministicShuffle([], 'x')).toEqual([])
    expect(deterministicShuffle(['ひとつ'], 'x')).toEqual(['ひとつ'])
  })

  it('実際に並べ替えている（恒等写像ではない）', () => {
    // 6 件の順列は 720 通り。どの種でも元の順のままなら実装が壊れている。
    const seeds = Array.from({ length: 30 }, (_, i) => `seed-${i}`)
    const changed = seeds.filter(
      (seed) => deterministicShuffle(items, seed).join('') !== items.join(''),
    )
    expect(changed.length).toBeGreaterThan(seeds.length / 2)
  })
})
