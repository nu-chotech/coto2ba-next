/**
 * 設定（zustand）。
 *
 * `boothMode` はサーバーの `users.booth` が正。`GET /api/me` の結果で上書きし、
 * 変更は `PATCH /api/me` を投げてから反映する（この store は反映先であって権威ではない）。
 * サウンド・ハプティクスは端末ローカルの好み。
 *
 * NOTE: 永続化は入れていない（AsyncStorage が依存に無いため）。アプリを閉じると
 * サウンド / ハプティクスの設定は既定に戻る。
 */

import { create } from 'zustand'

export type SettingsState = {
  /** 効果音。展示会場でうるさくならないよう即座に切れるようにする。 */
  soundEnabled: boolean
  /** ハプティクス。 */
  hapticsEnabled: boolean
  /** ブースモード（SPEC §8.8）。サーバーと同期。 */
  boothMode: boolean

  setSoundEnabled: (enabled: boolean) => void
  setHapticsEnabled: (enabled: boolean) => void
  /** ローカルにだけ反映する。サーバーへの PATCH は呼び出し側の責任。 */
  setBoothMode: (enabled: boolean) => void
  /** `GET /api/me` の結果でサーバー由来の値を揃える。 */
  syncFromServer: (input: { booth: boolean }) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  soundEnabled: true,
  hapticsEnabled: true,
  boothMode: false,

  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
  setHapticsEnabled: (enabled) => set({ hapticsEnabled: enabled }),
  setBoothMode: (enabled) => set({ boothMode: enabled }),
  syncFromServer: ({ booth }) => set({ boothMode: booth }),
}))

export const selectSoundEnabled = (state: SettingsState): boolean => state.soundEnabled
export const selectHapticsEnabled = (state: SettingsState): boolean => state.hapticsEnabled
export const selectBoothMode = (state: SettingsState): boolean => state.boothMode
