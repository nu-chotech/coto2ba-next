/**
 * 現在の語。画面の主役（SPEC §8.3-2）。
 *
 * 語が変わるときはクロスフェード + わずかなスケール。
 * `opacity` を触るのは **素の Animated.Text** であって GlassView ではないので、
 * ガラスの opacity 問題（§8.5）には当たらない。
 */

import { useEffect, useState } from 'react'
import { type StyleProp, StyleSheet, type TextStyle, View, type ViewStyle } from 'react-native'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { duration, heroFontSize, spring, typography } from '../theme'

export type WordDisplayProps = {
  word: string
  color: string
  /** 語の下に出す小さな説明（一行）。 */
  caption?: string | null
  captionColor?: string
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}

export function WordDisplay({
  word,
  color,
  caption = null,
  captionColor,
  style,
  textStyle,
}: WordDisplayProps) {
  const [shown, setShown] = useState(word)
  const opacity = useSharedValue(1)
  const scale = useSharedValue(1)

  // 語が差し替わったら、いったん消してから新しい語に入れ替える。
  useEffect(() => {
    if (shown === word) return
    scale.value = withTiming(0.92, { duration: duration.fast })
    opacity.value = withTiming(0, { duration: duration.fast }, (finished) => {
      if (finished === true) runOnJS(setShown)(word)
    })
  }, [word, shown, opacity, scale])

  // 表示中の語が変わったら現れる。
  useEffect(() => {
    opacity.value = withTiming(1, { duration: duration.base })
    scale.value = withSpring(1, spring.gentle)
  }, [shown, opacity, scale])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }))

  return (
    <View style={[styles.root, style]}>
      <Animated.Text
        numberOfLines={2}
        adjustsFontSizeToFit
        style={[
          typography.hero,
          { color, fontSize: heroFontSize(shown), lineHeight: heroFontSize(shown) * 1.18 },
          textStyle,
          animatedStyle,
        ]}
      >
        {shown}
      </Animated.Text>
      {caption !== null && caption.length > 0 ? (
        <Animated.Text
          numberOfLines={2}
          style={[typography.caption, styles.caption, { color: captionColor ?? color }, animatedStyle]}
        >
          {caption}
        </Animated.Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  caption: { textAlign: 'center', opacity: 0.7 },
})
