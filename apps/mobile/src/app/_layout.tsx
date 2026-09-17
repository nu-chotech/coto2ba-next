/**
 * ルートレイアウト。Provider を積むだけ。
 *
 * ここは Stack。タブ本体は `(tabs)/_layout.tsx`（`expo-router/unstable-native-tabs`）。
 * `/` は `index.tsx` がロビー（`/play`）へリダイレクトする。
 *
 * `KeyboardProvider`（react-native-keyboard-controller@1.21.9、SDK 57 の Expo Go に同梱）は
 * GestureHandlerRootView の内側・SafeAreaProvider の外側。入力欄は
 * `KeyboardAwareScrollView` / `KeyboardStickyView` を使うこと
 * （`KeyboardAvoidingView` とは戦わない。ARCHITECTURE §5）。
 *
 * `ThemeProvider` が端末のライト / ダークを購読する。**地とステータスバーを塗るのは
 * その内側**（`Themed`）でないとスキームの切り替えを受け取れない。
 *
 * Web だけ、hydrate のあとに木を 1 回作り直す（`useWebHydrationKey`）。理由は下記。
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TransferDeepLinkGate } from '../features/profile'
import { RoomDeepLinkGate } from '../features/rooms'
import { ensureSession } from '../lib/auth'
import { initFeedback } from '../lib/feedback'
import { queryClient } from '../lib/queryClient'
import { loadVocab } from '../lib/vocab'
import { ThemeProvider, useTheme } from '../theme'

/**
 * 起動時に走らせるもの。いずれも失敗しても投げない
 * （サーバー未起動・語彙未生成でもアプリは開く）。
 */
function useBootstrap(): void {
  useEffect(() => {
    void ensureSession()
    void loadVocab()
    void initFeedback()
  }, [])
}

/**
 * Web で hydrate のあとに木を 1 回だけ作り直すための key。ネイティブでは `undefined`。
 *
 * `expo export --platform web` は各画面を静的 HTML に焼いてから hydrate する。
 * 焼くのは Node なので `prefers-color-scheme` が無く、**必ずライトで焼かれる**。
 * hydrate では react-native-web が吐いたクラス名がサーバー側のまま残るので、
 * ダークの端末で開くと「地は明るいのに、あとから出たカードやロゴは暗い」という
 * **混ざった状態**になり、エラーカードとロゴが 1.1:1 で消えていた。
 *
 * そこで **hydrate 直後に 1 回だけ key を変えて作り直す**。
 * サーバー由来の DOM を捨ててクライアントのスキームで描き直すので混ざりが消える。
 *
 * 作り直しは **mount 直後の 1 回きり**で、スキームを key にはしない
 * （key にすると、遊んでいる最中に端末のテーマを変えたときに
 * ナビゲーションが初期化されてゲーム画面から飛ばされる）。
 *
 * **ネイティブは静的書き出しも hydrate も無いので、最初から `true`。**
 * key は常に `undefined` のままで、作り直しも余分な再描画も起きない。
 */
function useWebHydrationKey(): string | undefined {
  const isWeb = Platform.OS === 'web'
  const [hydrated, setHydrated] = useState(!isWeb)

  useEffect(() => {
    if (!isWeb) return
    setHydrated(true)
  }, [isWeb])

  return isWeb ? (hydrated ? 'client' : 'server') : undefined
}

export default function RootLayout() {
  useBootstrap()
  const hydrationKey = useWebHydrationKey()

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <Themed key={hydrationKey} />
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}

/** ThemeProvider の内側。ここでないとスキームの切り替えを受け取れない。 */
function Themed() {
  const { palette } = useTheme()

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <StatusBar style={palette.statusBar} />
      {/* 引き継ぎ QR（`exp://…?transfer=`）で開かれたときの受け取り。SPEC §7.4。
          どの画面に着地しても動くよう、Provider の内側にここだけ置く（描画しない）。 */}
      <TransferDeepLinkGate />
      {/* 対戦ルームの参加 QR（`exp://…?room=`）で開かれたときの受け取り。SPEC §9.5。
       **この 1 行を消すと QR 参加の導線だけが外れる**（機能を落とすときの境界）。 */}
      <RoomDeepLinkGate />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.base },
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
