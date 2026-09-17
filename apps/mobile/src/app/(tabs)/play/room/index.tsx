/**
 * 対戦の入口（SPEC §9.5）。
 *
 * - ホスト: 難易度を選んで部屋を作る → コードと QR が出る
 * - 参加者: コードを入れて入る（QR で開いた場合はここを通らずに部屋へ飛ぶ）
 *
 * **コードの入力欄は英数字なので controlled にしてよい**（CJK IME を通らない）。
 * ただし判定の権威はサーバー。ここでの正規化は打ち間違いの吸収だけ。
 */

import {
  DIFFICULTIES,
  DIFFICULTY_LABELS_JA,
  type Difficulty,
  ROOM_CODE_LENGTH,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
} from '@coto2ba/contracts'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  GlassButton,
  GlassCard,
  Segmented,
  TierBackground,
  toMessageJa,
} from '../../../../components'
import { LOBBY_HREF } from '../../../../features/game'
import {
  normalizeRoomCode,
  roomHref,
  useCreateRoomMutation,
  useJoinRoomMutation,
} from '../../../../features/rooms'
import { layout, radius, screenPadding, spacing, typography, useTheme } from '../../../../theme'

/** 入口は演出帯を持たない。ロビーと同じ落ち着いた地。 */
const ENTRY_TIER = 'mono'

const DIFFICULTY_OPTIONS = DIFFICULTIES.map((value) => ({
  value,
  label: DIFFICULTY_LABELS_JA[value],
}))

export default function RoomEntryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(ENTRY_TIER)

  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [code, setCode] = useState('')

  const createRoom = useCreateRoomMutation()
  const joinRoom = useJoinRoomMutation()

  const onCreate = useCallback(() => {
    createRoom.mutate({ difficulty }, { onSuccess: (room) => router.replace(roomHref(room.code)) })
  }, [createRoom, difficulty, router])

  const onJoin = useCallback(() => {
    const normalized = normalizeRoomCode(code)
    if (normalized.length === 0) return
    joinRoom.mutate(normalized, {
      onSuccess: (room) => router.replace(roomHref(room.code)),
    })
  }, [code, joinRoom, router])

  const createError = createRoom.isError ? toMessageJa(createRoom.error) : null
  const joinError = joinRoom.isError ? toMessageJa(joinRoom.error) : null
  const canJoin = normalizeRoomCode(code).length > 0

  return (
    <TierBackground tier={ENTRY_TIER}>
      <ScrollView
        contentContainerStyle={[styles.content, screenPadding(insets)]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[typography.largeTitle, { color: colors.text }]}>みんなで対戦</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            {ROOM_MIN_PLAYERS}〜{ROOM_MAX_PLAYERS} 人で同じお題を解きます。
            最初にゴールへ着いた人が勝ちです。
          </Text>
        </View>

        {/* ── 部屋を作る ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>部屋を作る</Text>
          <Segmented
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={setDifficulty}
            tier={ENTRY_TIER}
          />
          <GlassButton
            title="部屋を作る"
            onPress={onCreate}
            tier={ENTRY_TIER}
            loading={createRoom.isPending}
            subtitle="コードと QR が出ます。みんなが入ったら開始してください"
          />
          {createError !== null ? (
            <Text style={[typography.caption, styles.center, { color: palette.negative }]}>
              {createError}
            </Text>
          ) : null}
        </GlassCard>

        {/* ── コードで参加する ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>コードで参加する</Text>
          <TextInput
            value={code}
            onChangeText={(text) => setCode(normalizeRoomCode(text))}
            onSubmitEditing={onJoin}
            placeholder={'A'.repeat(ROOM_CODE_LENGTH)}
            placeholderTextColor={colors.sub}
            autoCorrect={false}
            autoComplete="off"
            autoCapitalize="characters"
            submitBehavior="blurAndSubmit"
            accessibilityLabel="参加コード"
            style={[
              typography.mono,
              styles.input,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.sub },
            ]}
          />
          <GlassButton
            title="参加する"
            onPress={onJoin}
            tier={ENTRY_TIER}
            variant="secondary"
            disabled={!canJoin}
            loading={joinRoom.isPending}
          />
          {joinError !== null ? (
            <Text style={[typography.caption, styles.center, { color: palette.negative }]}>
              {joinError}
            </Text>
          ) : null}
        </GlassCard>

        <GlassButton
          title="ロビーへ戻る"
          onPress={() => router.replace(LOBBY_HREF)}
          tier={ENTRY_TIER}
          variant="ghost"
        />
      </ScrollView>
    </TierBackground>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: layout.sectionGap,
  },
  header: { gap: spacing.sm },
  card: { gap: layout.cardGap, borderRadius: radius.lg },
  center: { textAlign: 'center' },
  input: {
    height: layout.inputHeight,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
})
