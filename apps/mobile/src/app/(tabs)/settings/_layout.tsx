/**
 * 設定タブのスタック。中身は `index.tsx`（表示名・ブースモード・引き継ぎ QR・音・クレジット）。
 */

import { Stack } from 'expo-router'
import { palette } from '../../../theme'

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.base },
      }}
    />
  )
}
