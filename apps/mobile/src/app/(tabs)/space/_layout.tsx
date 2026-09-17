/**
 * 図鑑タブのスタック。中身は `index.tsx`（Skia の全画面 Canvas）。
 * 画面が自分で全面を描くので、ヘッダも地も置かない。
 *
 * **意図的な例外：ライトモードでも地は暗いまま。** 図鑑は宇宙なので、
 * ここだけスキームに追従させない。
 *
 * **その境界がここ 1 箇所。** サブツリーごと `ThemeProvider` でダークに固定するので、
 * 図鑑の中で `useTheme()` を呼ぶ部品（`GlassCard` など）は自動的にダークのパレットを
 * 受け取る。**部品ごとにダーク固定のシムを読ませない。** 混ざると「暗い地の上に
 * 紙色の面、その上に白い文字」になり、補助文字が 1.8:1 まで落ちて読めなくなる。
 *
 * 図鑑に新しい部品を足すときも、ここより内側なら `useTheme()` を素直に呼べばよい。
 */

import { Stack } from 'expo-router'
import { SPACE_SCHEME, ThemeProvider, useTheme } from '../../../theme'

export default function SpaceLayout() {
  return (
    <ThemeProvider scheme={SPACE_SCHEME}>
      <SpaceStack />
    </ThemeProvider>
  )
}

/** ThemeProvider の内側。ここでないと固定したスキームを受け取れない。 */
function SpaceStack() {
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
