/**
 * 混合演出（SPEC §8.5）。**作り込むのはこの 1 種類だけ。**
 * 「2 語が中央で溶けて 1 語になる」。
 *
 * API 往復は必ずこれで覆う（SPEC §8.3）。応答が速くても
 * `MIX_ANIMATION_MIN_MS` は見せる。最低時間の保証は
 * `features/game/queries.ts` の mutation 側が持っている
 * （この演出は「結果が来たら開く」だけに徹する）。
 *
 * ガラスは使わない（`GlassView` の opacity 0 が描画されない問題を避ける）。
 */

import type { TierId } from '@coto2ba/contracts'
import { useEffect } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { heroFontSize, opacity as opacityToken, paletteForTier, radius, spacing, typography } from '../theme'
import {
  MIX_CONVERGE_MS,
  MIX_CORE_PULSE,
  MIX_CORE_SIZE,
  MIX_HOLD_MS,
  MIX_PULSE_MS,
  MIX_RESULT_FROM_SCALE,
  MIX_REVEAL_MS,
  MIX_STAGE_MIN_HEIGHT,
  MIX_WORD_OFFSET,
  MIX_WORD_SHRINK,
} from './constants'

export type MixOverlayProps = {
  visible: boolean
  tier: TierId
  /** 現在の語。 */
  from: string
  /** 混ぜる語。 */
  input: string
  /** 結果の語。サーバーが返るまで null（その間は光が脈打つ）。 */
  result: string | null
  /** 結果を見せ終わったら呼ぶ。画面はここでゲーム状態を差し替える。 */
  onFinished: () => void
}

export function MixOverlay({ visible, tier, from, input, result, onFinished }: MixOverlayProps) {
  const colors = paletteForTier(tier)
  const converge = useSharedValue(0)
  const glow = useSharedValue(0)
  const reveal = useSharedValue(0)

  // 開いた瞬間：2 語を中央に寄せ、光を脈打たせる。
  useEffect(() => {
    if (!visible) {
      converge.value = 0
      glow.value = 0
      reveal.value = 0
      return
    }
    converge.value = withTiming(1, {
      duration: MIX_CONVERGE_MS,
      easing: Easing.inOut(Easing.cubic),
    })
    glow.value = withDelay(
      MIX_CONVERGE_MS,
      withRepeat(withTiming(1, { duration: MIX_PULSE_MS, easing: Easing.inOut(Easing.quad) }), -1, true),
    )
  }, [visible, converge, glow, reveal])

  // 結果が届いたら開く。
  useEffect(() => {
    if (!visible || result === null) return
    glow.value = withTiming(0, { duration: MIX_REVEAL_MS })
    reveal.value = withSequence(
      withTiming(1, { duration: MIX_REVEAL_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(
        MIX_HOLD_MS,
        withTiming(1, { duration: 0 }, (finished) => {
          if (finished === true) runOnJS(onFinished)()
        }),
      ),
    )
  }, [visible, result, glow, reveal, onFinished])

  const leftStyle = useAnimatedStyle(() => ({
    opacity: (1 - converge.value) * (1 - reveal.value),
    transform: [
      { translateX: -MIX_WORD_OFFSET * (1 - converge.value) },
      { scale: 1 - MIX_WORD_SHRINK * converge.value },
    ],
  }))

  const rightStyle = useAnimatedStyle(() => ({
    opacity: (1 - converge.value) * (1 - reveal.value),
    transform: [
      { translateX: MIX_WORD_OFFSET * (1 - converge.value) },
      { scale: 1 - MIX_WORD_SHRINK * converge.value },
    ],
  }))

  const coreStyle = useAnimatedStyle(() => ({
    opacity: converge.value * (1 - reveal.value),
    transform: [{ scale: 1 - MIX_WORD_SHRINK + MIX_WORD_SHRINK * converge.value + MIX_CORE_PULSE * glow.value }],
  }))

  const resultStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: MIX_RESULT_FROM_SCALE + (1 - MIX_RESULT_FROM_SCALE) * reveal.value }],
  }))

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.stage}>
          <Animated.Text
            numberOfLines={1}
            style={[typography.title, styles.word, { color: colors.sub }, leftStyle]}
          >
            {from}
          </Animated.Text>

          <Animated.View
            style={[styles.core, { backgroundColor: colors.accent }, coreStyle]}
            pointerEvents="none"
          />

          <Animated.Text
            numberOfLines={1}
            style={[typography.title, styles.word, { color: colors.sub }, rightStyle]}
          >
            {input}
          </Animated.Text>

          {result !== null ? (
            <Animated.Text
              numberOfLines={2}
              adjustsFontSizeToFit
              style={[
                typography.hero,
                styles.result,
                {
                  color: colors.text,
                  fontSize: heroFontSize(result),
                  lineHeight: heroFontSize(result) * 1.18,
                },
                resultStyle,
              ]}
            >
              {result}
            </Animated.Text>
          ) : null}
        </View>

        <Text style={[typography.label, styles.caption, { color: colors.sub }]}>
          {result === null ? '錬成中…' : ' '}
        </Text>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stage: { alignItems: 'center', justifyContent: 'center', minHeight: MIX_STAGE_MIN_HEIGHT },
  word: { position: 'absolute', textAlign: 'center' },
  core: {
    position: 'absolute',
    width: MIX_CORE_SIZE,
    height: MIX_CORE_SIZE,
    borderRadius: radius.pill,
    opacity: opacityToken.full,
  },
  result: { textAlign: 'center', paddingHorizontal: spacing.lg },
  caption: { position: 'absolute', bottom: spacing.xxxl },
})
