/**
 * 結果画面（SPEC §8.4）。
 *
 * goal / start / 手数 / ヒント数 / tier のマスで表した経路 / 完全錬成の特別表示 /
 * 解除した実績。ボタンはシェア（**このステージではテキストのみ**。画像は次の担当者）、
 * 図鑑で見る（未実装なので無効）、ブースモード時は「次の人へ」。
 *
 * 解除した実績はゲーム画面から `?unlocked=id1,id2` で渡ってくる。
 * 直接開いた（リロードした）ときは空でよい。
 */

import { DIFFICULTY_LABELS_JA, MAX_MOVES } from '@coto2ba/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassCard,
  PATH_CELL_FONT_SIZE,
  PATH_CELL_LINE_HEIGHT_RATIO,
  PrimaryButton,
  SkeletonCard,
  TierBackground,
  toMessageJa,
} from '../../../../components'
import {
  achievementDescription,
  achievementTitle,
  currentTier,
  LOBBY_HREF,
  parseAchievementIds,
  shareText,
  tierPath,
  useGameQuery,
} from '../../../../features/game'
import { resetSession } from '../../../../lib/auth'
import { queryClient } from '../../../../lib/queryClient'
import { useSettingsStore } from '../../../../store/settings'
import { layout, paletteForTier, spacing, typography } from '../../../../theme'

export default function ResultScreen() {
  const { id, unlocked } = useLocalSearchParams<{ id: string; unlocked?: string }>()
  const gameId = typeof id === 'string' ? id : ''
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const game = useGameQuery(gameId)
  const boothMode = useSettingsStore((s) => s.boothMode)
  const [shareError, setShareError] = useState<string | null>(null)
  const [handingOver, setHandingOver] = useState(false)

  const achievements = useMemo(() => parseAchievementIds(unlocked), [unlocked])

  const detail = game.data ?? null
  const tier = detail === null ? 'mono' : currentTier(detail)
  const colors = paletteForTier(tier)

  const onShare = useCallback(() => {
    if (detail === null) return
    setShareError(null)
    void Share.share({ message: shareText(detail) }).catch((error: unknown) => {
      setShareError(toMessageJa(error))
    })
  }, [detail])

  /** ブースモード：新しい匿名ユーザーに差し替えてロビーへ戻る（SPEC §8.8）。 */
  const onNextPlayer = useCallback(() => {
    setHandingOver(true)
    void resetSession().finally(() => {
      queryClient.clear()
      setHandingOver(false)
      router.replace(LOBBY_HREF)
    })
  }, [router])

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
            title="結果を読み込めませんでした"
          />
        </View>
      </TierBackground>
    )
  }

  const cleared = detail.status === 'cleared'
  const path = tierPath(detail)

  return (
    <TierBackground tier={tier}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={[typography.title, styles.headline, { color: colors.text }]}>
          {detail.perfect ? '完全錬成' : cleared ? 'クリア' : 'ギブアップ'}
        </Text>

        {detail.perfect ? (
          <Text style={[typography.caption, styles.headline, { color: colors.accent }]}>
            ゴールの語そのものを錬成しました
          </Text>
        ) : null}

        <GlassCard tint={colors.glassTint} style={styles.card}>
          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.sub }]}>スタート</Text>
            <Text style={[typography.body, { color: colors.text }]}>{detail.start}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.sub }]}>ゴール</Text>
            <Text style={[typography.body, { color: colors.text }]}>{detail.goal}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.sub }]}>難易度</Text>
            <Text style={[typography.body, { color: colors.text }]}>
              {DIFFICULTY_LABELS_JA[detail.difficulty]}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[typography.label, { color: colors.sub }]}>手数 / ヒント</Text>
            <Text style={[typography.mono, { color: colors.text }]}>
              {detail.move_count} / {MAX_MOVES} 手 ・ ヒント {detail.hint_count}
            </Text>
          </View>

          <Text style={[styles.path, { color: colors.text }]}>
            {path.length > 0 ? path.join('') : 'まだ 1 手も打っていません'}
          </Text>
        </GlassCard>

        {achievements.length > 0 ? (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <Text style={[typography.label, { color: colors.sub }]}>解除した実績</Text>
            {achievements.map((achievementId) => (
              <View key={achievementId} style={styles.achievement}>
                <Text style={[typography.body, { color: colors.text }]}>
                  {achievementTitle(achievementId)}
                </Text>
                <Text style={[typography.label, { color: colors.sub }]}>
                  {achievementDescription(achievementId)}
                </Text>
              </View>
            ))}
          </GlassCard>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton title="シェア" onPress={onShare} tier={tier} />
          <PrimaryButton
            title="図鑑で見る（準備中）"
            onPress={() => undefined}
            tier={tier}
            variant="ghost"
            disabled
          />
          {boothMode ? (
            <PrimaryButton
              title="次の人へ"
              onPress={onNextPlayer}
              tier={tier}
              variant="secondary"
              loading={handingOver}
            />
          ) : (
            <PrimaryButton
              title="ロビーに戻る"
              onPress={() => router.replace(LOBBY_HREF)}
              tier={tier}
              variant="secondary"
            />
          )}
        </View>

        {shareError !== null ? (
          <Text style={[typography.caption, styles.headline, { color: colors.sub }]}>
            {shareError}
          </Text>
        ) : null}
      </ScrollView>
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.lg,
  },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: layout.screenPaddingHorizontal },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headline: { textAlign: 'center' },
  path: {
    fontSize: PATH_CELL_FONT_SIZE,
    lineHeight: PATH_CELL_FONT_SIZE * PATH_CELL_LINE_HEIGHT_RATIO,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
  achievement: { gap: spacing.xs, paddingVertical: spacing.xs },
  actions: { gap: spacing.md, marginTop: 'auto' },
})
