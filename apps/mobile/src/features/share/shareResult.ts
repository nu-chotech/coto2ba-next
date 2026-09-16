/**
 * 結果のシェア（SPEC §8.4）。
 *
 * 手段を 3 段で落としていく。**どれかは必ず動く**ように組んである。
 *
 * 1. `react-native-view-shot` の `captureRef`（純粋な RN ビューのカードを PNG に）
 *    - Expo Go 同梱だが、**Expo Go のバイナリが古い版（4.0.3）を抱えている可能性がある**
 *      （ARCHITECTURE §0）。呼べずに例外になることがあるので必ず try で囲む。
 * 2. Skia の `drawAsImage`（オフスクリーンで 1080×1350 に描いて PNG に）
 *    - 画面にマウントする必要がない。フォントは `matchFont` でシステムから引く。
 * 3. テキストだけ（`shareText()`）
 *
 * 画像ができたら共有シートへ。iOS は RN の `Share`（`message` + `url` を同時に渡せるので
 * SPEC §8.4 の「画像 + テキスト」になる）、それ以外・失敗時は `expo-sharing`。
 * `expo-sharing` も使えない環境では画像を諦めてテキストだけ共有する。
 */

import type { GameDetail } from '@coto2ba/contracts'
import { drawAsImage, ImageFormat } from '@shopify/react-native-skia'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { createElement } from 'react'
import { Platform, Share, type View } from 'react-native'
import { captureRef } from 'react-native-view-shot'
import { shareText } from '../game'
import {
  SHARE_DIALOG_TITLE,
  SHARE_DIRECTORY,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_MIME_TYPE,
  SHARE_PNG_QUALITY,
  SHARE_UTI,
} from './constants'
import { SkiaShareCard } from './SkiaShareCard'

/** どの手段で共有したか。UI の注意書きと不具合の切り分けに使う。 */
export type ShareMethod = 'view-shot' | 'skia' | 'text'

export type ShareOutcome = {
  method: ShareMethod
  /** 画像の file:// URI。テキストのみなら null。 */
  uri: string | null
}

/** ファイル名に使えない文字を落とす。 */
function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
}

/** 1. RN ビューをそのまま撮る。失敗したら null（**投げない**）。 */
async function captureWithViewShot(host: View | null): Promise<string | null> {
  if (host === null) return null
  try {
    const uri = await captureRef(host, { format: 'png', quality: 1, result: 'tmpfile' })
    return typeof uri === 'string' && uri.length > 0 ? uri : null
  } catch {
    return null
  }
}

/** 2. Skia でオフスクリーンに描いて PNG を書き出す。失敗したら null。 */
async function captureWithSkia(game: GameDetail): Promise<string | null> {
  try {
    const image = await drawAsImage(createElement(SkiaShareCard, { game }), {
      width: SHARE_IMAGE_WIDTH,
      height: SHARE_IMAGE_HEIGHT,
    })
    if (image === null) return null

    const base64 = image.encodeToBase64(ImageFormat.PNG, SHARE_PNG_QUALITY)
    image.dispose?.()

    // `new Directory(...)` はディレクトリを作らない。`create()` は既存だと投げる。
    const directory = new Directory(Paths.cache, SHARE_DIRECTORY)
    if (!directory.exists) directory.create({ intermediates: true })

    const file = new File(directory, `coto2ba-${safeName(game.id)}-${Date.now()}.png`)
    if (!file.exists) file.create()
    file.write(base64, { encoding: 'base64' })
    return file.uri
  } catch {
    return null
  }
}

/** 3. テキストだけ。ここまで来たら必ず成功させたい。 */
async function shareTextOnly(game: GameDetail): Promise<ShareOutcome> {
  await Share.share({ message: shareText(game) })
  return { method: 'text', uri: null }
}

/**
 * 画像を共有できる経路があるか。無ければ撮影自体を省いてテキストに落とす
 * （Skia の書き出しは重いので、渡す先が無いのに走らせない）。
 */
async function canShareImage(): Promise<boolean> {
  // iOS の RN `Share` は file:// の `url` を受け取れるので常に経路がある。
  if (Platform.OS === 'ios') return true
  try {
    return await Sharing.isAvailableAsync()
  } catch {
    return false
  }
}

/** シェアシートを開く。開けなければ false（次の手段へ）。 */
async function shareImage(uri: string, game: GameDetail): Promise<boolean> {
  // 1. iOS は画像とテキストを一緒に渡せる。
  if (Platform.OS === 'ios') {
    try {
      await Share.share({ message: shareText(game), url: uri })
      return true
    } catch {
      // 落ちても expo-sharing がまだ残っている。
    }
  }

  // 2. expo-sharing（画像のみ）。
  try {
    if (!(await Sharing.isAvailableAsync())) return false
    await Sharing.shareAsync(uri, {
      mimeType: SHARE_MIME_TYPE,
      UTI: SHARE_UTI,
      dialogTitle: SHARE_DIALOG_TITLE,
    })
    return true
  } catch {
    return false
  }
}

/**
 * 結果をシェアする。
 *
 * `host` は `ShareCardHost` の ref（画面外に置いた RN カード）。null でも動く
 * （その場合は Skia から始まる）。
 *
 * **失敗したときだけ投げる**（3 段すべて落ちたとき）。呼び出し側は
 * `toMessageJa(error)` を出せばよい。
 */
export async function shareGameResult(game: GameDetail, host: View | null): Promise<ShareOutcome> {
  if (await canShareImage()) {
    const viewShotUri = await captureWithViewShot(host)
    if (viewShotUri !== null && (await shareImage(viewShotUri, game))) {
      return { method: 'view-shot', uri: viewShotUri }
    }

    const skiaUri = await captureWithSkia(game)
    if (skiaUri !== null && (await shareImage(skiaUri, game))) {
      return { method: 'skia', uri: skiaUri }
    }
  }

  return await shareTextOnly(game)
}
