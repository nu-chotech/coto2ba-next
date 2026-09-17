/**
 * 図鑑の「経路」まわりの純粋な計算。
 *
 * 描画とカメラは実機でしか確かめられないが、**どの経路を既定で開くか**・
 * **どの点を主役として濃く描くか**・**節に何と添えるか**はここで固定できる。
 * 図鑑の意図（主役は経路）が壊れるとしたらまずここなので、機械で止める。
 */

import { describe, expect, it } from 'vitest'
import { SPACE_GHOST_ALPHA } from '../src/features/collection/constants'
import {
  buildEmphasis,
  defaultPathIndex,
  findPathByGameId,
  pathOptions,
  pathPoints,
  stepLabel,
} from '../src/features/collection/paths'
import type { SpaceNode, SpacePath, SpaceScene } from '../src/features/collection/scene'

const TODAY = '2026-09-17'

function node(word: string, kind: SpaceNode['kind']): SpaceNode {
  return { word, kind, tier: kind === 'ghost' ? null : 'mono', firstSeenAt: null, count: 1 }
}

/**
 * 所持語 3 + ゴール 1 + ゴースト 2 の宇宙。
 * 経路は「所持語 0 → 1 → 2」。
 */
function makeScene(paths: SpacePath[]): SpaceScene {
  const nodes: SpaceNode[] = [
    node('あさ', 'owned'),
    node('ひる', 'owned'),
    node('よる', 'owned'),
    node('ゴール', 'goal'),
    node('', 'ghost'),
    node('', 'ghost'),
  ]
  const count = nodes.length
  const xyz = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    xyz[i * 3] = i
    xyz[i * 3 + 1] = i * 2
    xyz[i * 3 + 2] = i * 3
  }
  const indexByWord = new Map<string, number>()
  nodes.forEach((n, i) => {
    if (n.word.length > 0) indexByWord.set(n.word, i)
  })
  return {
    count,
    interactiveCount: 4,
    xyz,
    rgb: new Float32Array(count * 3),
    // ゴースト点は素の時点で薄い（`buildEmphasis` はこれに掛ける倍率を返す）。
    baseAlpha: Float32Array.from([1, 1, 1, 1, SPACE_GHOST_ALPHA, SPACE_GHOST_ALPHA]),
    sizePt: new Float32Array(count).fill(10),
    nodes,
    indexByWord,
    paths,
    goalIndex: 3,
    ownedCount: 3,
  }
}

function makePath(over: Partial<SpacePath> = {}): SpacePath {
  return {
    gameId: 'g1',
    dailyDate: TODAY,
    moveCount: 2,
    indices: Int32Array.from([0, 1, 2]),
    ...over,
  }
}

describe('pathOptions', () => {
  it('新しい順に並べる（サーバーは古い順で返す）', () => {
    const options = pathOptions(
      [
        makePath({ gameId: 'old', dailyDate: '2026-09-15' }),
        makePath({ gameId: 'new', dailyDate: TODAY }),
      ],
      TODAY,
    )
    expect(options.map((o) => o.gameId)).toEqual(['new', 'old'])
    // index は scene.paths の添字のまま（描画がこれで引ける）。
    expect(options.map((o) => o.index)).toEqual([1, 0])
  })

  it('今日・昨日は相対で、それ以外は日付で呼ぶ', () => {
    const options = pathOptions(
      [
        makePath({ gameId: 'a', dailyDate: TODAY }),
        makePath({ gameId: 'b', dailyDate: '2026-09-16' }),
        makePath({ gameId: 'c', dailyDate: '2026-09-10' }),
      ],
      TODAY,
    )
    const byId = new Map(options.map((o) => [o.gameId, o.label]))
    expect(byId.get('a')).toBe('今日')
    expect(byId.get('b')).toBe('昨日')
    expect(byId.get('c')).toBe('9/10')
  })

  it('デイリーでない対戦はフリーと呼ぶ', () => {
    const [option] = pathOptions([makePath({ dailyDate: null })], TODAY)
    expect(option?.label).toBe('フリー')
  })

  it('手数を添える', () => {
    const [option] = pathOptions([makePath({ moveCount: 4 })], TODAY)
    expect(option?.detail).toBe('4 手')
  })

  it('経路が無ければ空（落ちないこと）', () => {
    expect(pathOptions([], TODAY)).toEqual([])
  })
})

