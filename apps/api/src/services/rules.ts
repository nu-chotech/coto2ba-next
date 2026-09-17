/**
 * ゲームのルール（純粋関数）。DB に触れない。vitest でここを厚くテストする。
 * SPEC §5.3 の 1 手の処理のうち、判定にあたる部分。
 */
import {
  CLEAR_RANK,
  DIFFICULTIES,
  type Difficulty,
  type ErrorCode,
  type FreeBest,
  type GameStatus,
  MAX_MOVES,
  normalizeRatio,
  normalizeWord,
  PERFECT_RANK,
  type TierId,
  tierForRank,
} from '@coto2ba/contracts'

export interface MoveValidationInput {
  status: GameStatus
  goal: string
  current: string
  /** 正規化前の生入力 */
  rawInput: string
  ratio: number
  /** vocab に存在し is_input=true か。null は未検証（呼び出し側で引く） */
  inputInVocab: boolean | null
  /** ゴールに近すぎて使えない語（games.forbidden_inputs）。 */
  forbiddenInputs?: readonly string[]
}

export interface MoveValidationOk {
  ok: true
  input: string
  ratio: number
}

export interface MoveValidationErr {
  ok: false
  code: ErrorCode
}

/**
 * 1 手の入力検証。SPEC §5.3 の 1〜4。
 * 判定順序は仕様通り: 進行中 → ratio → 正規化 → 禁止入力。
 */
export function validateMove(input: MoveValidationInput): MoveValidationOk | MoveValidationErr {
  if (input.status !== 'playing') return { ok: false, code: 'GAME_FINISHED' }

  const ratio = normalizeRatio(input.ratio)
  if (ratio === null) return { ok: false, code: 'INVALID_RATIO' }

  const word = normalizeWord(input.rawInput)
  if (word.length === 0) return { ok: false, code: 'OOV' }
  if (word === input.goal) return { ok: false, code: 'GOAL_INPUT' }
  if (word === input.current) return { ok: false, code: 'SAME_AS_CURRENT' }
  if (input.forbiddenInputs?.includes(word)) return { ok: false, code: 'TOO_CLOSE_TO_GOAL' }
  if (input.inputInVocab === false) return { ok: false, code: 'OOV' }

  return { ok: true, input: word, ratio }
}

export interface MoveOutcome {
  rank: number
  tier: TierId
  perfect: boolean
  status: GameStatus
  moveCount: number
}

/**
 * 1 手打った後のゲーム状態。SPEC §5.3 の 9。
 * - rank <= CLEAR_RANK → cleared
 * - そうでなく move_count >= MAX_MOVES → gave_up（自動）
 */
export function applyMove(prevMoveCount: number, rank: number): MoveOutcome {
  const moveCount = prevMoveCount + 1
  const perfect = rank === PERFECT_RANK
  let status: GameStatus = 'playing'
  if (rank <= CLEAR_RANK) status = 'cleared'
  else if (moveCount >= MAX_MOVES) status = 'gave_up'
  return { rank, tier: tierForRank(rank), perfect, status, moveCount }
}

/** 残り手数。 */
export function movesLeft(moveCount: number): number {
  return Math.max(0, MAX_MOVES - moveCount)
}

/**
 * ランキングの並び順（SPEC §5.8）。**ヒント数 → 手数 → クリア時刻。** 同値なら 0。
 *
 * ヒント数が一番外側にあるので、**ヒントを 1 回でも使った人はノーヒントの全員より下**になる。
 * ヒントを外挿にしたらゴールの目前まで運べる強さになったため、ヒントを人工的に弱めるのではなく
 * ランキングで課金する形にした（docs/QUESTIONS.md）。
 *
 * **ここを変えたら `game.ts` の leaderboard の ORDER BY も変えること。**
 * 実際の順位は SQL 側が決めており、この関数はその JS 版（両者は tests/leaderboard.test.ts で
 * 一致を検証している）。
 */
export function compareLeaderboard(
  a: { moveCount: number; hintCount: number; clearedAt: string },
  b: { moveCount: number; hintCount: number; clearedAt: string },
): number {
  if (a.hintCount !== b.hintCount) return a.hintCount - b.hintCount
  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount
  return a.clearedAt < b.clearedAt ? -1 : a.clearedAt > b.clearedAt ? 1 : 0
}

export type BestFreeMoves = Partial<Record<Difficulty, FreeBest>>

/**
 * 自己ベストの良さ。ランキングと同じ **(ヒント数, 手数) の辞書順**（SPEC §5.7 / §5.8）。
 * 負なら a のほうが良い記録。
 */
function compareFreeBest(a: FreeBest, b: FreeBest): number {
  if (a.hints !== b.hints) return a.hints - b.hints
  return a.moves - b.moves
}

/**
 * フリーモードの自己ベスト更新。
 *
 * 手数だけで比べていたころは、**ヒント 1 回で出した「1 手」が永久に残り**、
 * 以後どれだけ真面目に遊んでも更新できなくなっていた（自己ベスト機能そのものが死ぬ）。
 * ノーヒント 15 手はヒント 1 回 3 手より良い記録、という基準に揃えた。
 */
export function updateBestFreeMoves(
  current: BestFreeMoves,
  difficulty: Difficulty,
  record: FreeBest,
): BestFreeMoves {
  const best = current[difficulty]
  if (best === undefined || compareFreeBest(record, best) < 0) {
    return { ...current, [difficulty]: record }
  }
  return current
}

/**
 * jsonb から読んだ自己ベストを型の形に均す。壊れた値は**記録なし**として落とす。
 *
 * 旧形式は手数だけの数値（`{ normal: 8 }`）で、**ヒントを何回使ったか分からない**。
 * 「ヒント 0 回」と見なすとヒント込みの記録が最良として居座り続け（まさに直したかった不具合）、
 * 適当な回数をでっち上げれば嘘になる。どちらも避けるため捨てる。
 * フリーモードはランキング対象外で、次にクリアすれば新形式で記録し直されるので実害は小さい。
 * この関数があるおかげで旧データのためのマイグレーションは要らない。
 */
export function parseBestFreeMoves(value: unknown): BestFreeMoves {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const out: BestFreeMoves = {}
  for (const difficulty of DIFFICULTIES) {
    const entry = source[difficulty]
    if (typeof entry !== 'object' || entry === null) continue
    const { moves, hints } = entry as { moves?: unknown; hints?: unknown }
    if (!Number.isInteger(moves) || !Number.isInteger(hints)) continue
    if ((moves as number) <= 0 || (hints as number) < 0) continue
    out[difficulty] = { moves: moves as number, hints: hints as number }
  }
  return out
}
