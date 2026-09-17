/**
 * 設定タブのスタック。中身は `index.tsx`（表示名・ブースモード・引き継ぎ QR・音・クレジット）。
 */

import { Stack } from 'expo-router'
import { useTheme } from '../../../theme'

export default function SettingsLayout() {
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
