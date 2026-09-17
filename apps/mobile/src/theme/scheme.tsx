/**
 * スキーム（ライト / ダーク）の供給。
 *
 * 画面は **役割の名前だけ**を参照し、どちらの値を取るかはここが決める。
 * 端末の設定を購読するので、ライト / ダークを切り替えるとその場で追従する。
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
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { Platform, useColorScheme } from 'react-native'
import { normalizeScheme, PALETTES, type Palette, type Scheme } from './palettes'
import { TIER_PALETTES, type TierPalette } from './tiers'

export type Theme = {
  scheme: Scheme
  palette: Palette
  paletteForTier: (tier: TierId) => TierPalette
}

/** Web だけ。`prefers-color-scheme` を直接聞くためのクエリ。 */
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Web で `prefers-color-scheme` を今すぐ読む。読めない場所（静的書き出し）では null。 */
function webScheme(): Scheme | null {
  if (Platform.OS !== 'web') return null
  const media = globalThis.matchMedia?.(DARK_QUERY)
  return media === undefined ? null : media.matches ? 'dark' : 'light'
}

/**
 * 端末が選んでいるスキーム。
 *
 * ネイティブ（Expo Go）はこれだけで足りる。`useColorScheme()` が端末の設定を返す。
 *
 * **Web だけ事情がある。** `expo export --platform web` は各画面を静的な HTML に
 * 焼いてから hydrate する。焼くのは Node なので `prefers-color-scheme` が無く、
 * そこでは必ず light になる。RN Web の `Appearance` も hydrate 後に読み直さないため、
 * ダークの端末で開いても初回は light のままになる。
 *
 * そこで Web では `matchMedia` を自分で聞く。**最初の描画の時点で**読むのが大事で、
 * マウント後に差し替えると、先に描き終わった部分だけ古い色が残る。
 */
function useSystemScheme(): Scheme {
  const native = useColorScheme()
  // 初期値をここで読む（遅延初期化なので、最初の描画に間に合う）。
  const [web, setWeb] = useState<Scheme | null>(webScheme)

  useEffect(() => {
    const media = Platform.OS === 'web' ? globalThis.matchMedia?.(DARK_QUERY) : undefined
    if (media === undefined) return

    const apply = () => setWeb(media.matches ? 'dark' : 'light')
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  return web ?? normalizeScheme(native)
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
  const scheme = useSystemScheme()
  const theme = useMemo(() => themeFor(scheme), [scheme])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
