/**
 * 図鑑に並べる点の組み立て。
 *
 * サーバーの `GET /api/collection`（所持語 + クリア経路）と、端末側のゴースト点から
 * **1 つの平たい配列**を作る。Skia の Atlas に渡すデータは worklet が毎フレーム読むので、
 * オブジェクトの配列ではなく `Float32Array` に詰める
 * （worklet がクロージャに JS 配列を取り込むと毎回ディープコピーされる）。
 *
 * 並び順は「所持語 → ゴール → ゴースト」。前半 `interactiveCount` 件だけが
 * タップ・ラベルの対象になるので、この順序に意味がある。
 *
 * **サーバーが空でも壊れない。** 所持語 0・経路 0 でもゴースト点だけの宇宙が出る。
 */

import type { ClearedPath, CollectionResponse, Encounter, TierId } from '@coto2ba/contracts'
import { parseColor } from '../../theme'
// 図鑑は宇宙なので、ライトモードでも暗いまま（意図的な例外、SPEC §4.3）。
// 点の色はダーク固定の tier パレットから取る。
import { tierPalettes } from '../../theme/tiers'
import {
  SPACE_DOT_GHOST_PT,
  SPACE_DOT_GOAL_PT,
  SPACE_DOT_OWNED_PT,
  SPACE_GHOST_ALPHA,
  SPACE_GHOST_COLOR,
  SPACE_PATH_LIMIT,
} from './constants'
import { getGhostPoints } from './ghost'
import { recentPaths } from './paths'

const BYTE_MAX = 255

export type SpaceNodeKind = 'owned' | 'goal' | 'ghost'

/** JS 側から参照する 1 点のメタ情報（描画には使わない）。 */
export type SpaceNode = {
  word: string
  kind: SpaceNodeKind
  tier: TierId | null
  firstSeenAt: string | null
  count: number
}

export type SpacePath = {
  gameId: string
  dailyDate: string | null
  /**
   * そのゲームの手数。
   * `indices` は座標を持たない語が落ちて短くなることがあるので、
   * 「4 手」の表示には**こちらを使う**（線の点数と手数は別物）。
   */
  moveCount: number
  /** 点のインデックス列（2 点以上のときだけ作る）。 */
  indices: Int32Array
}

export type SpaceScene = {
  /** 点の総数。 */
  count: number
  /** タップ・ラベルの対象になる先頭の件数（所持語 + ゴール）。 */
  interactiveCount: number
  /** `count * 3`。x, y, z。 */
  xyz: Float32Array
  /** `count * 3`。0〜1 の r, g, b。 */
  rgb: Float32Array
  /** `count`。深度フォールオフ前の基準アルファ。 */
  baseAlpha: Float32Array
  /** `count`。基準サイズ（pt）。 */
  sizePt: Float32Array
  nodes: SpaceNode[]
  indexByWord: Map<string, number>
  /** クリア済みの経路。**サーバーが返した順（古い順）のまま**。 */
  paths: SpacePath[]
  /** 今日のゴールの点のインデックス。無ければ -1。 */
  goalIndex: number
  /** 所持語の数（「まだ語に出会っていません」の判定に使う）。 */
  ownedCount: number
}

export type GoalMarker = {
  word: string
  pos3: readonly [number, number, number]
}

type Draft = {
  word: string
  kind: SpaceNodeKind
  tier: TierId | null
  firstSeenAt: string | null
  count: number
  pos: readonly [number, number, number]
  color: string
  alpha: number
  size: number
}

function ownedColor(tier: TierId): string {
  return tierPalettes[tier].accent
}

function encounterDrafts(encounters: readonly Encounter[]): Draft[] {
  const out: Draft[] = []
  for (const encounter of encounters) {
    if (encounter.pos3 === null) continue
    out.push({
      word: encounter.word,
      kind: 'owned',
      tier: encounter.first_tier,
      firstSeenAt: encounter.first_seen_at,
      count: encounter.count,
      pos: encounter.pos3,
      color: ownedColor(encounter.first_tier),
      alpha: 1,
      size: SPACE_DOT_OWNED_PT,
    })
  }
  return out
}

