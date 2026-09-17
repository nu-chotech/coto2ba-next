/**
 * 部屋の待機画面（設計 §9.5）。
 *
 * ブースのホスト端末に出すものなので、**コードと QR を大きく**出す。
 * 離れた位置から読めること、口で読み上げられること、の両方を満たす。
 *
 * 参加者は 1 秒ポーリングで増えていくのが見える。
 * 開始ボタンはホストにだけ出し、人数が足りないあいだは無効にする
 * （**判定はサーバー**。ここで押せても `canStart` を通らなければ始まらない）。
 *
 * お題（goal / start）は待機中サーバーが伏せている。先に考え始められると
 * レースにならないため、ここにも出す手段が無い。
 */

import {
  DIFFICULTY_LABELS_JA,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  type RoomResponse,
} from '@coto2ba/contracts'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { GlassButton, GlassCard, isSkiaAvailable, SymbolIcon } from '../../components'
import { iconSize, layout, radius, spacing, typography, useTheme } from '../../theme'
import { encodeQr, QR_EC_FALLBACK_LEVEL, QR_EC_LEVEL, QrCode } from '../profile'
import { ROOM_CODE_FONT_SIZE, ROOM_CODE_LETTER_SPACING, ROOM_QR_MAX_SIZE } from './constants'

/** 待機画面は演出帯を持たない。ロビーと同じ落ち着いた地。 */
const LOBBY_TIER = 'mono'

export type RoomLobbyProps = {
  room: RoomResponse
  /** 自分がホストか（開始ボタンを出すか）。 */
  isHost: boolean
  onStart: () => void
  starting: boolean
  /** 開始に失敗したときの一言。null なら出さない。 */
  startError: string | null
  onLeave: () => void
}

export function RoomLobby({
  room,
  isHost,
  onStart,
  starting,
  startError,
  onLeave,
}: RoomLobbyProps) {
  const { width } = useWindowDimensions()
  const { paletteForTier } = useTheme()
  const colors = paletteForTier(LOBBY_TIER)

  const qrSize = Math.min(
    ROOM_QR_MAX_SIZE,
    width - layout.screenPaddingHorizontal * 2 - spacing.xl * 2,
  )
  // 収まらない強さだと QR が丸ごと消えるので、入らなければ 1 段落とす。
  const qrEcLevel =
    encodeQr(room.join_url, QR_EC_LEVEL) === null ? QR_EC_FALLBACK_LEVEL : QR_EC_LEVEL
  /**
   * **QR は Skia で描いている。** Web は CanvasKit(WASM) が未ロードなので
   * そのまま描くと画面ごと落ちる（実際に落ちた）。
   * コードは必ず大きく出しているので、QR が出ない環境では手入力で回る。
   */
  const canDrawQr = isSkiaAvailable()

  const enough = room.players.length >= ROOM_MIN_PLAYERS

  return (
    <>
      <GlassCard tint={colors.glassTint} style={styles.card}>
        <Text style={[typography.label, { color: colors.sub }]}>参加コード</Text>
        <Text
          accessibilityLabel={`参加コード ${room.code.split('').join(' ')}`}
          style={[
            typography.mono,
            styles.code,
            {
              color: colors.text,
              fontSize: ROOM_CODE_FONT_SIZE,
              lineHeight: ROOM_CODE_FONT_SIZE * 1.1,
              letterSpacing: ROOM_CODE_LETTER_SPACING,
            },
          ]}
        >
          {room.code}
        </Text>

        {canDrawQr ? (
          <View style={styles.qr}>
            <QrCode value={room.join_url} size={qrSize} ecLevel={qrEcLevel} />
          </View>
        ) : null}
        <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
          {canDrawQr
            ? 'カメラで読み取るか、コードを入れて参加できます'
            : 'このコードを「みんなで対戦」の入力欄に入れると参加できます'}
        </Text>
      </GlassCard>

      <GlassCard tint={colors.glassTint} style={styles.card}>
        <View style={styles.row}>
          <Text style={[typography.label, { color: colors.sub }]}>
            参加者 {room.players.length} / {ROOM_MAX_PLAYERS}
          </Text>
          <Text style={[typography.label, { color: colors.accent }]}>
            {DIFFICULTY_LABELS_JA[room.difficulty]}
          </Text>
        </View>

        <View style={styles.players}>
          {room.players.map((player) => (
            <View key={player.user_id} style={styles.player}>
              <SymbolIcon
                name={player.user_id === room.host_user_id ? 'crown.fill' : 'checkmark'}
                size={iconSize.sm}
                color={colors.sub}
              />
              <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
                {player.display_name}
                {player.is_me ? '（あなた）' : ''}
              </Text>
            </View>
          ))}
        </View>

        {isHost ? (
          <GlassButton
            title="はじめる"
            onPress={onStart}
            tier={LOBBY_TIER}
            loading={starting}
            disabled={!enough}
            subtitle={
              enough
                ? '全員が同じお題を解きます。最初にゴールへ着いた人が勝ちです'
                : `あと ${ROOM_MIN_PLAYERS - room.players.length} 人であそべます`
            }
          />
        ) : (
          <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
            ホストがはじめるのを待っています
          </Text>
        )}

        {startError !== null ? (
          <Text style={[typography.caption, styles.center, { color: colors.sub }]}>
            {startError}
          </Text>
        ) : null}
      </GlassCard>

      <GlassButton title="やめる" onPress={onLeave} tier={LOBBY_TIER} variant="ghost" />
    </>
  )
}

const styles = StyleSheet.create({
  card: { gap: layout.cardGap, borderRadius: radius.lg },
  code: { textAlign: 'center', paddingVertical: spacing.sm },
  qr: { alignItems: 'center', paddingVertical: spacing.sm },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  players: { gap: spacing.sm },
  player: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
