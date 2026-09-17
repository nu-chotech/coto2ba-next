/**
 * 図鑑（宇宙）だけの例外を、**1 箇所に集めたもの**。
 *
 * 図鑑は「意味空間の宇宙」なので、**端末がライトでも地は暗いまま**にする
 * （意図的な例外。docs/DEVICE-CHECK.md の確認項目にもなっている）。
 *
 * その例外を**部品ごとに実装しない**。境界は
 * `app/(tabs)/space/_layout.tsx` の `<ThemeProvider scheme={SPACE_SCHEME}>` だけで、
 * 図鑑のサブツリーで `useTheme()` を呼ぶ部品は自動的にダークのパレットを受け取る。
 *
 * 部品ごとにダーク固定のシムを読ませると、**シムを読む部品とスキームに追従する部品が
 * 混ざって**「暗い地の上に紙色の面、その上に白い文字」になる（実際にそうなっていた。
 * ライトで図鑑の補助文字が 1.8:1 まで落ちて読めなかった）。
 *
 * ここは **react-native に依存しない**（テストから素直に読めるように）。
 */

import type { TierId } from '@coto2ba/contracts'
import type { Scheme } from './palettes'

/** 図鑑のサブツリーに固定するスキーム。**端末の設定に追従させない。** */
export const SPACE_SCHEME: Scheme = 'dark'

/** 図鑑の演出帯。宇宙なので `cosmos` で固定（ゲームの tier とは連動しない）。 */
export const SPACE_TIER: TierId = 'cosmos'
