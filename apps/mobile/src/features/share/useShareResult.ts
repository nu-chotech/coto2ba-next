/**
 * 結果のシェアを 1 つのフックにまとめたもの。
 *
 * 使い方（結果画面）:
 * ```tsx
 * const { hostRef, share, isSharing, error, method } = useShareResult(game)
 * <PrimaryButton title="シェア" onPress={share} tier={tier} loading={isSharing} />
 * <ShareCardHost hostRef={hostRef} game={game} />
 * ```
 * `ShareCardHost` は画面外に置かれるのでレイアウトに影響しない。
 * ただし **同じ画面の中にマウントすること**（アンマウントされていると撮れない）。
 */

import type { GameDetail } from '@coto2ba/contracts'
import { useCallback, useRef, useState } from 'react'
import type { View } from 'react-native'
import { toMessageJa } from '../../components'
import { feedback } from '../../lib/feedback'
import { type ShareMethod, shareGameResult } from './shareResult'

export type UseShareResult = {
  /** `ShareCardHost` に渡す ref。 */
  hostRef: React.RefObject<View | null>
  share: () => void
  isSharing: boolean
  /** 直前に成功した手段（`view-shot` / `skia` / `text`）。 */
  method: ShareMethod | null
  /** 日本語のエラーメッセージ。 */
  error: string | null
}

export function useShareResult(game: GameDetail | null): UseShareResult {
  const hostRef = useRef<View | null>(null)
  // 二度押しの本当のガードはこちら。state は同じフレームの 2 回目にはまだ反映されない。
  const busyRef = useRef(false)
  const [isSharing, setSharing] = useState(false)
  const [method, setMethod] = useState<ShareMethod | null>(null)
  const [error, setError] = useState<string | null>(null)

  const share = useCallback(() => {
    if (game === null || busyRef.current) return
    busyRef.current = true
    setSharing(true)
    setError(null)
    void shareGameResult(game, hostRef.current)
      .then((outcome) => {
        setMethod(outcome.method)
        feedback('hint_open')
      })
      .catch((cause: unknown) => {
        setError(toMessageJa(cause))
      })
      .finally(() => {
        busyRef.current = false
        setSharing(false)
      })
  }, [game])

  return { hostRef, share, isSharing, method, error }
}
