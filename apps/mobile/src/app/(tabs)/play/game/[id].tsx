/**
 * ゲーム画面（SPEC §8.3 の 9 要素）。
 *
 * 1 ゴールカード / 2 現在の語 / 3 ランク + 温度バー / 4 入力欄 / 5 ratio スライダー /
 * 6 混合ボタン / 7 ヒント / 8 履歴 / 9 ギブアップ（「…」メニュー + 確認）
 *
 * **API 往復は必ず混合演出で覆う。** 最低表示時間（`MIX_ANIMATION_MIN_MS`）は
 * `useMoveMutation` が保証している。
 *
 * ルール判定はサーバー。ここでの語彙チェックは往復を減らすためだけの前さばきで、
 * 最終権威ではない（SPEC §8.7）。
 */

import {
  DIFFICULTY_LABELS_JA,
  isTierDown,
  isTierUp,
  MAX_MOVES,
  type MoveResponse,
  normalizeWord,
} from '@coto2ba/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassButton,
  GlassCard,
  HintSheet,
  HistoryStrip,
  INPUT_OOV_MESSAGE,
  INPUT_SANITY_MAX_LENGTH,
  MIN_TAP_SIZE,
  MixOverlay,
  MixSlider,
  RankMeter,
  SkeletonCard,
  SymbolIcon,
  TierBackground,
  toMessageJa,
  WordDisplay,
  WordInput,
  type WordInputHandle,
} from '../../../../components'
import {
  currentTier,
  previousRank,
  resultHref,
  useGameQuery,
  useGiveUpMutation,
  useHintMutation,
  useMoveMutation,
  useWordDescriptionQuery,
} from '../../../../features/game'
import { feedback, feedbackForRankChange } from '../../../../lib/feedback'
import { isKnownWord, isVocabReady } from '../../../../lib/vocab'
import { useUiStore } from '../../../../store/ui'
import { iconSize, layout, paletteForTier, spacing, typography } from '../../../../theme'

