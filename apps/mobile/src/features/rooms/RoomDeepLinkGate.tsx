/**
 * 参加 QR（`exp://…?room=CODE`）で開かれたときの受け取り（設計 §9.5）。
 *
 * ブースの動線は「ホスト端末が QR を出す → 来場者がカメラで読む → 参加」なので、
 * **どの画面に着地しても部屋へ飛べる**必要がある。ルートレイアウトに 1 つだけ置く
 * （描画しない）。参加そのものは部屋の画面が冪等に投げるので、ここは案内するだけ。
 *
 * 同じコードで何度も飛ばさない（画面が切り替わるたびに `Linking.useURL()` が
 * 同じ URL を返すため）。
 */

import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { openRoomFromDeepLink } from './code'
import { roomHref } from './routes'

export function RoomDeepLinkGate() {
  const url = Linking.useURL()
  const router = useRouter()

  useEffect(() => {
    if (url === null) return
    /**
     * 判断と印付けは `openRoomFromDeepLink` が持つ。
     * **ここで参加の印（`markRoomJoinAttempted`）を触らないこと。**
     * 触ると着地した部屋の画面が join を投げなくなり、
     * **エラーも出ないまま画面が固まる**（一度そう壊した）。
     * その振る舞いは `tests/room-code.test.ts` が固定している。
     */
    const code = openRoomFromDeepLink(url)
    if (code === null) return
    router.push(roomHref(code))
  }, [url, router])

  return null
}
