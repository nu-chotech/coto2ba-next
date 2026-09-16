/**
 * プロフィール / 設定のサーバー状態。
 *
 * - `booth` の権威は **サーバー**（`users.booth`）。zustand の `boothMode` は
 *   その反映先でしかない（store/settings.ts のコメント参照）。
 *   ここで PATCH の成否に合わせて store を揃える。
 * - 表示名の最終判定（NG 語）もサーバー。端末では長さだけ見る。
 */

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  isValidDisplayNameLength,
  type MeResponse,
  normalizeWord,
  type PatchMeRequest,
} from '@coto2ba/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTransfer, patchMe } from '../../lib/api'
import { queryKeys } from '../../lib/queryClient'
import { useSettingsStore } from '../../store/settings'

/**
 * 表示名 / ブースモードの更新。
 * 成功したら `me` のキャッシュを差し替え、`booth` を store に反映する。
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PatchMeRequest) => patchMe(input),
    onSuccess: (me: MeResponse) => {
      queryClient.setQueryData(queryKeys.me(), me)
      useSettingsStore.getState().syncFromServer({ booth: me.booth })
    },
  })
}

/** 引き継ぎトークンの発行（`POST /api/transfer`）。 */
export function useCreateTransferMutation() {
  return useMutation({
    mutationFn: () => createTransfer(),
  })
}

// ── 表示名の検証（端末側。最終判定はサーバー）────────────────

export type DisplayNameCheck = { ok: true; value: string } | { ok: false; message: string }

/**
 * 表示名を整えて長さを見る。
 *
 * 正規化は語と同じ `normalizeWord`（NFKC + 空白除去）。**空白を許すと
 * 「　　　」のような名前が通ってランキングが読めなくなる**ので、語と同じ規則で潰す。
 */
export function checkDisplayName(raw: string): DisplayNameCheck {
  const value = normalizeWord(raw)
  if (value.length === 0) return { ok: false, message: '名前を入力してください' }
  if (!isValidDisplayNameLength(value, DISPLAY_NAME_MIN_LENGTH, DISPLAY_NAME_MAX_LENGTH)) {
    return {
      ok: false,
      message: `名前は ${DISPLAY_NAME_MIN_LENGTH}〜${DISPLAY_NAME_MAX_LENGTH} 文字です`,
    }
  }
  return { ok: true, value }
}

/** `abcd-efgh-…` の形に区切る（読み上げ・手入力のため）。 */
export function chunkToken(token: string, chunkSize: number): string {
  if (chunkSize <= 0) return token
  const parts: string[] = []
  for (let i = 0; i < token.length; i += chunkSize) {
    parts.push(token.slice(i, i + chunkSize))
  }
  return parts.join('-')
}