type Pending = { from: string; input: string }

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const gameId = typeof id === 'string' ? id : ''
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const game = useGameQuery(gameId)
  const move = useMoveMutation(gameId)
  const hint = useHintMutation(gameId)
  const surrender = useGiveUpMutation(gameId)

  const ratio = useUiStore((s) => s.ratio)
  const setRatio = useUiStore((s) => s.setRatio)
  const isHintOpen = useUiStore((s) => s.isHintOpen)
  const setHintOpen = useUiStore((s) => s.setHintOpen)
  const setMixing = useUiStore((s) => s.setMixing)
  const setActiveTier = useUiStore((s) => s.setActiveTier)
  const resetGameUi = useUiStore((s) => s.resetGameUi)

  const inputRef = useRef<WordInputHandle | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [revealed, setRevealed] = useState<MoveResponse | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [hints, setHints] = useState<string[]>([])

  const detail = game.data ?? null
  const tier = detail === null ? 'mono' : currentTier(detail)
  const colors = paletteForTier(tier)

  // 画面を離れるときに入力・ratio・シートを畳む。
  useEffect(() => () => resetGameUi(), [resetGameUi])

  // 背景の演出帯を UI 状態にも反映する（Skia の背景は次の担当者がここを読む）。
  useEffect(() => {
    setActiveTier(tier)
  }, [tier, setActiveTier])

  // 説明は結果の演出が終わってから引く（SPEC §7.6）。
  const description = useWordDescriptionQuery(
    pending === null && detail !== null ? detail.current : null,
  )

  const startMix = useCallback(() => {
    if (detail === null || detail.status !== 'playing') return
    const word = normalizeWord(inputRef.current?.getValue() ?? '')
    if (word.length === 0) {
      setInputError('混ぜる語を入力してください')
      return
    }
    if (word.length > INPUT_SANITY_MAX_LENGTH) {
      setInputError('語が長すぎます')
      return
    }
    if (isVocabReady() && !isKnownWord(word)) {
      feedback('error_oov')
      setInputError(INPUT_OOV_MESSAGE)
      return
    }

    Keyboard.dismiss()
    setInputError(null)
    setHintOpen(false)
    setMixing(true)
    feedback('mix_start')
    setPending({ from: detail.current, input: word })

    move.mutate(
      { input_word: word, ratio },
      {
        onSuccess: ({ response }) => setRevealed(response),
        onError: (error) => {
          setPending(null)
          setMixing(false)
          feedback('error_oov')
          setInputError(toMessageJa(error))
        },
      },
    )
  }, [detail, move, ratio, setHintOpen, setMixing])

  /** 演出が終わった瞬間。ここでフィードバックを鳴らし、終局なら結果画面へ。 */
  const finishMix = useCallback(() => {
    const response = revealed
    setPending(null)
    setRevealed(null)
    setMixing(false)
    if (response === null) return

    inputRef.current?.clear()
    feedbackForRankChange(response.prev_rank, response.rank)
    if (isTierUp(response.prev_tier, response.tier)) feedback('tier_up')
    else if (isTierDown(response.prev_tier, response.tier)) feedback('tier_down')
    if (response.status === 'cleared') feedback(response.perfect ? 'perfect' : 'clear')
    if (response.unlocked_achievements.length > 0) feedback('achievement')

    if (response.status !== 'playing') {
      router.replace(
        resultHref(
          gameId,
          response.unlocked_achievements.map((achievement) => achievement.id),
        ),
      )
    }
  }, [revealed, setMixing, router, gameId])

  const openHints = useCallback(() => {
    feedback('hint_open')
    setHintOpen(true)
    hint.mutate(undefined, { onSuccess: (data) => setHints([...data.hints]) })
  }, [hint, setHintOpen])

  const pickHint = useCallback(
    (word: string) => {
      inputRef.current?.setWord(word)
      setInputError(null)
      setHintOpen(false)
    },
    [setHintOpen],
  )

  const confirmGiveUp = useCallback(() => {
    Alert.alert('メニュー', 'この挑戦をどうしますか？', [
      { text: '閉じる', style: 'cancel' },
      {
        text: 'ギブアップ',
        style: 'destructive',
        onPress: () => {
          Alert.alert('ギブアップしますか？', 'この挑戦は終了します。やり直しはできません。', [
            { text: 'やめる', style: 'cancel' },
            {
              text: 'ギブアップする',
              style: 'destructive',
              onPress: () =>
                surrender.mutate(undefined, {
                  onSuccess: () => router.replace(resultHref(gameId)),
                }),
            },
          ])
        },
      },
    ])
  }, [gameId, router, surrender])

  if (game.isPending) {
    return (
      <TierBackground tier="mono">
        <View style={[styles.center, { paddingTop: insets.top + spacing.xxl }]}>
          <SkeletonCard />
        </View>
      </TierBackground>
    )
  }

  if (game.isError || detail === null) {
    return (
      <TierBackground tier="mono">
        <View style={[styles.center, { paddingTop: insets.top + spacing.xxl }]}>
          <ErrorState
            error={game.error}
            onRetry={() => void game.refetch()}
            title="ゲームを読み込めませんでした"
          />
        </View>
      </TierBackground>
    )
  }

  const finished = detail.status !== 'playing'

  return (
    <TierBackground tier={tier}>
      <KeyboardAwareScrollView
        bottomOffset={spacing.xxl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxxl },
        ]}
      >
        {/* 1. ゴールカード */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.sub }]}>ゴール</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="メニュー"
              onPress={confirmGiveUp}
              style={styles.menuButton}
            >
              <SymbolIcon name="ellipsis.circle" size={iconSize.xl} color={colors.sub} />
            </Pressable>
          </View>

          <Text style={[typography.title, { color: colors.text }]} numberOfLines={2}>
            {detail.goal}
          </Text>
          {detail.goal_description !== null ? (
            <Text style={[typography.caption, { color: colors.sub }]} numberOfLines={2}>
              {detail.goal_description}
            </Text>
          ) : null}

          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.accent }]}>
              {DIFFICULTY_LABELS_JA[detail.difficulty]}
            </Text>
            <Text style={[typography.mono, { color: colors.sub }]}>
              {detail.move_count} / {MAX_MOVES} 手 ・ ヒント {detail.hint_count}
            </Text>
          </View>
        </GlassCard>

        {/* 2. 現在の語 */}
        <WordDisplay
          word={detail.current}
          color={colors.text}
          captionColor={colors.sub}
          caption={description.data?.text ?? null}
          style={styles.hero}
        />

        {/* 3. ランク + 温度バー */}
        <RankMeter rank={detail.current_rank} prevRank={previousRank(detail)} tier={tier} />

        {finished ? (
          <GlassButton
            title="結果を見る"
            onPress={() => router.replace(resultHref(gameId))}
            tier={tier}
          />
        ) : (
          <>
            {/* 4. 入力欄 */}
            <WordInput
              ref={inputRef}
              tier={tier}
              errorMessage={inputError}
              onChangeWord={() => setInputError(null)}
              disabled={pending !== null}
            />

            {/* 5. ratio スライダー */}
            <MixSlider value={ratio} onChange={setRatio} tier={tier} disabled={pending !== null} />

            {/* 6. 混合ボタン */}
            <GlassButton title="混ぜる" onPress={startMix} tier={tier} loading={pending !== null} />

            {/* 7. ヒント */}
            <GlassButton
              title={`ヒント（使った回数 ${detail.hint_count}）`}
              icon="lightbulb"
              onPress={openHints}
              tier={tier}
              variant="ghost"
              disabled={pending !== null}
            />
          </>
        )}

        {/* 8. 履歴 */}
        <HistoryStrip moves={detail.moves} tier={tier} start={detail.start} />
      </KeyboardAwareScrollView>

      <HintSheet
        visible={isHintOpen}
        tier={tier}
        words={hints}
        loading={hint.isPending}
        errorMessage={hint.isError ? toMessageJa(hint.error) : null}
        hintCount={detail.hint_count}
        onPick={pickHint}
        onClose={() => setHintOpen(false)}
        onRetry={() => hint.mutate(undefined, { onSuccess: (data) => setHints([...data.hints]) })}
      />

      <MixOverlay
        visible={pending !== null}
        tier={tier}
        from={pending?.from ?? detail.current}
        input={pending?.input ?? ''}
        result={revealed?.result ?? null}
        onFinished={finishMix}
      />
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.lg,
  },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: layout.screenPaddingHorizontal },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { paddingVertical: spacing.lg },
  // 「…」は小さいので、当たり判定を Apple の 44pt まで広げてカードの角に寄せる。
  menuButton: {
    width: MIN_TAP_SIZE,
    height: MIN_TAP_SIZE,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: -spacing.sm,
    marginVertical: -spacing.md,
  },
})
