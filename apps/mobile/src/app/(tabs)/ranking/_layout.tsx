/**
 * ランキングタブのスタック。中身は `index.tsx`（デイリーランキング）。
 * ヘッダは画面が自分で描く（背景が tier パレットなので素のヘッダは置かない）。
 */

import { Stack } from 'expo-router'
import { palette } from '../../../theme'

export default function RankingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.base },
      }}
    />
  )
}
