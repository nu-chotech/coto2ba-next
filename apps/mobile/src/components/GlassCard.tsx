/**
 * ガラスのカード。
 *
 * iOS 26+ では `expo-glass-effect` の `GlassView`、それ以外（iOS 25 以前 / Android / Web）は
 * `expo-blur` の `BlurView` + 半透明の地にフォールバックする（SPEC §8.5）。
 *
 * **既知の問題**: `GlassView` の `opacity: 0` は描画されない。
 * フェードさせたいときは GlassCard 自体の opacity を触らず、
 * 別レイヤー（親の View や中身）でフェードすること。
 */

import { BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { blurIntensity, glassEdge, glassFallbackFill, radius, spacing } from '../theme'

export type GlassCardVariant = 'card' | 'sheet'

export type GlassCardProps = {
  children?: ReactNode
  /** ガラスの着色。tier パレットの `glassTint` を渡す。null なら無着色。 */
  tint?: string | null
  /** 角丸。既定は `radius.lg`。 */
  cornerRadius?: number
  /** card（薄い）か sheet（濃い）か。ぼかしの強さが変わる。 */
  variant?: GlassCardVariant
  /** 内側の余白。既定は `spacing.lg`。0 を渡せば余白なし。 */
  padding?: number
  style?: StyleProp<ViewStyle>
}

/** 端末が Liquid Glass を出せるか。描画のたびに評価しても軽い（ネイティブ定数）。 */
export function canUseLiquidGlass(): boolean {
  return isLiquidGlassAvailable()
}

export function GlassCard({
  children,
  tint = null,
  cornerRadius = radius.lg,
  variant = 'card',
  padding = spacing.lg,
  style,
}: GlassCardProps) {
  const shape: ViewStyle = {
    borderRadius: cornerRadius,
    padding,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glassEdge,
    overflow: 'hidden',
  }

  if (canUseLiquidGlass()) {
    return (
      <GlassView
        glassEffectStyle={variant === 'sheet' ? 'regular' : 'clear'}
        tintColor={tint ?? undefined}
        style={[shape, style]}
      >
        {children}
      </GlassView>
    )
  }

  return (
    <View style={[shape, style]}>
      <BlurView
        intensity={variant === 'sheet' ? blurIntensity.sheet : blurIntensity.card}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? glassFallbackFill }]} />
      {children}
    </View>
  )
}
