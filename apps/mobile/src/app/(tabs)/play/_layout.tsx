/**
 * プレイタブのスタック。ロビー → ゲーム → 結果。
 * ヘッダは各画面が自分で描く（背景が tier で変わるので、素のヘッダは置かない）。
 */

import { Stack } from 'expo-router'
import { palette } from '../../../theme'

export default function PlayLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.base },
      }}
    />
  )
}
