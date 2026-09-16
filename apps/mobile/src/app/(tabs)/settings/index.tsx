/**
 * 設定（SPEC §8.2 / §8.8）。
 *
 * - 表示名の変更（contracts の `DISPLAY_NAME_MIN/MAX_LENGTH`）
 * - ブースモード（サーバーの `users.booth` が権威。PATCH してから store に反映）
 * - 引き継ぎ QR（`POST /api/transfer` → QR + トークン文字列 + コピー）
 * - サウンド / ハプティクス（端末ローカルの好み）
 * - クレジット
 *
 * **表示名の TextInput は controlled にしない**（ARCHITECTURE §5: CJK IME）。
 * `defaultValue` + ref、`maxLength` なし、確定は保存ボタン。
 *
 * サーバーが落ちていても画面は開く（各セクションが独立に失敗する）。
 */

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  TRANSFER_TOKEN_TTL_MINUTES,
} from '@coto2ba/contracts'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ErrorState,
  GlassCard,
  PrimaryButton,
  Skeleton,
  TierBackground,
  toMessageJa,
} from '../../../components'
import { useMeQuery } from '../../../features/game'
import {
  COPY_FEEDBACK_MS,
  checkDisplayName,
  chunkToken,
  QR_EC_LEVEL,
  QR_MAX_SIZE,
  QrCode,
  SETTINGS_ROW_MIN_HEIGHT,
  TOKEN_CHUNK_SIZE,
  useCreateTransferMutation,
  useUpdateProfileMutation,
} from '../../../features/profile'
import { isDevApiUrl, resolveApiBaseUrl } from '../../../lib/config'
import { feedback } from '../../../lib/feedback'
import { useSettingsStore } from '../../../store/settings'
import {
  borderWidth,
  layout,
  palette,
  paletteForTier,
  radius,
  spacing,
  typography,
} from '../../../theme'

/** 設定は演出帯を持たない。 */
const SETTINGS_TIER = 'mono'
const colors = paletteForTier(SETTINGS_TIER)

