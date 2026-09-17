/**
 * 図鑑タブのスタック。中身は `index.tsx`（Skia の全画面 Canvas）。
 * 画面が自分で全面を描くので、ヘッダも地も置かない。
 *
 * **意図的な例外：ライトモードでも地は暗いまま。** 図鑑は宇宙なので、
 * ここだけスキームに追従させない（SPEC §4.3）。`palette` はダーク固定の互換シム。
 */

import { Stack } from 'expo-router'
import { palette } from '../../../theme'

export default function SpaceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.base },
      }}
    />
  )
}
