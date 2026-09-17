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

import { compositeOver } from './color'
import { PALETTES, type Scheme } from './palettes'
import { TIER_PALETTES } from './tiers'

export type TabBarColors = {
  /** バーの地。iOS 26 のガラスでは無視される見込み。 */
  background: string
  /** 選択中のタブ（アイコンとラベル）。 */
  tint: string
  /** 選んでいないタブのラベル。 */
  label: string
  /**
   * 選択中のタブに敷く帯。**Android と Web だけ**（iOS はシステムが描く）。
   *
   * **指定しないと expo-router の既定 `#444444` が出る。** ライトの画面に
   * 濃いグレーの帯が出て、その上の藍色のラベルが 1.18:1 になって読めなくなっていた。
   * 選択中のラベルが載るのは**この帯の上**なので、コントラストはここに対して測る。
   */
  indicator: string
}

export function tabBarColors(scheme: Scheme): TabBarColors {
  const palette = PALETTES[scheme]
  return {
    background: palette.base,
    tint: TIER_PALETTES[scheme].cosmos.accent,
    label: TIER_PALETTES[scheme].mono.sub,
    // カードの面と同じ言葉づかいで、地をひと段だけ持ち上げる（沈める）。
    // 新しい色を発明せず、`surface` を地に重ねた結果を使う。
    indicator: compositeOver(palette.surface, palette.base),
  }
}