const CREDITS = [
  {
    id: 'team',
    title: 'ChoTech / 長崎大学',
    description: '企画・開発',
    url: null,
  },
  {
    id: 'wikientvec',
    title: 'WikiEntVec（日本語 Wikipedia エンティティベクトル）',
    description: '語のベクトル。CC BY-SA 3.0（継承）',
    url: 'https://github.com/singletongue/WikiEntVec',
  },
  {
    id: 'inappropriate-words-ja',
    title: 'MosasoM/inappropriate-words-ja',
    description: 'NG 語リスト。MIT License',
    url: 'https://github.com/MosasoM/inappropriate-words-ja',
  },
  {
    id: 'ldnoobw',
    title: 'LDNOOBW (List of Dirty, Naughty, Obscene and Otherwise Bad Words) 日本語',
    description: 'NG 語リスト。CC BY 4.0',
    url: 'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
  },
  {
    id: 'unidic',
    title: 'UniDic（unidic-lite）',
    description: '形態素解析辞書。BSD / GPL / LGPL のトリプルライセンス',
    url: 'https://clrd.ninjal.ac.jp/unidic/',
  },
] as const

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const me = useMeQuery()
  const updateProfile = useUpdateProfileMutation()
  const transfer = useCreateTransferMutation()

  const soundEnabled = useSettingsStore((s) => s.soundEnabled)
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled)
  const boothMode = useSettingsStore((s) => s.boothMode)
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled)
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled)

  const [refreshing, setRefreshing] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // 表示名は uncontrolled。サーバーの値が来たら key を進めて作り直す。
  const draftName = useRef('')
  const serverName = me.data?.display_name ?? ''
  useEffect(() => {
    draftName.current = serverName
  }, [serverName])

  // サーバーの booth を store に揃える（GET /api/me の結果が権威）。
  const serverBooth = me.data?.booth
  useEffect(() => {
    if (serverBooth !== undefined)
      useSettingsStore.getState().syncFromServer({ booth: serverBooth })
  }, [serverBooth])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void me.refetch().finally(() => setRefreshing(false))
  }, [me])

  const onSaveName = useCallback(() => {
    const checked = checkDisplayName(draftName.current)
    if (!checked.ok) {
      setNameError(checked.message)
      setNameSaved(false)
      feedback('error_oov')
      return
    }
    setNameError(null)
    updateProfile.mutate(
      { display_name: checked.value },
      {
        onSuccess: () => {
          setNameSaved(true)
          feedback('achievement')
        },
        onError: (error: unknown) => {
          setNameSaved(false)
          setNameError(toMessageJa(error))
        },
      },
    )
  }, [updateProfile])

  const onToggleBooth = useCallback(
    (next: boolean) => {
      // 楽観的に切り替えてから PATCH。失敗したらサーバーの値で戻す。
      useSettingsStore.getState().setBoothMode(next)
      updateProfile.mutate(
        { booth: next },
        {
          onError: () => {
            useSettingsStore.getState().setBoothMode(!next)
          },
        },
      )
    },
    [updateProfile],
  )

  const onCreateTransfer = useCallback(() => {
    setCopied(false)
    transfer.mutate()
  }, [transfer])

  const onCopy = useCallback((text: string) => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true)
      feedback('hint_open')
    })
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const qrSize = Math.min(QR_MAX_SIZE, width - layout.screenPaddingHorizontal * 2 - spacing.xl * 2)
  const transferData = transfer.data ?? null
  const expiresLabel = useMemo(() => formatExpiry(transferData?.expires_at ?? null), [transferData])

  return (
    <TierBackground tier={SETTINGS_TIER}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sub} />
        }
      >
        <Text style={[typography.title, { color: colors.text }]}>設定</Text>

        {/* ── 表示名 ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>表示名</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            ランキングに出る名前です（{DISPLAY_NAME_MIN_LENGTH}〜{DISPLAY_NAME_MAX_LENGTH} 文字）。
          </Text>

          {me.isPending ? (
            <Skeleton height={layout.inputHeight} cornerRadius={radius.md} />
          ) : (
            <TextInput
              key={`display-name-${serverName}`}
              defaultValue={serverName}
              onChangeText={(text) => {
                draftName.current = text
                setNameSaved(false)
              }}
              placeholder="なまえ"
              placeholderTextColor={colors.sub}
              autoCorrect={false}
              autoCapitalize="none"
              submitBehavior="blurAndSubmit"
              style={[
                typography.body,
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.sub },
              ]}
            />
          )}

          <Text
            style={[
              typography.label,
              { color: nameError !== null ? palette.negative : colors.sub },
            ]}
          >
            {nameError ?? (nameSaved ? '保存しました' : ' ')}
          </Text>

          <PrimaryButton
            title="名前を保存"
            onPress={onSaveName}
            tier={SETTINGS_TIER}
            variant="secondary"
            disabled={me.isPending}
            loading={updateProfile.isPending && updateProfile.variables?.display_name !== undefined}
          />
        </GlassCard>

        {/* ── ブースモード ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <ToggleRow
            title="ブースモード"
            description="結果画面に「次の人へ」が出ます。押すと新しい匿名ユーザーに切り替わります。"
            value={boothMode}
            onChange={onToggleBooth}
            disabled={me.isPending}
          />
          {updateProfile.isError ? (
            <Text style={[typography.label, { color: palette.negative }]}>
              {toMessageJa(updateProfile.error)}
            </Text>
          ) : null}
        </GlassCard>

        {/* ── 引き継ぎ ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>別の端末に引き継ぐ</Text>
          <Text style={[typography.caption, { color: colors.sub }]}>
            引き継ぎコードは {TRANSFER_TOKEN_TTL_MINUTES} 分で切れます。 新しい端末でこの QR
            を読み取るか、コードを貼り付けてください。
          </Text>

          {transfer.isError ? (
            <ErrorState
              error={transfer.error}
              onRetry={onCreateTransfer}
              tier={SETTINGS_TIER}
              title="引き継ぎコードを作れませんでした"
            />
          ) : null}

          {transferData !== null ? (
            <View style={styles.transfer}>
              <QrCode value={transferData.url} size={qrSize} ecLevel={QR_EC_LEVEL} />
              <Text style={[typography.mono, styles.token, { color: colors.text }]} selectable>
                {chunkToken(transferData.token, TOKEN_CHUNK_SIZE)}
              </Text>
              <Text style={[typography.label, { color: colors.sub }]}>{expiresLabel}</Text>
              <View style={styles.copyRow}>
                <CopyButton label="コードをコピー" onPress={() => onCopy(transferData.token)} />
                <CopyButton label="URL をコピー" onPress={() => onCopy(transferData.url)} />
              </View>
              <Text style={[typography.label, { color: colors.sub }]}>
                {copied ? 'コピーしました' : ' '}
              </Text>
            </View>
          ) : null}

          <PrimaryButton
            title={transferData === null ? '引き継ぎコードを作る' : 'コードを作り直す'}
            onPress={onCreateTransfer}
            tier={SETTINGS_TIER}
            variant="secondary"
            loading={transfer.isPending}
          />
        </GlassCard>

        {/* ── 音とハプティクス ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <ToggleRow
            title="効果音"
            description="端末がサイレントのときは鳴りません。"
            value={soundEnabled}
            onChange={setSoundEnabled}
          />
          <View style={styles.divider} />
          <ToggleRow
            title="ハプティクス"
            description="混合・ランク変化・クリアで振動します。"
            value={hapticsEnabled}
            onChange={(next) => {
              setHapticsEnabled(next)
              if (next) feedback('slider_detent')
            }}
          />
        </GlassCard>

        {/* ── クレジット ── */}
        <GlassCard tint={colors.glassTint} style={styles.card}>
          <Text style={[typography.label, { color: colors.sub }]}>クレジット</Text>
          {CREDITS.map((credit) => (
            <Pressable
              key={credit.id}
              disabled={credit.url === null}
              onPress={() => {
                if (credit.url !== null) void WebBrowser.openBrowserAsync(credit.url)
              }}
              style={({ pressed }) => [
                styles.credit,
                { backgroundColor: pressed ? palette.pressed : palette.transparent },
              ]}
            >
              <Text style={[typography.body, { color: colors.text }]}>{credit.title}</Text>
              <Text style={[typography.label, { color: colors.sub }]}>{credit.description}</Text>
            </Pressable>
          ))}
          <Text style={[typography.label, { color: colors.sub }]}>
            ベクトルは CC BY-SA 3.0 の継承対象です。派生データを公開するときは同じ条件で。
          </Text>
        </GlassCard>

        {/* ── 接続先（デバッグ）── */}
        <Text style={[typography.label, styles.footer, { color: colors.sub }]}>
          API: {resolveApiBaseUrl()}
          {isDevApiUrl() ? '（開発）' : ''}
        </Text>
      </ScrollView>
    </TierBackground>
  )
}

