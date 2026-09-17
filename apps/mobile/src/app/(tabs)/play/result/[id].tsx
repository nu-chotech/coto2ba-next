/**
 * 結果画面（SPEC §8.4）。
 *
 * goal / start / 手数 / ヒント数 / tier のマスで表した経路 / 完全錬成の特別表示 /
 * 解除した実績。ボタンはシェア（`features/share` の画像シェア。captureRef →
 * Skia → テキストの 3 段で落ちる）、図鑑で見る（未実装なので無効）、
 * ブースモード時は「次の人へ」。
 *
 * シェアの撮影対象 `ShareCardHost` は **この画面の中にマウントしておくこと**
 * （`position:absolute` で画面の外に追いやるのでレイアウトには出ない。
 * `opacity: 0` は使わない ── ARCHITECTURE §5 の通り描画されなくなる）。
 * アンマウントされていると撮れない。
 *
 * 解除した実績はゲーム画面から `?unlocked=id1,id2` で渡ってくる。
 * 直接開いた（リロードした）ときは空でよい。
 */

import { DIFFICULTY_LABELS_JA, MAX_MOVES } from '@coto2ba/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  achievementIcon,
  ErrorState,
  GlassButton,
  GlassCard,
  SkeletonCard,
  SymbolIcon,
  TierBackground,
  TierPath,
} from '../../../../components'
import {
  achievementDescription,
  achievementTitle,
  currentTier,
  LOBBY_HREF,
  parseAchievementIds,
  useGameQuery,
} from '../../../../features/game'
import { ShareCardHost, useShareResult } from '../../../../features/share'
import { resetSession } from '../../../../lib/auth'
import { queryClient } from '../../../../lib/queryClient'
import { useSettingsStore } from '../../../../store/settings'
import { iconSize, layout, paletteForTier, spacing, typography } from '../../../../theme'

export default function ResultScreen() {
  const { id, unlocked } = useLocalSearchParams<{ id: string; unlocked?: string }>()
  const gameId = typeof id === 'string' ? id : ''
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const game = useGameQuery(gameId)
  const boothMode = useSettingsStore((s) => s.boothMode)
  const [handingOver, setHandingOver] = useState(false)

  const achievements = useMemo(() => parseAchievementIds(unlocked), [unlocked])

  const detail = game.data ?? null
  const tier = detail === null ? 'mono' : currentTier(detail)
  const colors = paletteForTier(tier)

  // 画像 + テキストのシェア（SPEC §8.4）。`hostRef` の先は下でマウントする。
  const { hostRef, share, isSharing, error: shareError } = useShareResult(detail)

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
  // 経路は tier の色そのままで出す。`tierPath()` の絵文字はシェアテキスト専用。
  const path = detail.moves

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

          {path.length > 0 ? (
            <TierPath moves={path} style={styles.path} />
          ) : (
            <Text style={[typography.caption, styles.headline, { color: colors.sub }]}>
              まだ 1 手も打っていません
            </Text>
          )}
        </GlassCard>

        {achievements.length > 0 ? (
          <GlassCard tint={colors.glassTint} style={styles.card}>
            <Text style={[typography.label, { color: colors.sub }]}>解除した実績</Text>
            {achievements.map((achievementId) => (
              <View key={achievementId} style={styles.achievement}>
                <SymbolIcon
                  name={achievementIcon(achievementId)}
                  size={iconSize.lg}
                  color={colors.accent}
                />
                <View style={styles.achievementText}>
                  <Text style={[typography.body, { color: colors.text }]}>
                    {achievementTitle(achievementId)}
                  </Text>
                  <Text style={[typography.label, { color: colors.sub }]}>
                    {achievementDescription(achievementId)}
                  </Text>
                </View>
              </View>
            ))}
          </GlassCard>
        ) : null}

        <View style={styles.actions}>
          <GlassButton
            title="シェア"
            icon="square.and.arrow.up"
            onPress={share}
            tier={tier}
            loading={isSharing}
          />
          {/* 失敗の理由はトーストではなくボタンの下に 1 行で。 */}
          {shareError !== null ? (
            <Text
              style={[typography.label, styles.shareError, { color: colors.sub }]}
              numberOfLines={1}
            >
              シェアできませんでした（{shareError}）
            </Text>
          ) : null}
          <GlassButton
            title="図鑑で見る（準備中）"
            onPress={() => undefined}
            tier={tier}
            variant="ghost"
            disabled
          />
          {boothMode ? (
            <GlassButton
              title="次の人へ"
              onPress={onNextPlayer}
              tier={tier}
              variant="secondary"
              loading={handingOver}
            />
          ) : (
            <GlassButton
              title="ロビーに戻る"
              onPress={() => router.replace(LOBBY_HREF)}
              tier={tier}
              variant="secondary"
            />
          )}
        </View>
      </ScrollView>

      {/* 画面外に置く撮影用のカード。見えないがマウントは必須（ScrollView の外に置く）。 */}
      <ShareCardHost hostRef={hostRef} game={detail} />
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
  path: { paddingTop: spacing.sm },
  achievement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  achievementText: { flex: 1, gap: spacing.xs },
  shareError: { textAlign: 'center' },
  actions: { gap: spacing.md, marginTop: 'auto' },
})
