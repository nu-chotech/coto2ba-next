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
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TransferDeepLinkGate } from '../features/profile'
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

export default function RootLayout() {
  useBootstrap()

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <Themed />
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