function pathDrafts(
  clearedPaths: readonly ClearedPath[],
  indexByWord: Map<string, number>,
): SpacePath[] {
  const out: SpacePath[] = []
  for (const path of recentPaths(clearedPaths, SPACE_PATH_LIMIT)) {
    const indices: number[] = []
    for (const word of path.words) {
      const index = indexByWord.get(word)
      if (index !== undefined) indices.push(index)
    }
    if (indices.length < 2) continue
    out.push({
      gameId: path.game_id,
      dailyDate: path.daily_date,
      // words は [start, 各手の結果] なので、手数は 1 引いた数。
      moveCount: Math.max(0, path.words.length - 1),
      indices: Int32Array.from(indices),
    })
  }
  return out
}

/**
 * 点を組み立てる。
 * `collection` が undefined（未取得 / 失敗）でもゴースト点だけの宇宙を返す。
 */
export function buildSpaceScene(
  collection: CollectionResponse | undefined,
  goal: GoalMarker | null,
): SpaceScene {
  const drafts: Draft[] = collection === undefined ? [] : encounterDrafts(collection.encounters)
  const ownedCount = drafts.length

  const seen = new Set(drafts.map((draft) => draft.word))

  // 今日のゴール（所持していなければ金の点として足す）。
  let goalIndex = -1
  if (goal !== null) {
    const existing = drafts.findIndex((draft) => draft.word === goal.word)
    if (existing >= 0) {
      goalIndex = existing
      const found = drafts[existing] as Draft
      found.kind = 'goal'
      found.size = SPACE_DOT_GOAL_PT
      found.color = tierPalettes.gold.accent
    } else {
      goalIndex = drafts.length
      drafts.push({
        word: goal.word,
        kind: 'goal',
        tier: 'gold',
        firstSeenAt: null,
        count: 0,
        pos: goal.pos3,
        color: tierPalettes.gold.accent,
        alpha: 1,
        size: SPACE_DOT_GOAL_PT,
      })
      seen.add(goal.word)
    }
  }

  const interactiveCount = drafts.length

  for (const ghost of getGhostPoints()) {
    if (ghost.word.length > 0 && seen.has(ghost.word)) continue
    drafts.push({
      word: ghost.word,
      kind: 'ghost',
      tier: null,
      firstSeenAt: null,
      count: 0,
      pos: ghost.pos3,
      color: SPACE_GHOST_COLOR,
      alpha: SPACE_GHOST_ALPHA,
      size: SPACE_DOT_GHOST_PT,
    })
  }

  const count = drafts.length
  const xyz = new Float32Array(count * 3)
  const rgb = new Float32Array(count * 3)
  const baseAlpha = new Float32Array(count)
  const sizePt = new Float32Array(count)
  const nodes: SpaceNode[] = []
  const indexByWord = new Map<string, number>()

  for (let i = 0; i < count; i += 1) {
    const draft = drafts[i] as Draft
    xyz[i * 3] = draft.pos[0]
    xyz[i * 3 + 1] = draft.pos[1]
    xyz[i * 3 + 2] = draft.pos[2]
    const [r, g, b] = parseColor(draft.color)
    rgb[i * 3] = r / BYTE_MAX
    rgb[i * 3 + 1] = g / BYTE_MAX
    rgb[i * 3 + 2] = b / BYTE_MAX
    baseAlpha[i] = draft.alpha
    sizePt[i] = draft.size
    nodes.push({
      word: draft.word,
      kind: draft.kind,
      tier: draft.tier,
      firstSeenAt: draft.firstSeenAt,
      count: draft.count,
    })
    if (draft.word.length > 0 && !indexByWord.has(draft.word)) indexByWord.set(draft.word, i)
  }

  const paths = collection === undefined ? [] : pathDrafts(collection.cleared_paths, indexByWord)

  return {
    count,
    interactiveCount,
    xyz,
    rgb,
    baseAlpha,
    sizePt,
    nodes,
    indexByWord,
    paths,
    goalIndex,
    ownedCount,
  }
}

/** 検索：前方一致 → 部分一致の順で候補を返す。 */
export function searchScene(scene: SpaceScene, query: string, limit: number): string[] {
  if (query.length === 0) return []
  const prefix: string[] = []
  const partial: string[] = []
  for (const [word] of scene.indexByWord) {
    if (word.startsWith(query)) {
      if (prefix.length < limit) prefix.push(word)
    } else if (word.includes(query) && partial.length < limit) {
      partial.push(word)
    }
    if (prefix.length >= limit) break
  }
  return [...prefix, ...partial].slice(0, limit)
}
