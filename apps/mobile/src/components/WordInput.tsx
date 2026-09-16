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
 * 端末側の語彙判定（lib/vocab）で、辞書に無い語は赤く警告し、
 * 前方一致の候補を `SUGGEST_LIMIT` 件までチップで出す。
 */

import { normalizeWord, SUGGEST_LIMIT, type TierId } from '@coto2ba/contracts'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import { isKnownWord, isVocabReady, suggest } from '../lib/vocab'
import { palette, paletteForTier, radius, spacing, typography } from '../theme'
import { SUGGEST_CHIP_HEIGHT } from './constants'

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
  /** サーバーが OOV を返した語。赤い注意文を出す。 */
  serverErrorMessage?: string | null
  style?: StyleProp<ViewStyle>
}

export const WordInput = forwardRef<WordInputHandle, WordInputProps>(function WordInput(
  {
    tier,
    onChangeWord,
    onPickSuggestion,
    disabled = false,
    placeholder = '混ぜる語を入力',
    serverErrorMessage = null,
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
  // 候補と警告だけは再描画したいので state に持つ（本文は ref）。
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
  // 語彙が読めていないときは警告を出さない（サーバーが最終判定）。
  const unknown = isVocabReady() && normalized.length > 0 && !isKnownWord(normalized)
  const showError = unknown || (serverErrorMessage !== null && serverErrorMessage.length > 0)

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
          blurOnSubmit
          style={[typography.body, styles.input, { color: colors.text }]}
          accessibilityLabel="混ぜる語"
        />
      </View>

      {showError ? (
        <Text style={[typography.label, { color: palette.negative }]}>
          {serverErrorMessage ?? 'その語は辞書にありません'}
        </Text>
      ) : null}

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
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  input: { padding: 0 },
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
