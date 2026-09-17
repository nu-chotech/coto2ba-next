/**
 * ガラスのタブバーの色。
 *
 * **タブバーの操作感（`NativeTabs` であること、Trigger の構成、SF Symbols の指定）は
 * 実機で評価されているので触らない。** ここが決めるのは色の 3 つだけ。
 *
 * iOS 26 では Liquid Glass がシステム側で地に追従するので `backgroundColor` は
 * 無視される見込みだが、**フォールバック環境（iOS 26 未満 / Android / Web）では効く**。
 * そこでライトの画面の下に黒いバーが残らないよう、スキームに追従させる。
 *
 * 選択中の色は tier の `cosmos`（藍）。アプリの中で「今ここ」を示す色をこれに固定して
 * あるので、スキームが変わっても**色相は変えない**（明るさだけ入れ替える）。
 *
 * ここは **react-native に依存しない**（テストから素直に読めるように）。
 */

import { PALETTES, type Scheme } from './palettes'
import { TIER_PALETTES } from './tiers'

export type TabBarColors = {
  /** バーの地。iOS 26 のガラスでは無視される見込み。 */
  background: string
  /** 選択中のタブ（アイコンとラベル）。 */
  tint: string
  /** 選んでいないタブのラベル。 */
  label: string
}

export function tabBarColors(scheme: Scheme): TabBarColors {
  return {
    background: PALETTES[scheme].base,
    tint: TIER_PALETTES[scheme].cosmos.accent,
    label: TIER_PALETTES[scheme].mono.sub,
  }
}
