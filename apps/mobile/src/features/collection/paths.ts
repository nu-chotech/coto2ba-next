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
  SPACE_LABEL_MAX_WIDTH,
  SPACE_LABEL_STACK_MAX,
  SPACE_LABEL_STACK_STEP,
  SPACE_LABEL_STEP_CHAR_WIDTH,
  SPACE_LABEL_WORD_CHAR_WIDTH,
  SPACE_OVERVIEW_SAMPLE,
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

/**
 * 経路を新しい順に並べたチップの選択肢。サーバーは古い順で返す。
 *
 * 同じ名前が並ぶとき（フリーを続けて遊ぶと全部「フリー」になる）は
 * **新しいほうから 2, 3 … と番号を振る**。展示では実際に起こる。
 */
export function pathOptions(paths: readonly SpacePath[], today: string): PathOption[] {
  const out: PathOption[] = []
  const seen = new Map<string, number>()
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const path = paths[i] as SpacePath
    const name = pathLabel(path, today)
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    out.push({
      index: i,
      gameId: path.gameId,
      label: count === 1 ? name : `${name} ${count}`,
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

/** ラベルの位置を出すのに要るカメラの値。UI スレッドから JS へ渡る唯一の形。 */
export type CameraSnapshot = {
  yaw: number
  pitch: number
  distance: number
  targetX: number
  targetY: number
  targetZ: number
}

/**
 * 同じカメラか。**厳密一致で見る**（描画は毎フレーム動くので、
 * 「動いていないときだけ再レンダしない」ことだけができればよい）。
 */
export function sameCamera(a: CameraSnapshot, b: CameraSnapshot): boolean {
  // UI スレッドのフレームループから呼ぶので worklet。
  'worklet'
  return (
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    a.distance === b.distance &&
    a.targetX === b.targetX &&
    a.targetY === b.targetY &&
    a.targetZ === b.targetZ
  )
}

/** ラベル 1 枚が画面で占める横幅の見積もり。和文は全角なので字数 × 字幅で足りる。 */
export function labelWidth(word: string, step: string | null): number {
  return Math.min(
    SPACE_LABEL_MAX_WIDTH,
    Math.max(
      word.length * SPACE_LABEL_WORD_CHAR_WIDTH,
      (step?.length ?? 0) * SPACE_LABEL_STEP_CHAR_WIDTH,
    ),
  )
}

export type PlacedBox = {
  x: number
  y: number
  /** ラベルの横幅（衝突判定に使う）。 */
  width: number
}

/**
 * 先に置いたラベルと重なるなら下へずらした y。
 *
 * **実データで必要になった**：「広角レンズ → レンズ」のように 2 手が
 * ほとんど同じ場所に来ると、語も手数も完全に重なって読めない。
 * **消さずにずらす**（自分が作った語が消えるのがいちばん困る）。
 *
 * 重なりは**それぞれのラベルの幅**で見る。固定幅で見ると、十分離れている
 * 短い語まで段下げされて「節の無いところに浮いたラベル」になる。
 * 段を下げたぶんは呼び出し側が引き出し線で節と繋ぐこと。
 */
export function stackLabelY(placed: readonly PlacedBox[], box: PlacedBox): number {
  let candidate = box.y
  for (let guard = 0; guard < SPACE_LABEL_STACK_MAX; guard += 1) {
    let hit = false
    for (const label of placed) {
      if (
        Math.abs(label.x - box.x) < (label.width + box.width) / 2 &&
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

/**
 * 経路のうち、座標を持つ節だけを拾う。
 *
 * **座標の無い語は落とすが、手数の添字は落とさない。** 入力語彙（208,707 語）は
 * 出力語彙（102,520 語）より広く、`GET /api/collection` の出会った語も 2,000 件で
 * 打ち切られるので、経路の語が座標を持たないことは実際に起こる。
 * 添字を詰めると「2手目」が本当は 3 手目になり、**歩いていない直線**が引かれる。
 */
export function pathNodes(
  words: readonly string[],
  indexOfWord: (word: string) => number | undefined,
): { indices: number[]; steps: number[] } {
  const indices: number[] = []
  const steps: number[] = []
  for (let step = 0; step < words.length; step += 1) {
    const index = indexOfWord(words[step] as string)
    if (index === undefined) continue
    indices.push(index)
    steps.push(step)
  }
  return { indices, steps }
}

/**
 * 経路が 1 本も無いときに「宇宙そのもの」を画面に収めるための標本。
 * 全点を渡すと `yawPitchToFace` の総当たりが効かないので、等間隔で間引く。
 */
export function overviewPoints(scene: SpaceScene, sample = SPACE_OVERVIEW_SAMPLE): Vec3[] {
  const out: Vec3[] = []
  if (scene.count === 0) return out
  const stride = Math.max(1, Math.ceil(scene.count / sample))
  for (let i = 0; i < scene.count; i += stride) {
    out.push([
      scene.xyz[i * 3] as number,
      scene.xyz[i * 3 + 1] as number,
      scene.xyz[i * 3 + 2] as number,
    ])
  }
  return out
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
