/**
 * ゲームのルール（純粋関数）。DB に触れない。vitest でここを厚くテストする。
 * SPEC §5.3 の 1 手の処理のうち、判定にあたる部分。
 */
import {
  CLEAR_RANK,
  type Difficulty,
  type ErrorCode,
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

/** ランキングの並び順（SPEC §5.8）。同値なら 0。 */
export function compareLeaderboard(
  a: { moveCount: number; hintCount: number; clearedAt: string },
  b: { moveCount: number; hintCount: number; clearedAt: string },
): number {
  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount
  if (a.hintCount !== b.hintCount) return a.hintCount - b.hintCount
  return a.clearedAt < b.clearedAt ? -1 : a.clearedAt > b.clearedAt ? 1 : 0
}

/** フリーモードの自己ベスト更新。 */
export function updateBestFreeMoves(
  current: Record<string, number>,
  difficulty: Difficulty,
  moveCount: number,
): Record<string, number> {
  const best = current[difficulty]
  if (best === undefined || moveCount < best) {
    return { ...current, [difficulty]: moveCount }
  }
  return current
}