function ToggleRow({
  title,
  description,
  value,
  onChange,
  disabled = false,
}: {
  title: string
  description: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[typography.body, { color: colors.text }]}>{title}</Text>
        <Text style={[typography.label, { color: colors.sub }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: palette.divider, true: colors.accent }}
        thumbColor={palette.white}
      />
    </View>
  )
}

function CopyButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.copyButton,
        {
          borderColor: colors.sub,
          backgroundColor: pressed ? palette.pressed : palette.transparent,
        },
      ]}
    >
      <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

/** 「あと 9 分で切れます」。壊れた値なら TTL をそのまま案内する。 */
function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return ''
  const at = new Date(expiresAt).getTime()
  if (Number.isNaN(at)) return `${TRANSFER_TOKEN_TTL_MINUTES} 分で切れます`
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60_000))
  return minutes <= 0 ? '期限が切れました。作り直してください' : `あと ${minutes} 分で切れます`
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.lg,
  },
  card: { gap: spacing.sm },
  input: {
    height: layout.inputHeight,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    paddingHorizontal: spacing.lg,
  },
  toggleRow: {
    minHeight: SETTINGS_ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  toggleText: { flex: 1, gap: spacing.xs },
  divider: { height: borderWidth.hairline, backgroundColor: palette.divider },
  transfer: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  token: { textAlign: 'center', letterSpacing: 1 },
  copyRow: { flexDirection: 'row', gap: spacing.sm },
  copyButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
  credit: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  footer: { textAlign: 'center' },
})
