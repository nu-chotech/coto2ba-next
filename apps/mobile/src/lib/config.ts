/**
 * API のベース URL の解決。
 *
 * 1. `EXPO_PUBLIC_API_URL` があればそれ（明示指定が最優先）
 * 2. `app.json` の `extra.apiUrl`（= 本番 API。EAS Update でも Expo Go の dev でも同じ）
 * 3. contracts の `API_BASE_URL`
 *
 * **`__DEV__` でもローカル API に自動で向けない。**
 * `expo start` で QR を読んだだけのとき、手元で API サーバを立てていないと
 * 何も動かなくなるため。ローカル API を使いたいときは
 * `apps/mobile/.env` に `EXPO_PUBLIC_API_URL=http://<PCのLAN IP>:8787` を書く
 * （`localhost` は実機からは届かない）。
 */

import { API_BASE_URL } from '@coto2ba/contracts'
import Constants from 'expo-constants'
import { DEV_API_PORT, FALLBACK_API_URL } from './constants'

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** `192.168.1.23:8081` や `exp://192.168.1.23:8081` からホスト部だけ取り出す。 */
function hostOf(hostUri: string): string | null {
  const withoutScheme = hostUri.replace(/^[a-z+]+:\/\//i, '')
  const authority = withoutScheme.split('/')[0] ?? ''
  const host = authority.split(':')[0]
  return host && host.length > 0 ? host : null
}

function devHostUri(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null
  const fromConfig = config?.hostUri
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig
  const fromManifest = (Constants as { experienceUrl?: string }).experienceUrl
  return typeof fromManifest === 'string' && fromManifest.length > 0 ? fromManifest : null
}

let cached: string | null = null

export function resolveApiBaseUrl(): string {
  if (cached !== null) return cached

  const fromEnv = process.env.EXPO_PUBLIC_API_URL
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    cached = stripTrailingSlash(fromEnv.trim())
    return cached
  }

  const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    cached = stripTrailingSlash(fromExtra.trim())
    return cached
  }

  cached = stripTrailingSlash(API_BASE_URL)
  return cached
}

/** テスト・設定画面から手動で差し替える用。 */
export function overrideApiBaseUrl(url: string | null): void {
  cached = url === null ? null : stripTrailingSlash(url)
}

/** ベース URL + パスを結合する。パスは `/api/...` の形で渡す。 */
export function apiUrl(path: string): string {
  const base = resolveApiBaseUrl()
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}

/** API のオリジンが開発用（LAN / localhost）か。設定画面のデバッグ表示に使う。 */
export function isDevApiUrl(): boolean {
  return resolveApiBaseUrl().startsWith('http://')
}

/**
 * ローカル API を使いたいときの候補 URL（設定画面に出す用）。
 * Expo Go は実機なので Metro を動かしている PC の LAN IP を使う。
 */
export function suggestedLocalApiUrl(): string {
  const hostUri = devHostUri()
  const host = hostUri ? hostOf(hostUri) : null
  return host ? `http://${host}:${DEV_API_PORT}` : FALLBACK_API_URL
}
