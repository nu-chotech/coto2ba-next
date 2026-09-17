/**
 * タブ（SPEC §8.2）。
 *
 * **SDK 57 のパスは `expo-router/unstable-native-tabs`**（SDK 58 で
 * `expo-router/native-tabs` になる）。`import { Tabs } from 'expo-router'` は非推奨。
 * iOS 26 ではシステムのガラスのタブバーになる。
 *
 * アイコンは SF Symbols（`NativeTabs.Trigger.Icon` の `sf`）。
 * Android では `drawable` が無いので `md`（Material）を併記しておく。
 *
 * **操作感は実機で評価されている。触るのは色の 3 つだけ。**
 * `NativeTabs` であること・Trigger の構成・`sf` / `md` の指定・並び・文言は変えない。
 * 色は `theme/tabs.ts`（コントラストをテストで固定してある）。
 */

import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { tabBarColors, useTheme } from '../../theme'

export default function TabsLayout() {
  const { scheme } = useTheme()
  const colors = tabBarColors(scheme)

  return (
    <NativeTabs
      tintColor={colors.tint}
      backgroundColor={colors.background}
      labelStyle={{ color: colors.label }}
    >
      <NativeTabs.Trigger name="play">
        <NativeTabs.Trigger.Label>プレイ</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'circle.hexagongrid', selected: 'circle.hexagongrid.fill' }}
          md="widgets"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="space">
        <NativeTabs.Trigger.Label>図鑑</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'sparkles', selected: 'sparkles' }}
          md="auto_awesome"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ranking">
        <NativeTabs.Trigger.Label>ランキング</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="trophy" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>設定</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
