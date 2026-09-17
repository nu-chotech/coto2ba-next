/**
 * ロビー（SPEC §8.2）。
 *
 * - 今日のデイリー：ゴール語・一行説明・難易度・日付・自分の状態
 * - フリーモード：難易度 3 つのセグメント + 「あそぶ」（自己ベストを小さく）
 * - 引っぱって更新。ローディングはスケルトン。
 *
 * サーバーが落ちていても画面は壊れない（ErrorState + 再試行）。
 */

import {
  DIFFICULTIES,
  DIFFICULTY_LABELS_JA,
  type Difficulty,
  type Game,
  MAX_MOVES,
} from '@coto2ba/contracts'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassButton,
  GlassCard,
  HERO_LINE_HEIGHT_RATIO,
  Segmented,
  Skeleton,
  SkeletonCard,
  TierBackground,
  toMessageJa,
} from '../../../components'
import {
  bestFreeMovesLabel,
  gameHref,
  resultHref,
  useCreateGameMutation,
  useDailyQuery,
  useMeQuery,
} from '../../../features/game'
import {
  heroFontSize,
  layout,
  radius,
  screenInsets,
  spacing,
  typography,
  useTheme,
} from '../../../theme'

/** ロビーは演出帯を持たないので、常に落ち着いた mono。 */
const LOBBY_TIER = 'mono'

const DIFFICULTY_OPTIONS = DIFFICULTIES.map((value) => ({
  value,
  label: DIFFICULTY_LABELS_JA[value],
}))

type DailyState =
  | { kind: 'fresh' }
  | { kind: 'playing'; game: Game }
  | { kind: 'finished'; game: Game }

function dailyState(game: Game | null): DailyState {
  if (game === null) return { kind: 'fresh' }
  return game.status === 'playing' ? { kind: 'playing', game } : { kind: 'finished', game }
}

function dailyStatusLabel(state: DailyState): string {
  if (state.kind === 'fresh') return '未挑戦'
  if (state.kind === 'playing') return `進行中 ${state.game.move_count} 手`
  if (state.game.status === 'cleared') {
    return state.game.perfect
      ? `完全錬成 ${state.game.move_count} 手`
      : `クリア済み ${state.game.move_count} 手`
  }
  return `ギブアップ ${state.game.move_count} 手`
}

function dailyActionLabel(state: DailyState): string {
  if (state.kind === 'fresh') return 'はじめる'
  if (state.kind === 'playing') return 'つづきから'
  return '結果を見る'
}

export default function LobbyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(LOBBY_TIER)

  const daily = useDailyQuery()
  const me = useMeQuery()
  const createGame = useCreateGameMutation()

  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void Promise.all([daily.refetch(), me.refetch()]).finally(() => setRefreshing(false))
  }, [daily, me])

  const state = dailyState(daily.data?.my_game ?? null)

  const onDailyPress = useCallback(() => {
    if (state.kind === 'playing') {
      router.push(gameHref(state.game.id))
      return
    }
    if (state.kind === 'finished') {
      router.push(resultHref(state.game.id))
      return
    }
    createGame.mutate({ mode: 'daily' }, { onSuccess: (game) => router.push(gameHref(game.id)) })
  }, [state, router, createGame])

  const onFreePress = useCallback(() => {
    createGame.mutate(
      { mode: 'free', difficulty },
      { onSuccess: (game) => router.push(gameHref(game.id)) },
    )
  }, [createGame, difficulty, router])

  const createError = createGame.isError ? toMessageJa(createGame.error) : null

  return (
    <TierBackground tier={LOBBY_TIER}>
      <ScrollView
        contentContainerStyle={[styles.content, screenInsets(insets)]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sub} />
        }
      >
        <View style={styles.header}>
          <Text style={[typography.largeTitle, { color: colors.text }]}>コトコトバ</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            言葉を混ぜて、ゴールの語に近づける
          </Text>
        </View>

        {/* ── 今日のデイリー ── */}
        {daily.isPending ? (
          <SkeletonCard />
        ) : daily.isError ? (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <ErrorState
              error={daily.error}
              onRetry={() => void daily.refetch()}
              tier={LOBBY_TIER}
              title="今日のデイリーを取れませんでした"
            />
          </GlassCard>
        ) : (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <View style={styles.row}>
              <Text style={[typography.label, { color: colors.sub }]}>今日のデイリー</Text>
              <Text style={[typography.label, { color: colors.sub }]}>{daily.data.date}</Text>
            </View>

            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              style={[
                typography.hero,
                styles.goal,
                {
                  color: colors.text,
                  fontSize: heroFontSize(daily.data.goal),
                  lineHeight: heroFontSize(daily.data.goal) * HERO_LINE_HEIGHT_RATIO,
                },
              ]}
            >
              {daily.data.goal}
            </Text>

            {daily.data.description !== null ? (
              <Text style={[typography.caption, { color: colors.sub }]} numberOfLines={2}>
                {daily.data.description}
              </Text>
            ) : null}

            <View style={styles.row}>
              <Text style={[typography.label, { color: colors.accent }]}>
                {DIFFICULTY_LABELS_JA[daily.data.difficulty]}
              </Text>
              <Text style={[typography.label, { color: colors.sub }]}>
                {dailyStatusLabel(state)} / 最大 {MAX_MOVES} 手
              </Text>
            </View>

            <GlassButton
              title={dailyActionLabel(state)}
              onPress={onDailyPress}
              tier={LOBBY_TIER}
              loading={createGame.isPending && createGame.variables?.mode === 'daily'}
            />
          </GlassCard>
        )}

        {/* ── フリーモード ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>フリーモード</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            何度でも挑戦できます（ランキング対象外）
          </Text>

          <Segmented
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={setDifficulty}
            tier={LOBBY_TIER}
          />

          <GlassButton
            title="あそぶ"
            onPress={onFreePress}
            tier={LOBBY_TIER}
            variant="secondary"
            loading={createGame.isPending && createGame.variables?.mode === 'free'}
            subtitle={
              me.isPending
                ? null
                : (bestFreeMovesLabel(me.data?.best_free_moves, difficulty) ??
                  '自己ベストはまだありません')
            }
          />
          {me.isPending ? <Skeleton width="50%" height={14} /> : null}
        </GlassCard>

        {createError !== null ? (
          <Text style={[typography.caption, styles.error, { color: colors.sub }]}>
            {createError}
          </Text>
        ) : null}
      </ScrollView>
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: layout.sectionGap,
  },
  // 見出しと一行説明は同じ塊なので近づける。
  header: { gap: spacing.xs },
  card: { gap: layout.cardGap, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goal: { textAlign: 'center', paddingVertical: spacing.sm },
  error: { textAlign: 'center' },
})
