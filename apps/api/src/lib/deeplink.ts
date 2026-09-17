/**
 * QR / リンクに埋めるディープリンクの組み立て（SPEC §7.4、§9.5）。
 *
 * **https のランディングを符号化してはいけない。** iPhone のカメラで読むと Safari が
 * 開くだけでアプリに戻らない。Expo Go で直接開ける EAS Update のディープリンク
 * `exp://u.expo.dev/<projectId>?channel-name=…&runtime-version=…&<key>=<value>`
 * を返す（ランディングの「コトコトバを開く」と同じ形 + 追加のクエリ）。
 *
 * 既定値は contracts（`EXPO_PROJECT_ID` / `EXPO_UPDATE_CHANNEL` / `EXPO_RUNTIME_VERSION`）。
 * デプロイ側で `EXPO_PROJECT_ID` / `EXPO_CHANNEL` / `EXPO_RUNTIME_VERSION` を上書きできる。
 * どれかを**空に潰した**ときだけ、ランディングのクエリにフォールバックする。
 *
 * 引き継ぎ（`transfer`）も対戦ルームの参加（`room`）もこの形なので、
 * URL の組み立てはここ 1 か所だけにする。
 */
import {
  EXPO_PROJECT_ID,
  EXPO_RUNTIME_VERSION,
  EXPO_UPDATE_CHANNEL,
  EXPO_UPDATE_ORIGIN,
  LANDING_URL,
} from '@coto2ba/contracts'

/**
 * 環境変数の値。**未設定なら既定値、明示的に空にしたら空文字**を返す
 * （空 = その設定を無効化したい、という意思表示として扱う）。
 */
export function envOr(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined ? fallback : raw.trim()
}

/** 末尾のスラッシュを落としたランディングのオリジン。 */
export function landingOrigin(): string {
  const origin = envOr('LANDING_ORIGIN', LANDING_URL)
  return (origin.length === 0 ? LANDING_URL : origin).replace(/\/+$/, '')
}

/**
 * Expo Go のディープリンク。`params` はアプリ側が `Linking.useURL()` で拾うクエリ。
 * EAS の設定が潰されているときはランディングの `?<key>=<value>` に落ちる
 * （ランディングが受け取って `exp://` のボタンを出す）。
 */
export function expoDeepLink(params: Readonly<Record<string, string>>): string {
  const projectId = envOr('EXPO_PROJECT_ID', EXPO_PROJECT_ID)
  const channel = envOr('EXPO_CHANNEL', EXPO_UPDATE_CHANNEL)
  const runtimeVersion = envOr('EXPO_RUNTIME_VERSION', EXPO_RUNTIME_VERSION)
  if (projectId.length === 0 || channel.length === 0 || runtimeVersion.length === 0) {
    return `${landingOrigin()}/?${new URLSearchParams(params).toString()}`
  }
  const query = new URLSearchParams({
    'channel-name': channel,
    'runtime-version': runtimeVersion,
    ...params,
  })
  return `${EXPO_UPDATE_ORIGIN}/${projectId}?${query.toString()}`
}
