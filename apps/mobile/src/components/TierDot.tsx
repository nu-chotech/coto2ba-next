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
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { radius, useTheme } from '../theme'
import { TIER_CELL_GAP, TIER_CELL_RADIUS, TIER_CELL_SIZE, TIER_DOT_SIZE } from './constants'

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
  style?: StyleProp<ViewStyle>
}

/** 経路を 1 手 1 マスで並べたもの（結果画面）。 */
export function TierPath({ moves, size = TIER_CELL_SIZE, style }: TierPathProps) {
  const { paletteForTier } = useTheme()
  return (
    <View style={[styles.path, style]}>
      {moves.map((move) => (
        <View
          key={move.seq}
          style={{
            width: size,
            height: size,
            borderRadius: TIER_CELL_RADIUS,
            backgroundColor: paletteForTier(move.tier).accent,
          }}
        />
      ))}
    </View>
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
