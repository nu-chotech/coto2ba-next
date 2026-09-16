/**
 * 取得に失敗したときの表示 + 再試行。
 *
 * **サーバーがまだ動いていなくても画面が壊れないこと** が要件なので、
 * 画面はどれもこれを置いて「白い画面で固まる」を防ぐ。
 */

import type { TierId } from '@coto2ba/contracts'
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { isApiError } from '../lib/api'
import { paletteForTier, spacing, typography } from '../theme'
import { PrimaryButton } from './PrimaryButton'

/** 何が起きても日本語の 1 文にする。 */
export function toMessageJa(error: unknown): string {
  if (isApiError(error)) return error.messageJa
  if (error instanceof Error && error.message.length > 0) return error.message
  return '通信に失敗しました'
}

export type ErrorStateProps = {
  error: unknown
  onRetry: () => void
  tier?: TierId
  /** 見出し。既定は「うまくいきませんでした」。 */
  title?: string
  style?: StyleProp<ViewStyle>
}

export function ErrorState({
  error,
  onRetry,
  tier = 'mono',
  title = 'うまくいきませんでした',
  style,
}: ErrorStateProps) {
  const colors = paletteForTier(tier)
  return (
    <View style={[styles.root, style]}>
      <Text style={[typography.subtitle, { color: colors.text }]}>{title}</Text>
      <Text style={[typography.caption, styles.message, { color: colors.sub }]}>
        {toMessageJa(error)}
      </Text>
      <PrimaryButton title="もう一度" onPress={onRetry} tier={tier} variant="secondary" />
    </View>
  )
}

/** まだ中身が無いタブ用（図鑑・ランキング・設定）。 */
export function PlaceholderState({
  title,
  description,
  tier = 'mono',
}: {
  title: string
  description: string
  tier?: TierId
}) {
  const colors = paletteForTier(tier)
  return (
    <View style={styles.placeholder}>
      <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
      <Text style={[typography.caption, styles.message, { color: colors.sub }]}>{description}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing.md, alignItems: 'stretch' },
  message: { textAlign: 'left' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
})