describe('defaultPathIndex / findPathByGameId', () => {
  it('既定はいちばん新しい経路', () => {
    expect(defaultPathIndex([makePath({ gameId: 'old' }), makePath({ gameId: 'new' })])).toBe(1)
  })

  it('経路が無ければ null', () => {
    expect(defaultPathIndex([])).toBeNull()
  })

  it('game_id から引ける。無ければ null', () => {
    const paths = [makePath({ gameId: 'a' }), makePath({ gameId: 'b' })]
    expect(findPathByGameId(paths, 'b')).toBe(1)
    expect(findPathByGameId(paths, 'zzz')).toBeNull()
    expect(findPathByGameId(paths, null)).toBeNull()
  })
})

describe('pathPoints', () => {
  it('経路の順に座標を返す', () => {
    const scene = makeScene([makePath({ indices: Int32Array.from([2, 0]) })])
    expect(pathPoints(scene, 0)).toEqual([
      [2, 4, 6],
      [0, 0, 0],
    ])
  })

  it('選択していなければ空', () => {
    expect(pathPoints(makeScene([makePath()]), null)).toEqual([])
  })

  it('範囲外の添字でも落ちない', () => {
    expect(pathPoints(makeScene([makePath()]), 9)).toEqual([])
  })
})

describe('stepLabel', () => {
  it('最初はスタート、最後は到達、間は手数', () => {
    expect(stepLabel(0, 4)).toBe('スタート')
    expect(stepLabel(1, 4)).toBe('1手目')
    expect(stepLabel(2, 4)).toBe('2手目')
    expect(stepLabel(3, 4)).toBe('到達')
  })

  it('2 点しか無い経路でもスタートと到達', () => {
    expect(stepLabel(0, 2)).toBe('スタート')
    expect(stepLabel(1, 2)).toBe('到達')
  })
})

describe('buildEmphasis', () => {
  const scene = makeScene([makePath()])

  /** 実際に画面に出る濃さ。倍率だけ見ても意味が無い（ゴースト点は素から薄い）。 */
  function effective(target: SpaceScene, alpha: Float32Array, index: number): number {
    return (target.baseAlpha[index] as number) * (alpha[index] as number)
  }

  it('経路を選ぶと、経路の語がいちばん濃く・大きくなる', () => {
    const { alpha, size } = buildEmphasis(scene, 0)
    // 0,1,2 が経路。3 はゴール、4,5 はゴースト。
    expect(effective(scene, alpha, 0)).toBeGreaterThan(effective(scene, alpha, 4))
    expect(size[0]).toBeGreaterThan(size[4] as number)
    expect(size[0]).toBeGreaterThan(1)
  })

  it('経路を選ぶと、経路の外の所持語 → ゴースト点の順に背景へ下がる', () => {
    const many = makeScene([makePath({ indices: Int32Array.from([0, 1]) })])
    const { alpha } = buildEmphasis(many, 0)
    expect(effective(many, alpha, 2)).toBeLessThan(effective(many, alpha, 0))
    expect(effective(many, alpha, 4)).toBeLessThan(effective(many, alpha, 2))
  })

  it('今日のゴールは経路の外でも沈めない', () => {
    const { alpha } = buildEmphasis(scene, 0)
    expect(alpha[3]).toBe(1)
  })

  it('経路を選んでいないときは、ゴースト点を今より少し強く出す（空の画面にしない）', () => {
    const idle = buildEmphasis(scene, null)
    const active = buildEmphasis(scene, 0)
    expect(idle.alpha[4]).toBeGreaterThan(active.alpha[4] as number)
    expect(idle.alpha[0]).toBe(1)
  })

  it('長さは点の数と一致する（バッファの長さが食い違うと描画が壊れる）', () => {
    const { alpha, size } = buildEmphasis(scene, 0)
    expect(alpha.length).toBe(scene.count)
    expect(size.length).toBe(scene.count)
  })

  it('経路が空でも落ちない', () => {
    expect(() => buildEmphasis(makeScene([]), 0)).not.toThrow()
  })
})
