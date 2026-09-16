/**
 * ルートレイアウト。Provider を積むだけ。
 *
 * タブ（(tabs)/play, space, ranking, settings）は次の担当者が作る。ここは Stack のまま。
 *
 * `KeyboardProvider`（react-native-keyboard-controller@1.21.9、SDK 57 の Expo Go に同梱）は
 * GestureHandlerRootView の内側・SafeAreaProvider の外側。入力欄は `KeyboardStickyView` を
 * 使うこと（`KeyboardAvoidingView` とは戦わない。ARCHITECTURE §5）。
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ensureSession } from '../lib/auth'
import { initFeedback } from '../lib/feedback'
import { queryClient } from '../lib/queryClient'
import { loadVocab } from '../lib/vocab'
import { palette } from '../theme'

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
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: palette.base },
              }}
            />
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.base },
})
