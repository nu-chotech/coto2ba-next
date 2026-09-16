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
 * **辞書外（OOV）の赤い警告は、打鍵のたびに出さない。**
 * IME の変換途中（「ぎ」「ぎん」「ぎんが」…）は当然どれも辞書外なので、
 * 1 打ごとに判定すると枠が赤いまま・注意文が点滅し続ける（ARCHITECTURE §5:
 * composition 中の値は確定値ではない）。そこで
 *
 * 1. 入力が **止まって `INPUT_OOV_DEBOUNCE_MS` 経ってから** 判定する
 * 2. **ひらがなだけの入力中は判定しない**（変換前の読みなので辞書に無くて当然）
 * 3. 注意文の行は常に高さを確保して、出入りで下の UI をずらさない
 *
 * 送信ボタンを押した瞬間の判定はデバウンスを待たない。親（ゲーム画面）の
 * `startMix` が同期で判定して `errorMessage` に降ろす。親から来た文言は
 * 内部のデバウンス警告より優先して出す。
 *
 * 前方一致の候補チップは入力中もライブで出す（変換前のかなでも役に立つ）。
 */

import { normalizeWord, SUGGEST_LIMIT, type TierId } from '@coto2ba/contracts'
import {
  forwardRef,
  useCallback,
  useEffect,
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
import { isAllHiragana } from '../lib/text'
import { isKnownWord, isVocabReady, suggest } from '../lib/vocab'
import { layout, palette, paletteForTier, radius, spacing, typography } from '../theme'
import {
  INPUT_ERROR_ROW_HEIGHT,
  INPUT_OOV_DEBOUNCE_MS,
  INPUT_SANITY_MAX_LENGTH,
  SUGGEST_CHIP_HEIGHT,
} from './constants'

/** 辞書に無い語の文言。親（送信時の判定）と必ず同じものを使う。 */
export const INPUT_OOV_MESSAGE = 'その語は辞書にありません'

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
   * 入力中の値から毎打計算した値を渡してはいけない
   * （入力中の OOV はこの中でデバウンスして出す）。
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
  // 入力が止まってから出す辞書外の警告。打鍵のたびに一度消える。
  const [oovWarning, setOovWarning] = useState<string | null>(null)
  const oovTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelOovCheck = useCallback(() => {
    if (oovTimer.current !== null) {
      clearTimeout(oovTimer.current)
      oovTimer.current = null
    }
  }, [])

  const apply = useCallback(
    (next: string) => {
      latest.current = next
      setText(next)
      onChangeWord?.(next)

      // 打った瞬間はいったん消す（赤いまま打ち続ける状態を作らない）。
      cancelOovCheck()
      setOovWarning(null)

      const word = normalizeWord(next)
      // 空・長すぎ・語彙未ロードは送信時に親が見る。ここでは黙っておく。
      if (word.length === 0 || word.length > INPUT_SANITY_MAX_LENGTH) return
      if (!isVocabReady()) return
      // 変換前の読み。辞書に無くて当たり前なので警告しない。
      if (isAllHiragana(word)) return

      oovTimer.current = setTimeout(() => {
        oovTimer.current = null
        // 発火までに入力が変わっていたら出さない（古い判定を残さない）。
        if (normalizeWord(latest.current) !== word) return
        if (!isKnownWord(word)) setOovWarning(INPUT_OOV_MESSAGE)
      }, INPUT_OOV_DEBOUNCE_MS)
    },
    [onChangeWord, cancelOovCheck],
  )

  // 画面を離れるときにタイマーを残さない。
  useEffect(() => cancelOovCheck, [cancelOovCheck])

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

  // 親から降ってきた文言（送信の結果）が最優先。無ければデバウンスした警告。
  const shownError = errorMessage !== null && errorMessage.length > 0 ? errorMessage : oovWarning
  const showError = shownError !== null && shownError.length > 0

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
            {shownError}
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
