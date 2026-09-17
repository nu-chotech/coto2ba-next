/**
 * 参加 QR（`exp://…?room=CODE`）で開かれたときの受け取り（SPEC §9.5）。
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
import { rememberCode, roomCodeFromUrl } from './code'
import { ROOM_CODE_MEMORY_LIMIT } from './constants'
import { roomHref } from './routes'

/**
 * ここで飛ばしたコード。画面を跨いで覚えておく
 * （React の state に置くと着地先で消えて、同じ URL で何度も push される）。
 *
 * **参加を投げた印（`markRoomJoinAttempted`）と共有してはいけない。**
 * 共有すると、着地した部屋の画面が「もう参加を投げた」と判断して **join を一本も
 * 投げなくなる**。ポーリングは参加が通るまで止めてあるので、
 * **join も poll も飛ばず、エラーも出ないまま画面がスケルトンで固まる**
 * （実際にそうなった。QR ＝ ブースの主動線なので致命的だった）。
 *
 * 上限つきで覚える（ブースは 1 台で何十戦も回すので際限なく貯めない）。
 */
const pushedByDeepLink = new Set<string>()

export function RoomDeepLinkGate() {
  const url = Linking.useURL()
  const router = useRouter()

  useEffect(() => {
    if (url === null) return
    const code = roomCodeFromUrl(url)
    // `room` が付いていない普通の起動（開発サーバーの URL など）は何もしない。
    if (code === null) return
    if (pushedByDeepLink.has(code)) return
    rememberCode(pushedByDeepLink, code, ROOM_CODE_MEMORY_LIMIT)
    router.push(roomHref(code))
  }, [url, router])

  return null
}
