/**
 * UI 状態（zustand）。
 *
 * **サーバー状態はここに置かない**（react-query が持つ）。
 * ここに入るのは「画面が持っているだけの状態」：語彙ロードの進捗、いま表示している
 * 演出帯、入力中の語、ratio、混合演出中かどうか。
 */

import { normalizeRatio, RATIO_DEFAULT, type TierId } from '@coto2ba/contracts'
import { create } from 'zustand'
import type { VocabStatus } from '../lib/vocab'

export type UiState = {
  // ── 語彙ロード ────────────────────────────────────────────
  /** 0〜1。スプラッシュ下の細い進捗線に使う。 */
  vocabLoadProgress: number
  vocabStatus: VocabStatus
  setVocabLoadProgress: (progress: number) => void
  setVocabStatus: (status: VocabStatus) => void

  // ── 演出帯 ────────────────────────────────────────────────
  /**
   * いま画面が表示している tier。サーバーが返した rank から決まるが、
   * 演出の途中で先に動かすことがあるので UI 側の状態として持つ。
   */
  activeTier: TierId
  setActiveTier: (tier: TierId) => void

  // ── ゲーム画面のローカル状態 ──────────────────────────────
  /**
   * 入力欄の内容。
   * IME 対策で TextInput は controlled にしない（ARCHITECTURE §5）ので、
   * これは「送信ボタンが読む最新値」であって value には渡さない。
   */
  draftWord: string
  setDraftWord: (word: string) => void
  /** 混合比率（8 段階のいずれか）。 */
  ratio: number
  setRatio: (ratio: number) => void
  /** 混合演出中（API 往復を覆っている間）。 */
  isMixing: boolean
  setMixing: (mixing: boolean) => void
  /** ヒントシートが開いているか。 */
  isHintOpen: boolean
  setHintOpen: (open: boolean) => void
  /** 直近の入力が語彙に無かった（赤く警告する）。 */
  oovWord: string | null
  setOovWord: (word: string | null) => void
  /** 画面を離れる / 次のゲームに移るときに呼ぶ。 */
  resetGameUi: () => void
}

const initialGameUi = {
  draftWord: '',
  ratio: RATIO_DEFAULT,
  isMixing: false,
  isHintOpen: false,
  oovWord: null,
} as const

export const useUiStore = create<UiState>((set) => ({
  vocabLoadProgress: 0,
  vocabStatus: 'idle',
  setVocabLoadProgress: (progress) => set({ vocabLoadProgress: progress }),
  setVocabStatus: (status) => set({ vocabStatus: status }),

  activeTier: 'mono',
  setActiveTier: (tier) => set({ activeTier: tier }),

  ...initialGameUi,
  setDraftWord: (word) => set({ draftWord: word }),
  setRatio: (ratio) => set({ ratio: normalizeRatio(ratio) ?? RATIO_DEFAULT }),
  setMixing: (mixing) => set({ isMixing: mixing }),
  setHintOpen: (open) => set({ isHintOpen: open }),
  setOovWord: (word) => set({ oovWord: word }),
  resetGameUi: () => set({ ...initialGameUi }),
}))

// ── セレクタ（再レンダリングを絞るために用意しておく）────────
export const selectActiveTier = (state: UiState): TierId => state.activeTier
export const selectRatio = (state: UiState): number => state.ratio
export const selectIsMixing = (state: UiState): boolean => state.isMixing
export const selectVocabLoadProgress = (state: UiState): number => state.vocabLoadProgress
