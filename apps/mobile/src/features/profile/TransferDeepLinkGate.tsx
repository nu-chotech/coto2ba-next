/**
 * 引き継ぎディープリンクの受け取り（SPEC §7.4）。
 *
 * 新しい端末は `exp://u.expo.dev/<projectId>?…&transfer=<token>` の QR から開かれる。
 * このリンクで Expo Go が起動したとき、**どの画面に着地しても**引き継ぎが走るように、
 * ルートレイアウトにこのコンポーネントを 1 つだけ置く（描画はしない）。
 *
 * - トークンの取り出しは `Linking.useURL()`（起動時の URL も、起動後に届いた URL も拾う）
 * - 同じトークンを二重に投げない（サーバーは 1 回しか受け付けないので、
 *   2 回目は必ず失敗する）。設定画面の貼り付け欄と取り合いにならないよう、
 *   処理状態を `transferDeepLinkState()` で公開する
 * - 成功したら「引き継ぎました」を出してロビーへ。失敗したら設定画面で手入力できると案内する
 */

import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { toMessageJa } from '../../components'
import { feedback } from '../../lib/feedback'
import { LOBBY_HREF } from '../game/routes'
import { transferTokenFromUrl, useClaimTransferMutation } from './queries'

/** ディープリンクで来たトークンの処理状態。 */
export type TransferDeepLinkState = 'new' | 'pending' | 'done' | 'failed'

/**
 * 画面を跨いで覚えておく（モジュールスコープ）。React の state に置くと、
 * 着地先の画面が変わった瞬間に消えて二重送信になる。
 */
const seen = new Map<string, TransferDeepLinkState>()

/** 設定画面が「自動で処理済みかどうか」を見るための窓口。 */
export function transferDeepLinkState(token: string): TransferDeepLinkState {
  return seen.get(token) ?? 'new'
}

export function TransferDeepLinkGate() {
  const url = Linking.useURL()
  const router = useRouter()
  const claim = useClaimTransferMutation()
  const claimTransferToken = claim.mutate

  useEffect(() => {
    if (url === null) return
    const token = transferTokenFromUrl(url)
    // `transfer` が付いていない普通の起動（開発サーバーの URL など）は何もしない。
    if (token === null) return
    if (seen.get(token) !== undefined) return

    seen.set(token, 'pending')
    claimTransferToken(token, {
      onSuccess: (result) => {
        seen.set(token, 'done')
        feedback('achievement')
        Alert.alert(
          '引き継ぎました',
          `${result.display_name} のデータ（図鑑・実績・記録）をこの端末に引き継ぎました。`,
        )
        router.replace(LOBBY_HREF)
      },
      onError: (error: unknown) => {
        // 期限切れ・使用済み・同じ端末。設定画面で手入力し直せるように状態を戻す。
        seen.set(token, 'failed')
        Alert.alert(
          '引き継げませんでした',
          `${toMessageJa(error)}\n設定の「別の端末から引き継ぐ」にコードを入れて、もう一度お試しください。`,
        )
      },
    })
  }, [url, router, claimTransferToken])

  return null
}
