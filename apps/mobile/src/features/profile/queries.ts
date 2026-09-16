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
  TRANSFER_TOKEN_LENGTH,
  type TransferClaimResponse,
} from '@coto2ba/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { claimTransfer, createTransfer, patchMe } from '../../lib/api'
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

/**
 * 引き継ぎの適用（`POST /api/transfer/claim`）。
 *
 * 成功するとこの端末のトークンが **引き継ぎ元のユーザー** に付け替わる
 * （サーバー側で device_tokens を付け替える）。トークン文字列自体は変わらないので
 * 再ログインは要らないが、**キャッシュに残っているのは前のユーザーのデータ**なので
 * 全部捨てて引き直す（me / daily / collection / achievements / leaderboard / game）。
 */
export function useClaimTransferMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => claimTransfer(token),
    onSuccess: async (_result: TransferClaimResponse) => {
      await queryClient.invalidateQueries()
    },
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

// ── 引き継ぎコードの検証（端末側。最終判定はサーバー）──────────

export type TransferTokenCheck = { ok: true; value: string } | { ok: false; message: string }

/**
 * 入力された引き継ぎコードをサーバーに送る形に戻す。
 *
 * - QR / 「URL をコピー」から貼られた `https://…/?transfer=XXXX` はトークン部分を抜く
 * - 表示用に挟んだハイフン・読み上げ時の空白・改行は落とす
 * - 大文字に揃える（サーバーは `trim().toUpperCase()` しかしない）
 *
 * `readableToken` の字種は大文字英数のみなので、英数以外を捨てても情報は落ちない。
 */
export function normalizeTransferToken(raw: string): string {
  const trimmed = raw.trim()
  const fromUrl = /[?&]transfer=([^&#\s]+)/.exec(trimmed)
  const source = fromUrl?.[1] ?? trimmed
  return source.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * ディープリンク（`exp://…/--/?transfer=XXXX` など）からコードを取り出す。
 * `transfer` が無い URL では **null**（URL 全体を英数だけ残して潰さないため）。
 */
export function transferTokenFromUrl(url: string): string | null {
  const match = /[?&]transfer=([^&#\s]+)/.exec(url)
  const raw = match?.[1]
  if (raw === undefined) return null
  const token = normalizeTransferToken(raw)
  return token.length === 0 ? null : token
}

/** 送る前に長さだけ見る（無効なコードは最終的にサーバーが弾く）。 */
export function checkTransferToken(raw: string): TransferTokenCheck {
  const value = normalizeTransferToken(raw)
  if (value.length === 0) return { ok: false, message: '引き継ぎコードを入力してください' }
  if (value.length !== TRANSFER_TOKEN_LENGTH) {
    return { ok: false, message: `引き継ぎコードは ${TRANSFER_TOKEN_LENGTH} 文字です` }
  }
  return { ok: true, value }
}
