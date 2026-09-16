/**
 * 演出帯（tier）の背景。
 *
 * このステージでは **Skia を使わない単色 + 光のにじみ** だけ。
 * 粒子・光条は次の担当者が Skia の全画面 Canvas で足す（SPEC §8.5）。
 *
 * tier が変わっても **再マウントしない**。共有値 `progress` を
 * `TIER_INPUT_RANGE` 上で補間するだけなので、色が滑らかに移る。
 */

import type { TierId } from '@coto2ba/contracts'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { palette, radius, TIER_INPUT_RANGE, tierColorRamp, tierToProgress } from '../theme'
import { TIER_GLOW_SCALE, TIER_TRANSITION_MS } from './constants'

const BG_RAMP = tierColorRamp('bg')
const ACCENT_RAMP = tierColorRamp('accent')
const SURFACE_RAMP = tierColorRamp('surface')

export type TierBackgroundProps = {
  tier: TierId
  children?: ReactNode
}

export function TierBackground({ tier, children }: TierBackgroundProps) {
  const { width, height } = useWindowDimensions()
  const progress = useSharedValue(tierToProgress(tier))

  useEffect(() => {
    progress.value = withTiming(tierToProgress(tier), { duration: TIER_TRANSITION_MS })
  }, [tier, progress])

  const baseStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, TIER_INPUT_RANGE, BG_RAMP),
  }))

  // 上方向のにじみ（ゴールカードの後ろ）。accent を極薄で。
  const glowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, TIER_INPUT_RANGE, ACCENT_RAMP),
    opacity: 0.1 + 0.06 * progress.value,
  }))

  // 下方向のにじみ（操作部の後ろ）。surface でわずかに持ち上げる。
  const veilStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, TIER_INPUT_RANGE, SURFACE_RAMP),
  }))

  const glowSize = width * TIER_GLOW_SCALE

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, baseStyle]} pointerEvents="none" />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            width: glowSize,
            height: glowSize,
            borderRadius: glowSize / 2,
            top: -glowSize * 0.55,
            left: (width - glowSize) / 2,
          },
          glowStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.veil,
          { height: height * 0.4, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
          veilStyle,
        ]}
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.base },
  glow: { position: 'absolute' },
  veil: { position: 'absolute', left: 0, right: 0, bottom: 0, opacity: 0.9 },
})
