/**
 * スキーム（ライト / ダーク）の供給。
 *
 * 画面は **役割の名前だけ**を参照し、どちらの値を取るかはここが決める。
 * `useColorScheme()` を購読するので、端末の設定を変えるとその場で切り替わる。
 *
 * ```tsx
 * const { palette, paletteForTier } = useTheme()
 * const colors = paletteForTier(tier)
 * ```
 *
 * 分割代入した `paletteForTier` は、モジュール直下の同名関数（ダーク固定の互換シム）を
 * 意図的に覆い隠す。**画面では必ずフック経由のほうを使う。**
 *
 * 地が常に暗い場所（図鑑タブ・シェア画像）は、意図的な例外として
 * `TIER_PALETTES.dark` を直接読んでよい。そのときはコードにその旨を書くこと。
 */

import type { TierId } from '@coto2ba/contracts'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useColorScheme } from 'react-native'
import { normalizeScheme, PALETTES, type Palette, type Scheme } from './palettes'
import { TIER_PALETTES, type TierPalette } from './tiers'

export type Theme = {
  scheme: Scheme
  palette: Palette
  paletteForTier: (tier: TierId) => TierPalette
}

function themeFor(scheme: Scheme): Theme {
  return {
    scheme,
    palette: PALETTES[scheme],
    paletteForTier: (tier) => TIER_PALETTES[scheme][tier],
  }
}

/** Provider の外で使われたときの既定。起動直後に白く光らせないためダーク。 */
const ThemeContext = createContext<Theme>(themeFor('dark'))

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const scheme = normalizeScheme(system)
  const theme = useMemo(() => themeFor(scheme), [scheme])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
