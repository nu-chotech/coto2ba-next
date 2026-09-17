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
 *
 * **時間は伸ばさない。** 混合の体感が 1 秒を超えると展示で待たされている感じになる
 * （SPEC の展示可能条件）。厚みは長さではなく「落差」で出す ──
 * 待っている間は静かに脈打つだけ、結果が来た瞬間に
 * **地の温度が変わり、光が弾ける**。どれだけ強く弾けるかは
 * 「どれだけゴールに近づいたか」（`intensity`）で決める。
 */

import type { TierId } from '@coto2ba/contracts'
import { useEffect, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import {
  borderWidth,
  heroFontSize,
  opacity as opacityToken,
  radius,
  spacing,
  typography,
  useTheme,
} from '../theme'
import {
  HERO_LINE_HEIGHT_RATIO,
  MIX_BURST_SCALE,
  MIX_CONVERGE_MS,
  MIX_CORE_PULSE,
  MIX_CORE_SIZE,
  MIX_HALO_OPACITY,
  MIX_HALO_SCALE,
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
  /**
   * 結果の演出帯。`tier` と違えば **地の温度が目の前で変わる**。
   * サーバーが返るまで null（そのあいだは今の帯のまま）。
   */
  resultTier?: TierId | null
  /**
   * どれだけゴールに近づいたか（0〜1）。光の弾け方の強さ。
   * ランクの縮みを `rankToHeat` で測ったもの（`RankMeter` と同じものさし）。
   */
  intensity?: number
  /** 演出帯が上がったか。上がったときだけ光の輪が広がる。 */
  tierUp?: boolean
  /** 結果を見せ終わったら呼ぶ。画面はここでゲーム状態を差し替える。 */
  onFinished: () => void
}

export function MixOverlay({
  visible,
  tier,
  from,
  input,
  result,
  resultTier = null,
  intensity = 0,
  tierUp = false,
  onFinished,
}: MixOverlayProps) {
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(tier)
  /** 結果の帯。まだ来ていなければ今の帯（＝地は変わらない）。 */
  const after = paletteForTier(resultTier ?? tier)
  /** 0〜1 に丸めておく（サーバーの値で演出が暴れないように）。 */
  const burst = Math.min(Math.max(intensity, 0), 1)
  const converge = useSharedValue(0)
  const glow = useSharedValue(0)
  const reveal = useSharedValue(0)

  /**
   * 見せている結果の語。**閉じ始めても消さない。**
   *
   * 閉じるときに親は `result` を null に戻す（次の手の準備）が、Modal は
   * フェードアウトのあいだまだ描かれている。そこで元に戻すと、消えぎわに
   * 「錬成中…」と 2 語が一瞬だけ蘇ってちらつく。開くときにだけ捨てる。
   */
  const [shownResult, setShownResult] = useState<string | null>(null)

  useEffect(() => {
    if (visible) setShownResult(null)
  }, [visible])

  useEffect(() => {
    if (result !== null) setShownResult(result)
  }, [result])

  // 開いた瞬間：2 語を中央に寄せ、光を脈打たせる。
  // **閉じるときには値を戻さない**（戻すと消えぎわに最初の絵が一瞬出る）。
  // ただし脈打ちは `withRepeat(-1)` の無限ループなので、**必ず止める**。
  // 止め忘れると、語彙エラーで閉じたときなどに裏で回り続ける。
  useEffect(() => {
    if (!visible) {
      cancelAnimation(glow)
      return
    }
    converge.value = 0
    glow.value = 0
    reveal.value = 0
    converge.value = withTiming(1, {
      duration: MIX_CONVERGE_MS,
      easing: Easing.inOut(Easing.cubic),
    })
    glow.value = withDelay(
      MIX_CONVERGE_MS,
      withRepeat(
        withTiming(1, { duration: MIX_PULSE_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    )
  }, [visible, converge, glow, reveal])

  // 結果が届いたら開く。
  useEffect(() => {
    if (!visible || result === null) return
    glow.value = withTiming(0, { duration: MIX_REVEAL_MS })
    // withSequence は第 1 引数が ReduceMotion と解釈されうるので使わない。
    // 「現れる」→「少し見せる」→「親に返す」を入れ子のコールバックで繋ぐ。
    reveal.value = withTiming(
      1,
      { duration: MIX_REVEAL_MS, easing: Easing.out(Easing.cubic) },
      (appeared) => {
        if (appeared !== true) return
        reveal.value = withDelay(
          MIX_HOLD_MS,
          withTiming(1, { duration: 0 }, (held) => {
            if (held === true) runOnJS(onFinished)()
          }),
        )
      },
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

  // 結果が来た瞬間、近づいたぶんだけ光の玉が膨らみながら消える。
  const coreStyle = useAnimatedStyle(() => {
    const base =
      1 - MIX_WORD_SHRINK + MIX_WORD_SHRINK * converge.value + MIX_CORE_PULSE * glow.value
    return {
      opacity: converge.value * (1 - reveal.value),
      transform: [{ scale: base + reveal.value * MIX_BURST_SCALE * burst }],
    }
  })

  // 地の温度。帯が変わらなければ同じ色どうしの補間なので、何も起きない。
  const backdropStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(reveal.value, [0, 1], [colors.bg, after.bg]),
  }))

  // 帯が上がったときだけ広がる光の輪。紙吹雪のような既製の演出はしない。
  const haloStyle = useAnimatedStyle(() => ({
    opacity: tierUp ? MIX_HALO_OPACITY * reveal.value * (1 - reveal.value) * 4 : 0,
    transform: [{ scale: 1 + reveal.value * (MIX_HALO_SCALE - 1) }],
  }))

  const resultStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: MIX_RESULT_FROM_SCALE + (1 - MIX_RESULT_FROM_SCALE) * reveal.value }],
  }))

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Animated.View style={[styles.root, backdropStyle]}>
        <View style={styles.stage}>
          <Animated.View
            style={[styles.halo, { borderColor: after.accent }, haloStyle]}
            pointerEvents="none"
          />

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

          {shownResult !== null ? (
            <Animated.Text
              numberOfLines={2}
              adjustsFontSizeToFit
              style={[
                typography.hero,
                styles.result,
                {
                  color: colors.text,
                  fontSize: heroFontSize(shownResult),
                  lineHeight: heroFontSize(shownResult) * HERO_LINE_HEIGHT_RATIO,
                },
                resultStyle,
              ]}
            >
              {shownResult}
            </Animated.Text>
          ) : null}
        </View>

        <Text style={[typography.label, styles.caption, { color: colors.sub }]}>
          {shownResult === null ? '錬成中…' : ' '}
        </Text>
      </Animated.View>
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
  halo: {
    position: 'absolute',
    width: MIX_CORE_SIZE,
    height: MIX_CORE_SIZE,
    borderRadius: radius.pill,
    borderWidth: borderWidth.thick,
  },
  result: { textAlign: 'center', paddingHorizontal: spacing.lg },
  caption: { position: 'absolute', bottom: spacing.xxxl },
})
