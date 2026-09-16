/**
 * 語の入力欄（SPEC §8.3-4 / ARCHITECTURE §5）。
 *
 * **日本語 IME の事情で、この TextInput は controlled にしない。**
 * - `value` を渡さない（`defaultValue` のみ）
 * - `maxLength` を付けない
 * - 確定は送信ボタン（`onSubmitEditing` に頼らない）
 *
 * 外から語を入れたい（ヒントのタップ）ときは `ref.setWord()` を呼ぶ。
 * 内部で `defaultValue` を差し替えて **remount** する（`setNativeProps` は使わない）。
 * これが Fabric でいちばん壊れない。
 *
 * **辞書外（OOV）の赤い警告は、入力中には出さない。**
 * IME の変換途中（「ぎ」「ぎん」「ぎんが」…）は当然どれも辞書外なので、
 * 1 打ごとに判定すると枠が赤いまま・注意文が点滅し続ける（ARCHITECTURE §5:
 * composition 中の値は確定値ではない）。警告は **送信を試みたあと** だけ、
 * 親から `errorMessage` で降ってくる（ローカルの OOV 判定も親の startMix に集約）。
 * 注意文の行は常に高さを確保して、出入りでレイアウトをずらさない。
 *
 * 前方一致の候補チップは入力中もライブで出す（変換前のかなでも役に立つ）。
 */

import { normalizeWord, SUGGEST_LIMIT, type TierId } from '@coto2ba/contracts'
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native'
import { suggest } from '../lib/vocab'
import { layout, palette, paletteForTier, radius, spacing, typography } from '../theme'
import { INPUT_ERROR_ROW_HEIGHT, SUGGEST_CHIP_HEIGHT } from './constants'

export type WordInputHandle = {
  /** 最新の入力（正規化前の生文字列）。 */
  getValue: () => string
  /** 入力欄を空にする。 */
  clear: () => void
  /** 外から語を入れる（ヒントのタップ）。 */
  setWord: (word: string) => void
}

export type WordInputProps = {
  tier: TierId
  /** 入力が変わるたびに呼ばれる。親は ref に貯めるだけで再描画しないこと。 */
  onChangeWord?: (word: string) => void
  /** 送信ボタンから呼ぶのは親。ここでは候補タップ時の通知だけ。 */
  onPickSuggestion?: (word: string) => void
  disabled?: boolean
  placeholder?: string
  /**
   * 赤い注意文。**送信を試みたあとの結果だけ**を渡すこと
   * （親の `inputError`: 空入力・長すぎ・ローカル OOV・サーバーのエラー）。
   * 入力中の値から毎打計算した値を渡してはいけない。
   */
  errorMessage?: string | null
  style?: StyleProp<ViewStyle>
}

export const WordInput = forwardRef<WordInputHandle, WordInputProps>(function WordInput(
  {
    tier,
    onChangeWord,
    onPickSuggestion,
    disabled = false,
    placeholder = '混ぜる語を入力',
    errorMessage = null,
    style,
  },
  ref,
) {
  const colors = paletteForTier(tier)
  const latest = useRef('')
  const inputRef = useRef<TextInput | null>(null)

  // remount 用。seed を変えて key を進めると TextInput が作り直される。
  const [seed, setSeed] = useState('')
  const [epoch, setEpoch] = useState(0)
  // 候補チップだけは再描画したいので state に持つ（本文は ref）。
  const [text, setText] = useState('')

  const apply = useCallback(
    (next: string) => {
      latest.current = next
      setText(next)
      onChangeWord?.(next)
    },
    [onChangeWord],
  )

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => latest.current,
      clear: () => {
        apply('')
        setSeed('')
        setEpoch((n) => n + 1)
      },
      setWord: (word: string) => {
        apply(word)
        setSeed(word)
        setEpoch((n) => n + 1)
      },
    }),
    [apply],
  )

  const normalized = normalizeWord(text)
  const suggestions = useMemo(
    () => (normalized.length === 0 ? [] : suggest(normalized, SUGGEST_LIMIT)),
    [normalized],
  )
  // 入力中は判定しない。警告は送信を試みたあとに親から降ってくるものだけ。
  const showError = errorMessage !== null && errorMessage.length > 0

  const pick = useCallback(
    (word: string) => {
      apply(word)
      setSeed(word)
      setEpoch((n) => n + 1)
      onPickSuggestion?.(word)
    },
    [apply, onPickSuggestion],
  )

  return (
    <View style={[styles.root, style]}>
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.surface,
            borderColor: showError ? palette.negative : colors.sub,
          },
        ]}
      >
        <TextInput
          key={epoch}
          ref={inputRef}
          defaultValue={seed}
          onChangeText={apply}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={colors.sub}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          style={[typography.body, styles.input, { color: colors.text }]}
          accessibilityLabel="混ぜる語"
        />
      </View>

      {/* 注意文の行。常に置いて高さを固定する（下の UI をずらさない）。 */}
      <View style={styles.errorRow}>
        {showError ? (
          <Text style={[typography.label, { color: palette.negative }]} numberOfLines={1}>
            {errorMessage}
          </Text>
        ) : null}
      </View>

      {suggestions.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {suggestions.map((word) => (
            <Pressable
              key={word}
              onPress={() => pick(word)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: pressed ? palette.pressed : colors.surface,
                  borderColor: colors.sub,
                },
              ]}
            >
              <Text style={[typography.label, { color: colors.text }]}>{word}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  field: {
    height: layout.inputHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  input: { padding: 0 },
  errorRow: { height: INPUT_ERROR_ROW_HEIGHT, justifyContent: 'center' },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    height: SUGGEST_CHIP_HEIGHT,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
