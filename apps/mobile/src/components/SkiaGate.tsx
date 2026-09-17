/**
 * Skia が使える状態でなければ、子を描かずに代わりの表示を出す。
 *
 * - **ネイティブ（Expo Go / iOS / Android）**: Skia は JSI 経由で同期的に使えるので素通り。
 *   万一初期化に失敗しても、図鑑タブが落ちてアプリごと死ぬのを防ぐ
 *   （展示会場でタブを 1 つ触っただけで再起動、という事故を避けるための保険）。
 * - **Web**: CanvasKit の WASM を非同期で読む必要があり、しかも `Skia` は import 時に
 *   束縛されるので、後から `LoadSkiaWeb()` しても import 済みのモジュールからは見えない
 *   （`WithSkiaWeb` による遅延 import が要る）。**Web は対象外**なので代替表示にする。
 */

import { rect } from '@shopify/react-native-skia'
import type { ReactNode } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { spacing, typography, useTheme } from '../theme'

/**
 * Skia が実際に使えるか。**存在チェックではなく 1 回呼んで確かめる。**
 * Web では `Skia` オブジェクト自体は存在するが、中身の CanvasKit が未ロードのため
 * 呼んだ瞬間に落ちる（存在チェックだけだと素通りしてしまう）。
 */
let cached: boolean | null = null
export function isSkiaAvailable(): boolean {
  if (cached !== null) return cached
  try {
    rect(0, 0, 1, 1)
    cached = true
  } catch {
    cached = false
  }
  return cached
}

export function SkiaGate({ children, label }: { children: ReactNode; label: string }) {
  const { paletteForTier } = useTheme()
  if (isSkiaAvailable()) return <>{children}</>

  const colors = paletteForTier('mono')
  return (
    <View style={[styles.fallback, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.body, { color: colors.sub }]}>
        {Platform.OS === 'web'
          ? 'ブラウザでは 3D 表示に対応していません。Expo Go で開くと見られます。'
          : 'この端末では描画エンジンを使えませんでした。'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  title: { ...typography.title, textAlign: 'center' },
  body: { ...typography.body, textAlign: 'center' },
})
