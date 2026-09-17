/**
 * 図鑑の「経路」の選び方と見せ方（SPEC §7 / 図鑑の再設計）。
 *
 * この画面の主役は点群ではなく **自分が歩いた軌跡**なので、
 * 「どれを開くか」「どの点を濃く描くか」「節に何と添えるか」をここに集める。
 * すべて純粋関数（テストで固定してある）。
 *
 * `scene.ts` からは **型だけ**を取る。`scene.ts` は語彙 JSON を読み込むので、
 * 値として import するとテストから触れなくなる。
 */

import { formatJstShortDate, relativeDateLabel } from '../ranking/dates'
import {
  SPACE_EMPHASIS_GHOST_ACTIVE,
  SPACE_EMPHASIS_GHOST_IDLE,
  SPACE_EMPHASIS_OFF_PATH_ALPHA,
  SPACE_EMPHASIS_PATH_SIZE,
  SPACE_LABEL_COLLIDE_WIDTH,
  SPACE_LABEL_STACK_MAX,
  SPACE_LABEL_STACK_STEP,
} from './constants'
import type { Vec3 } from './framing'
import type { SpacePath, SpaceScene } from './scene'

export type PathOption = {
  /** `scene.paths` の添字。描画・フレーミングはこれで引く。 */
  index: number
  gameId: string
  /** チップに出す短い名前（今日 / 昨日 / 9/16 / フリー）。 */
  label: string
  /** 補足（`4 手`）。 */
  detail: string
}

/**
 * 描く経路を上限まで絞る。**残すのは新しいほう。**
 * サーバーは古い順で返すので、前から取るとクリアが上限を超えた人の
 * 「いちばん新しい軌跡」が消える（既定で開く軌跡がそれなので致命的）。
 */
export function recentPaths<T>(paths: readonly T[], limit: number): readonly T[] {
  return paths.length <= limit ? paths : paths.slice(paths.length - limit)
}

/** 経路を新しい順に並べたチップの選択肢。サーバーは古い順で返す。 */
export function pathOptions(paths: readonly SpacePath[], today: string): PathOption[] {
  const out: PathOption[] = []
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const path = paths[i] as SpacePath
    out.push({
      index: i,
      gameId: path.gameId,
      label: pathLabel(path, today),
      detail: `${path.moveCount} 手`,
    })
  }
  return out
}

function pathLabel(path: SpacePath, today: string): string {
  if (path.dailyDate === null) return 'フリー'
  return relativeDateLabel(path.dailyDate, today) ?? formatJstShortDate(path.dailyDate)
}

/** 既定で開く経路（いちばん新しいクリア）。1 つも無ければ null。 */
export function defaultPathIndex(paths: readonly SpacePath[]): number | null {
  return paths.length === 0 ? null : paths.length - 1
}

/** `?game=<id>` から経路を引く。見つからなければ null。 */
export function findPathByGameId(
  paths: readonly SpacePath[],
  gameId: string | null,
): number | null {
  if (gameId === null || gameId.length === 0) return null
  const found = paths.findIndex((path) => path.gameId === gameId)
  return found < 0 ? null : found
}

/** その経路の点の座標（カメラのフレーミングに渡す）。 */
export function pathPoints(scene: SpaceScene, pathIndex: number | null): Vec3[] {
  if (pathIndex === null) return []
  const path = scene.paths[pathIndex]
  if (path === undefined) return []
  const out: Vec3[] = []
  for (let k = 0; k < path.indices.length; k += 1) {
    const index = path.indices[k] as number
    out.push([
      scene.xyz[index * 3] as number,
      scene.xyz[index * 3 + 1] as number,
      scene.xyz[index * 3 + 2] as number,
    ])
  }
  return out
}

/** 節に添える順番（`スタート` / `2手目` / `到達`）。 */
export function stepLabel(step: number, total: number): string {
  if (step <= 0) return 'スタート'
  if (step >= total - 1) return '到達'
  return `${step}手目`
}

/**
 * 先に置いたラベルと重なるなら下へずらした y。
 *
 * **実データで必要になった**：「広角レンズ → レンズ」のように 2 手が
 * ほとんど同じ場所に来ると、語も手数も完全に重なって読めない。
 * **消さずにずらす**（自分が作った語が消えるのがいちばん困る）。
 */
export function stackLabelY(
  placed: readonly { x: number; y: number }[],
  x: number,
  y: number,
): number {
  let candidate = y
  for (let guard = 0; guard < SPACE_LABEL_STACK_MAX; guard += 1) {
    let hit = false
    for (const label of placed) {
      if (
        Math.abs(label.x - x) < SPACE_LABEL_COLLIDE_WIDTH &&
        Math.abs(label.y - candidate) < SPACE_LABEL_STACK_STEP
      ) {
        hit = true
        break
      }
    }
    if (!hit) break
    candidate += SPACE_LABEL_STACK_STEP
  }
  return candidate
}

export type SpaceEmphasis = {
  /** 点ごとのアルファ倍率。 */
  alpha: Float32Array
  /** 点ごとのサイズ倍率。 */
  size: Float32Array
}

/**
 * 主役（選択中の経路）と背景（それ以外）の重みづけ。
 *
 * 長さは `scene.count` に必ず揃える。worklet が添字で引くので、
 * 食い違うと点の色と位置がずれる。
 */
export function buildEmphasis(scene: SpaceScene, activePathIndex: number | null): SpaceEmphasis {
  const alpha = new Float32Array(scene.count).fill(1)
  const size = new Float32Array(scene.count).fill(1)

  const active = activePathIndex === null ? undefined : scene.paths[activePathIndex]
  const ghostMul = active === undefined ? SPACE_EMPHASIS_GHOST_IDLE : SPACE_EMPHASIS_GHOST_ACTIVE

  // ゴースト点（interactiveCount 以降）は常に背景。
  for (let i = scene.interactiveCount; i < scene.count; i += 1) alpha[i] = ghostMul

  if (active === undefined) return { alpha, size }

  // 経路を選んでいる間は、経路の外の所持語を引く。今日のゴールは沈めない。
  for (let i = 0; i < scene.interactiveCount; i += 1) {
    alpha[i] = i === scene.goalIndex ? 1 : SPACE_EMPHASIS_OFF_PATH_ALPHA
  }
  for (let k = 0; k < active.indices.length; k += 1) {
    const index = active.indices[k] as number
    if (index < 0 || index >= scene.count) continue
    alpha[index] = 1
    size[index] = SPACE_EMPHASIS_PATH_SIZE
  }

  return { alpha, size }
}
