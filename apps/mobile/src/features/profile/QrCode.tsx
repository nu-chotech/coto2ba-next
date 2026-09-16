/**
 * QR コードの描画（Skia）。
 *
 * **`react-native-svg` も QR ライブラリも依存に無い**ので、`qr.ts` で組んだ
 * モジュール行列を Skia の矩形パス 1 本にまとめて描く（1 ドロー）。
 *
 * スキャナのために **地は白・モジュールは黒**にする。暗いアプリの中でも
 * ここだけは白い紙のように見せる。静穏帯（4 モジュール）を内側に必ず取る。
 *
 * 長すぎて QR にできないときは `null` を返す（呼び出し側はトークン文字列を出す）。
 */

import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { palette, radius } from '../../theme'
import { QR_QUIET_ZONE_MODULES } from './constants'
import { encodeQr, type QrEcLevel } from './qr'

export type QrCodeProps = {
  /** QR に入れる文字列（引き継ぎ URL）。 */
  value: string
  /** 一辺（pt）。静穏帯を含む。 */
  size: number
  ecLevel?: QrEcLevel
  style?: StyleProp<ViewStyle>
}

export function QrCode({ value, size, ecLevel = 'M', style }: QrCodeProps) {
  const matrix = useMemo(() => encodeQr(value, ecLevel), [value, ecLevel])

  const path = useMemo<SkPath | null>(() => {
    if (matrix === null) return null
    const total = matrix.size + QR_QUIET_ZONE_MODULES * 2
    const unit = size / total
    const offset = QR_QUIET_ZONE_MODULES * unit
    const next = Skia.Path.Make()
    for (let row = 0; row < matrix.size; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) {
        if (matrix.modules[row * matrix.size + col] !== 1) continue
        // 隣接モジュールの継ぎ目に白い筋が出ないよう、わずかに広げて敷き詰める。
        next.addRect(
          Skia.XYWHRect(offset + col * unit, offset + row * unit, unit + 0.5, unit + 0.5),
        )
      }
    }
    return next
  }, [matrix, size])

  if (matrix === null || path === null) return null

  return (
    <View style={[styles.sheet, { width: size, height: size }, style]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={path} color={palette.black} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: palette.white,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
})
