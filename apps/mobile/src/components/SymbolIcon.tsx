/**
 * アイコン 1 個。**アプリ内の絵文字はすべてこれに置き換える。**
 *
 * - iOS: SF Symbols（`expo-symbols` の `SymbolView`）
 * - Android / Web: `expo-symbols` が同梱している Material Symbols のフォント。
 *   `SymbolView` は `name` をオブジェクトで渡したときだけ iOS 以外の名前を見るので、
 *   `components/symbols.ts` の対応表で載せ替えてから渡す
 *
 * **絵文字にフォールバックしない。** 台帳（`SYMBOLS`）に無い名前が来たときは、
 * 開発ビルドでは警告して気づけるようにし、本番では無害な点を描く。
 */

import { SymbolView, type SymbolWeight } from 'expo-symbols'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import {
  ICON_DEFAULT_SIZE,
  ICON_DEFAULT_WEIGHT,
  ICON_UNKNOWN_DOT_RATIO,
  opacity,
  radius,
} from '../theme'
import { materialSymbolFor, type SymbolName } from './symbols'

export type SymbolIconProps = {
  /** SF Symbols 名。`components/symbols.ts` の台帳に載っていること。 */
  name: SymbolName
  /** 既定は `ICON_DEFAULT_SIZE`。隣の文字の光学サイズに合わせること。 */
  size?: number
  color?: string
  weight?: SymbolWeight
  /** 読み上げ用。装飾なら渡さない（読み上げから外れる）。 */
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

/**
 * 台帳に無い名前が来たときの控え。**絵文字は使わない。**
 * 会場で「なぜか四角が出ている」より、静かな点が 1 つ出るほうが目立たない。
 */
function UnknownSymbol({
  size,
  color,
  style,
}: {
  size: number
  color: string | undefined
  style: StyleProp<ViewStyle>
}) {
  const dot = Math.round(size * ICON_UNKNOWN_DOT_RATIO)
  return (
    <View style={[{ width: size, height: size }, styles.center, style]}>
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: radius.pill,
          backgroundColor: color,
          opacity: opacity.muted,
        }}
      />
    </View>
  )
}

export function SymbolIcon({
  name,
  size = ICON_DEFAULT_SIZE,
  color,
  weight = ICON_DEFAULT_WEIGHT,
  accessibilityLabel,
  style,
}: SymbolIconProps) {
  const material = materialSymbolFor(name)

  if (material === null) {
    if (__DEV__) {
      console.warn(
        `[SymbolIcon] "${name}" は台帳にありません。src/components/symbols.ts に 1 行足してください。`,
      )
    }
    return <UnknownSymbol size={size} color={color} style={style} />
  }

  return (
    <SymbolView
      name={{ ios: name, android: material, web: material }}
      size={size}
      tintColor={color}
      weight={weight}
      accessibilityLabel={accessibilityLabel}
      accessible={accessibilityLabel !== undefined}
      style={style}
      // フォントが読めていない一瞬も含め、絵文字には落とさない。
      fallback={<UnknownSymbol size={size} color={color} style={style} />}
    />
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})
