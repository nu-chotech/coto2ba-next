/**
 * 図鑑の「経路」まわりの純粋な計算。
 *
 * 描画とカメラは実機でしか確かめられないが、**どの経路を既定で開くか**・
 * **どの点を主役として濃く描くか**・**節に何と添えるか**はここで固定できる。
 * 図鑑の意図（主役は経路）が壊れるとしたらまずここなので、機械で止める。
 */

import { describe, expect, it } from 'vitest'
import {
  SPACE_GHOST_ALPHA,
  SPACE_LABEL_MAX_WIDTH,
  SPACE_LABEL_STACK_MAX,
  SPACE_LABEL_STACK_STEP,
  SPACE_PATH_LIMIT,
} from '../src/features/collection/constants'
import {
  buildEmphasis,
  defaultPathIndex,
  findPathByGameId,
  labelWidth,
  overviewPoints,
  pathNodes,
  pathOptions,
  pathPoints,
  recentPaths,
  sameCamera,
  selectPath,
  stackLabelY,
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
    steps: Int32Array.from([0, 1, 2]),
    totalSteps: 3,
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

/**
 * 結果画面の「この軌跡を見る」から `?game=<id>` で入ってくる経路の決め方。
 *
 * **黙って別の軌跡に落ちないこと。** 図鑑に残るのはクリアした挑戦だけなので、
 * ギブアップした挑戦を指されると必ず外れる。以前はそのまま
 * 「いちばん新しいクリア」を開いていて、来場者には**自分の別の試合の軌跡**が
 * 何の説明もなく出ていた。
 */
describe('selectPath', () => {
  it('指した軌跡があればそれを開く', () => {
    const paths = [makePath({ gameId: 'a' }), makePath({ gameId: 'b' })]
    expect(selectPath(paths, 'b')).toEqual({ index: 1, fellBack: false })
  })

  it('何も指していなければ、いちばん新しい軌跡（落ちたとは言わない）', () => {
    const paths = [makePath({ gameId: 'a' }), makePath({ gameId: 'b' })]
    expect(selectPath(paths, null)).toEqual({ index: 1, fellBack: false })
  })

  it('指した軌跡が無ければ、落ちたことが分かる形で返す', () => {
    const paths = [makePath({ gameId: 'a' }), makePath({ gameId: 'b' })]
    expect(selectPath(paths, 'gave-up')).toEqual({ index: 1, fellBack: true })
  })

  it('軌跡が 1 本も無いのに指されたときも、落ちたことが分かる', () => {
    expect(selectPath([], 'gave-up')).toEqual({ index: null, fellBack: true })
  })

  it('軌跡が 1 本も無く、何も指していなければ落ちていない', () => {
    expect(selectPath([], null)).toEqual({ index: null, fellBack: false })
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

describe('recentPaths', () => {
  it('上限を超えたら**新しいほうを残す**（いちばん新しい軌跡が消えない）', () => {
    // サーバーは古い順で返す。上限 + 2 本ぶん作って、残るのが後ろ側か見る。
    const many = Array.from({ length: SPACE_PATH_LIMIT + 2 }, (_, i) => `g${i}`)
    const kept = recentPaths(many, SPACE_PATH_LIMIT)
    expect(kept.length).toBe(SPACE_PATH_LIMIT)
    expect(kept[kept.length - 1]).toBe(`g${SPACE_PATH_LIMIT + 1}`)
    expect(kept[0]).toBe('g2')
  })

  it('上限以下ならそのまま', () => {
    const few = ['a', 'b']
    expect(recentPaths(few, SPACE_PATH_LIMIT)).toEqual(few)
  })
})

describe('stackLabelY', () => {
  const box = (x: number, y: number, width = 60) => ({ x, y, width })

  it('誰とも重ならなければそのまま', () => {
    expect(stackLabelY([box(300, 100)], box(10, 100))).toBe(100)
  })

  it('重なったら下へずらす（実データの「広角レンズ → レンズ」）', () => {
    const y = stackLabelY([box(100, 200)], box(102, 201))
    expect(y).toBeGreaterThan(201)
  })

  it('十分離れていれば、幅が狭いラベルはずらさない（浮いたラベルを作らない）', () => {
    // 「投影」(34) と「広角レンズ」(85) は 87pt 離れていれば重ならない。
    const left = { x: 150, y: 400, width: labelWidth('投影', 'スタート') }
    const right = { x: 237, y: 400, width: labelWidth('広角レンズ', '1手目') }
    expect(stackLabelY([left], right)).toBe(400)
  })

  it('何段も重なっても上限で止める（画面外まで落とさない）', () => {
    const placed = [box(100, 200), box(100, 234), box(100, 268), box(100, 302), box(100, 336)]
    const y = stackLabelY(placed, box(100, 200))
    expect(y).toBeLessThanOrEqual(200 + SPACE_LABEL_STACK_STEP * SPACE_LABEL_STACK_MAX)
  })
})

describe('labelWidth', () => {
  it('和文は字数ぶんの幅になる', () => {
    expect(labelWidth('投影', null)).toBeLessThan(labelWidth('広角レンズ', null))
  })

  it('手数のほうが長ければそちらで見る', () => {
    expect(labelWidth('窓', 'スタート')).toBeGreaterThan(labelWidth('窓', null))
  })

  it('ラベルの最大幅を超えない', () => {
    expect(labelWidth('あ'.repeat(30), null)).toBeLessThanOrEqual(SPACE_LABEL_MAX_WIDTH)
  })
})

describe('pathNodes（座標を持たない語が混ざる経路）', () => {
  const index = new Map([
    ['あさ', 0],
    ['よる', 2],
  ])
  const words = ['あさ', 'ひる', 'よる']

  it('座標の無い語は落とすが、**手数の添字は落とさない**', () => {
    const { indices, steps } = pathNodes(words, (word) => index.get(word))
    expect(indices).toEqual([0, 2])
    // 「ひる」が 1手目。よるは 2手目のまま（詰めると 1手目になってしまう）。
    expect(steps).toEqual([0, 2])
  })

  it('落ちた語をまたぐところは「歩いた」と見なせない（添字が飛ぶ）', () => {
    const { steps } = pathNodes(words, (word) => index.get(word))
    expect((steps[1] as number) - (steps[0] as number)).toBeGreaterThan(1)
  })

  it('全部そろっていれば添字は連番', () => {
    const full = new Map([
      ['あさ', 0],
      ['ひる', 1],
      ['よる', 2],
    ])
    expect(pathNodes(words, (w) => full.get(w)).steps).toEqual([0, 1, 2])
  })
})

describe('stepLabel（落ちた語があっても手数がずれない）', () => {
  it('元の添字と元の長さで数える', () => {
    // 4 手の経路で 2 番目が落ちた場合。残った 3 番目は「2手目」のまま。
    expect(stepLabel(2, 5)).toBe('2手目')
    expect(stepLabel(4, 5)).toBe('到達')
  })
})

describe('overviewPoints', () => {
  it('経路が無いときに宇宙そのものを収めるための標本を返す', () => {
    const scene = makeScene([])
    const points = overviewPoints(scene, 3)
    expect(points.length).toBeGreaterThan(0)
    expect(points.length).toBeLessThanOrEqual(scene.count)
    expect(points[0]).toEqual([0, 0, 0])
  })

  it('点が無ければ空（落ちないこと）', () => {
    const empty = { ...makeScene([]), count: 0 }
    expect(overviewPoints(empty, 8)).toEqual([])
  })
})

describe('sameCamera', () => {
  const base = { yaw: 1, pitch: 0.2, distance: 2, targetX: 0.1, targetY: 0.2, targetZ: 0.3 }

  it('同じなら true（動いていないときに再レンダしないため）', () => {
    expect(sameCamera(base, { ...base })).toBe(true)
  })

  it('注視点だけ動いても false（経路を切り替えた瞬間がこれ）', () => {
    expect(sameCamera(base, { ...base, targetZ: 0.31 })).toBe(false)
  })

  it('どの成分が動いても気づく', () => {
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      expect(sameCamera(base, { ...base, [key]: base[key] + 1 })).toBe(false)
    }
  })
})

describe('pathOptions（同じ名前が並ぶとき）', () => {
  it('フリーが続いたら新しいほうから番号を振る', () => {
    const options = pathOptions(
      [
        makePath({ gameId: 'old', dailyDate: null, moveCount: 3 }),
        makePath({ gameId: 'mid', dailyDate: null, moveCount: 3 }),
        makePath({ gameId: 'new', dailyDate: null, moveCount: 3 }),
      ],
      TODAY,
    )
    expect(options.map((o) => o.label)).toEqual(['フリー', 'フリー 2', 'フリー 3'])
    expect(options.map((o) => o.gameId)).toEqual(['new', 'mid', 'old'])
  })

  it('名前が違えば番号は付かない', () => {
    const options = pathOptions(
      [makePath({ dailyDate: '2026-09-16' }), makePath({ dailyDate: TODAY })],
      TODAY,
    )
    expect(options.map((o) => o.label)).toEqual(['今日', '昨日'])
  })
})
