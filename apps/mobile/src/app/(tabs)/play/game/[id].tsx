/**
 * ゲーム画面（SPEC §8.3 の 9 要素）。
 *
 * 0 ナビゲーション（戻る / 何の挑戦か / 「…」メニュー）/ 1 ゴールカード / 2 現在の語 /
 * 3 ランク + 温度バー / 4 入力欄 / 5 ratio の回転ホイール / 6 混合ボタン / 7 ヒント / 8 履歴
 *
 * **出口（戻る・ギブアップ）を隠さない。** 以前はギブアップが `Alert` の入れ子の
 * 奥にあり、戻る導線が無かった。いまは上の行に「ロビー」と「…」を出し、
 * 「…」は `ActionSheet`（iOS のアクションシートの作法）。確認は 1 段だけ。
 *
 * **API 往復は必ず混合演出で覆う。** 最低表示時間（`MIX_ANIMATION_MIN_MS`）は
 * `useMoveMutation` が保証している。
 *
 * ルール判定はサーバー。ここでの語彙チェックは往復を減らすためだけの前さばきで、
 * 最終権威ではない（SPEC §8.7）。
 */

import {
  CLEAR_RANK,
  DIFFICULTY_LABELS_JA,
  type Hint,
  isTierDown,
  isTierUp,
  MAX_MOVES,
  type MoveResponse,
  normalizeWord,
  RATIO_STEP_COUNT,
  rankToHeat,
} from '@coto2ba/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ActionSheet,
  type ActionSheetItem,
  ErrorState,
  GlassButton,
  GlassCard,
  HintSheet,
  HistoryStrip,
  INPUT_OOV_MESSAGE,
  INPUT_SANITY_MAX_LENGTH,
  MIN_TAP_SIZE,
  MIX_BURST_HEAT_GAIN,
  MixOverlay,
  MixWheel,
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
  LOBBY_HREF,
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
import { iconSize, layout, screenPadding, spacing, typography, useTheme } from '../../../../theme'

type Pending = { from: string; input: string }

/**
 * 「…」から開くシート。**1 枚の Modal の中身を差し替える**ので、
 * メニュー → 確認 が Modal の出し直しにならない（iOS で二重表示にならない）。
 */
type Sheet = 'menu' | 'giveUp' | 'howToPlay'

/** 遊び方。ルールの数値は contracts から取る（画面に数字を書かない）。 */
const HOW_TO_PLAY = [
  '「今の語」に別の語を混ぜて、ゴールの語に近づけます。',
  `混ぜる比率はホイールで ${RATIO_STEP_COUNT} 段階から選べます。`,
  `ランクが ${CLEAR_RANK} 位以内に入ればクリア。ゴールの語そのものを錬成できれば完全錬成です。`,
  `1 回の挑戦で打てるのは ${MAX_MOVES} 手まで。ヒントは「語 + 混ぜ方」を教えます。`,
  'ロビーに戻っても挑戦は残ります。ロビーの「つづきから」で続きを遊べます。',
].join('\n\n')

/**
 * 混合の演出をどれだけ強くするか（0〜1）。
 *
 * **手数ではなく「どれだけゴールに近づいたか」**で決める。ものさしは `RankMeter` と
 * 同じ対数の温度（`rankToHeat`）。遠ざかったときは 0（演出は静かなまま）。
 */
