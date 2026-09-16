/**
 * 設定タブのスタック。中身は次の担当者が実装する。
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
