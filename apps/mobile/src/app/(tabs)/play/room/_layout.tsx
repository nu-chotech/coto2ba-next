/**
 * 対戦ルームのスタック。入口 → 部屋。
 * ヘッダは各画面が自分で描く（プレイタブの他の画面と同じ作法）。
 */

import { Stack } from 'expo-router'
import { useTheme } from '../../../../theme'

export default function RoomLayout() {
  const { palette } = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.base },
      }}
    />
  )
}
