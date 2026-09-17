/**
 * ワードマーク（蓋の開いた鍋＋キラキラ＋「コトコトバ」）。
 *
 * **横長（およそ 2.56:1）**なので、高さを指定して幅を比率から出す。
 * 正方形の枠に入れると余白だらけになる。
 *
 * ライトでは黒、ダークでは白を出す。地が常に暗いところ（図鑑など）では
 * `variant="dark"` を明示して白を強制できる。
 *
 * `require()` は Metro が静的に解決するので、**変数でパスを組み立てないこと。**
 * 2 つの `require` を定数として持ち、スキームで選ぶ。
 * 将来 "Next" 付きに差し替わるが、**同じファイル名で上書きすれば差し替わる**。
 */

import { Image, type ImageStyle } from 'expo-image'
import type { StyleProp } from 'react-native'
import { useTheme } from '../theme'
import { LOGO_ASPECT_RATIO } from './constants'

/** Metro に静的に解決させるため、ここで直接 require する。 */
const SOURCES = {
  light: require('../../assets/images/logo-black.png'),
  dark: require('../../assets/images/logo-white.png'),
} as const

export type LogoVariant = 'auto' | 'light' | 'dark'

export type LogoProps = {
  /** 高さ（pt）。幅は比率から出す。 */
  height: number
  /** `auto` は端末のスキームに追従する。既定は `auto`。 */
  variant?: LogoVariant
  style?: StyleProp<ImageStyle>
}

export function Logo({ height, variant = 'auto', style }: LogoProps) {
  const { scheme } = useTheme()
  const resolved = variant === 'auto' ? scheme : variant

  return (
    <Image
      source={SOURCES[resolved]}
      style={[{ height, width: height * LOGO_ASPECT_RATIO }, style]}
      contentFit="contain"
      // 読み上げでファイル名が読まれないように、作品名を持たせる。
      accessibilityLabel="コトコトバ"
      accessible
    />
  )
}
