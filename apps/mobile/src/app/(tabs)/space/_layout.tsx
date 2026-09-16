/**
 * 図鑑タブのスタック。中身は `index.tsx`（Skia の全画面 Canvas）。
 * 画面が自分で全面を描くので、ヘッダも地も置かない。
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