function mixIntensity(response: MoveResponse | null): number {
  if (response === null) return 0
  const gain = rankToHeat(response.rank) - rankToHeat(response.prev_rank)
  return Math.min(Math.max(gain / MIX_BURST_HEAT_GAIN, 0), 1)
}

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
  const [hints, setHints] = useState<Hint[]>([])
  const [sheet, setSheet] = useState<Sheet | null>(null)

  const { paletteForTier } = useTheme()
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

  /** ヒントは「語 + 混ぜ方」で 1 つの提案なので、比率も一緒に入力に載せる。 */
  const pickHint = useCallback(
    (hint: Hint) => {
      inputRef.current?.setWord(hint.word)
      setRatio(hint.ratio)
      setInputError(null)
      setHintOpen(false)
    },
    [setHintOpen, setRatio],
  )

  /** ロビーへ戻る。**挑戦はサーバーに残る**ので確認は挟まない。 */
  const backToLobby = useCallback(() => {
    setSheet(null)
    if (router.canGoBack()) router.back()
    else router.replace(LOBBY_HREF)
  }, [router])

  const giveUp = useCallback(() => {
    setSheet(null)
    surrender.mutate(undefined, { onSuccess: () => router.replace(resultHref(gameId)) })
  }, [gameId, router, surrender])

  /**
   * 「…」の中身。**確認は 1 段だけ**（以前は Alert の入れ子で 2 段だった）。
   * 同じシートの中身を差し替えるので、メニューから確認へ移っても Modal は出し直さない。
   */
  const sheetProps = ((): {
    title: string | null
    message: string | null
    items: ActionSheetItem[]
    cancelLabel: string
    messageAlign: 'center' | 'start'
  } => {
    if (sheet === 'giveUp') {
      return {
        title: 'ギブアップしますか？',
        message: 'この挑戦は終了します。やり直しはできません。',
        items: [{ label: 'ギブアップする', onPress: giveUp, destructive: true }],
        cancelLabel: 'やめる',
        messageAlign: 'center',
      }
    }
    if (sheet === 'howToPlay') {
      return {
        title: '遊び方',
        message: HOW_TO_PLAY,
        items: [],
        cancelLabel: '閉じる',
        messageAlign: 'start',
      }
    }
    const items: ActionSheetItem[] = [
      { label: '遊び方', onPress: () => setSheet('howToPlay') },
      { label: 'ロビーに戻る（挑戦は残ります）', onPress: backToLobby },
    ]
    // 終わった挑戦にギブアップは出さない（サーバーが 422 を返すだけの操作）。
    if (detail !== null && detail.status === 'playing') {
      items.push({ label: 'ギブアップ', onPress: () => setSheet('giveUp'), destructive: true })
    }
    return { title: null, message: null, items, cancelLabel: 'キャンセル', messageAlign: 'center' }
  })()

  if (game.isPending) {
    return (
      <TierBackground tier="mono">
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <SkeletonCard />
        </View>
      </TierBackground>
    )
  }

  if (game.isError || detail === null) {
    return (
      <TierBackground tier="mono">
        <View style={[styles.center, { paddingTop: insets.top }]}>
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
  /** 何の挑戦なのか。デイリーは日付、フリーはモード名（難易度はカードに出ている）。 */
  const navTitle =
    detail.mode === 'daily' && detail.daily_date !== null
      ? `デイリー ${detail.daily_date}`
      : 'フリーモード'

  return (
    <TierBackground tier={tier}>
      <KeyboardAwareScrollView
        bottomOffset={spacing.xxl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, screenPadding(insets)]}
      >
        {/* 0. ナビゲーション（出口を隠さない） */}
        <View style={styles.navBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ロビーに戻る"
            accessibilityHint="この挑戦は残ります"
            onPress={backToLobby}
            style={styles.navBack}
          >
            <SymbolIcon
              name="chevron.left"
              size={iconSize.md}
              color={colors.accent}
              weight="semibold"
            />
            <Text style={[typography.body, { color: colors.accent }]}>ロビー</Text>
          </Pressable>

          <Text
            pointerEvents="none"
            numberOfLines={1}
            style={[typography.label, styles.navTitle, { color: colors.sub }]}
          >
            {navTitle}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="メニュー"
            onPress={() => setSheet('menu')}
            style={styles.navMenu}
          >
            <SymbolIcon name="ellipsis.circle" size={iconSize.lg} color={colors.accent} />
          </Pressable>
        </View>

        {/* 1. ゴールカード */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>ゴール</Text>

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

            {/* 5. ratio の回転ホイール */}
            <MixWheel value={ratio} onChange={setRatio} tier={tier} disabled={pending !== null} />

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
        hints={hints}
        loading={hint.isPending}
        errorMessage={hint.isError ? toMessageJa(hint.error) : null}
        hintCount={detail.hint_count}
        onPick={pickHint}
        onClose={() => setHintOpen(false)}
        onRetry={() => hint.mutate(undefined, { onSuccess: (data) => setHints([...data.hints]) })}
      />

      <ActionSheet
        visible={sheet !== null}
        tier={tier}
        title={sheetProps.title}
        message={sheetProps.message}
        items={sheetProps.items}
        cancelLabel={sheetProps.cancelLabel}
        messageAlign={sheetProps.messageAlign}
        onClose={() => setSheet(null)}
      />

      <MixOverlay
        visible={pending !== null}
        tier={tier}
        from={pending?.from ?? detail.current}
        input={pending?.input ?? ''}
        result={revealed?.result ?? null}
        resultTier={revealed?.tier ?? null}
        intensity={mixIntensity(revealed)}
        tierUp={revealed !== null && isTierUp(revealed.prev_tier, revealed.tier)}
        onFinished={finishMix}
      />
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: layout.sectionGap,
  },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: layout.screenPaddingHorizontal },
  card: { gap: layout.cardGap },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // 主役の語だけは上下を大きく空けて、1 つだけ浮かせる。
  hero: { paddingVertical: spacing.xl },
  // ナビゲーションの行。左右の当たり判定は Apple の 44pt を切らない。
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TAP_SIZE,
    // 下のカードとは近い関係なので、セクション間隔ぶんは空けすぎ。
    marginBottom: -spacing.md,
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TAP_SIZE,
    paddingRight: spacing.sm,
    // 山形の余白ぶん、左端を文字の並びに合わせる。
    marginLeft: -spacing.xs,
  },
  // タイトルは左右の要素の幅に関係なく画面の中央に置く（iOS のナビゲーションバー）。
  navTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  navMenu: {
    width: MIN_TAP_SIZE,
    height: MIN_TAP_SIZE,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: -spacing.xs,
  },
})
