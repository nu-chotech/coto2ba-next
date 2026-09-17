/**
 * 演出帯（tier）を色で示す小さな印。
 *
 * これまで画面に出していた `TIER_EMOJI`（⬜🟩🟦🟨）の置き換え。
 * 絵文字は端末のフォント任せで色も形も揃わず、tier パレットとも一致しないので、
 * **同じパレットから取った塗り**で出す。
 *
 * **`features/game/result.ts` の絵文字はそのまま。** あれは X に貼るテキストで、
 * 絵文字であること自体が機能している（画面には出さない）。
 */

import type { TierId } from '@coto2ba/contracts'
import { useEffect } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { duration, radius, useTheme } from '../theme'
import {
  TIER_CELL_GAP,
  TIER_CELL_RADIUS,
  TIER_CELL_SIZE,
  TIER_DOT_SIZE,
  TIER_PATH_DRAW_STEP_MS,
  TIER_PATH_FROM_SCALE,
} from './constants'

export type TierDotProps = {
  tier: TierId
  /** 既定は `TIER_DOT_SIZE`。文字と並べるときは行の光学サイズに合わせる。 */
  size?: number
  style?: StyleProp<ViewStyle>
}

/** 文字の横に置く丸。 */
export function TierDot({ tier, size = TIER_DOT_SIZE, style }: TierDotProps) {
  const { paletteForTier } = useTheme()
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: paletteForTier(tier).accent,
        },
        style,
      ]}
    />
  )
}

export type TierPathProps = {
  /**
   * 1 手 1 マス。手の順（`seq` 昇順）で渡す。
   * 同じ tier が連続するので、key は `seq`（サーバーが振る手番）で取る。
   */
  moves: readonly { seq: number; tier: TierId }[]
  size?: number
  /**
   * マスを**手の順に 1 つずつ点けていく**（結果画面）。
   * 「意味空間を歩いた軌跡が繋がる」ことを見せる演出で、この作品の中身そのもの。
   * 既定は消灯なし（図鑑のように一覧で並べる場所では動かさない）。
   */
  drawIn?: boolean
  style?: StyleProp<ViewStyle>
}

/** 経路を 1 手 1 マスで並べたもの（結果画面）。 */
export function TierPath({ moves, size = TIER_CELL_SIZE, drawIn = false, style }: TierPathProps) {
  return (
    <View style={[styles.path, style]}>
      {moves.map((move, order) => (
        <PathCell key={move.seq} tier={move.tier} size={size} order={order} drawIn={drawIn} />
      ))}
    </View>
  )
}

/** 経路のマス 1 つ。点くのを遅らせるために、マスごとに共有値を持つ。 */
function PathCell({
  tier,
  size,
  order,
  drawIn,
}: {
  tier: TierId
  size: number
  /** 手の順（0 始まり）。これに比例して点灯を遅らせる。 */
  order: number
  drawIn: boolean
}) {
  const { paletteForTier } = useTheme()
  const appear = useSharedValue(drawIn ? 0 : 1)

  useEffect(() => {
    if (!drawIn) {
      appear.value = 1
      return
    }
    appear.value = withDelay(
      order * TIER_PATH_DRAW_STEP_MS,
      withTiming(1, { duration: duration.base, easing: Easing.out(Easing.cubic) }),
    )
  }, [drawIn, order, appear])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: TIER_PATH_FROM_SCALE + (1 - TIER_PATH_FROM_SCALE) * appear.value }],
  }))

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: TIER_CELL_RADIUS,
          backgroundColor: paletteForTier(tier).accent,
        },
        animatedStyle,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  path: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: TIER_CELL_GAP,
  },
})
