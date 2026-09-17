/**
 * 図鑑の検索シート。
 *
 * **検索は副次的な操作**なので、常時出しておかず上のアイコンから開く
 * （上の一等地は「どの軌跡を見るか」に譲る）。作りは `WordSheet` に合わせてある。
 *
 * **意図的な例外：ライトモードでも暗いまま。** 図鑑は宇宙なので、端末がライトでも
 * ここは暗い。固定しているのは `app/(tabs)/space/_layout.tsx` の
 * `<ThemeProvider scheme={SPACE_SCHEME}>` だけなので、**ここは `useTheme()` を素直に読む**
 * （部品ごとにダーク固定のシムを読むと、シムと追従する部品が混ざって文字が消える）。
 */

import { useEffect, useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { GlassCard, ListRow } from '../../components'
import { borderWidth, radius, SPACE_TIER, spacing, typography, useTheme } from '../../theme'
import { SPACE_SEARCH_HEIGHT, SPACE_SEARCH_LIMIT, SPACE_SHEET_MAX_HEIGHT_RATIO } from './constants'
import { type SpaceScene, searchScene } from './scene'

export type SearchSheetProps = {
  visible: boolean
  scene: SpaceScene
  onClose: () => void
  /** 語を選んだとき。カメラがその語へ寄る。 */
  onPick: (word: string) => void
}

export function SearchSheet({ visible, scene, onClose, onPick }: SearchSheetProps) {
  const { palette, paletteForTier } = useTheme()
  const colors = paletteForTier(SPACE_TIER)
  const { height } = useWindowDimensions()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)

  // 開くたびに前回の入力を残さない（前の語が出たままだと何を探しているか分からない）。
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])

  const suggestions = searchScene(scene, query, SPACE_SEARCH_LIMIT)

  const pick = (word: string) => {
    inputRef.current?.blur()
    onPick(word)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: palette.scrim }]}
        onPress={onClose}
        accessibilityLabel="閉じる"
      />
      <View style={styles.dock} pointerEvents="box-none">
        <GlassCard
          variant="sheet"
          tint={colors.glassTint}
          cornerRadius={radius.xl}
          style={[styles.sheet, { maxHeight: height * SPACE_SHEET_MAX_HEIGHT_RATIO }]}
        >
          <TextInput
            ref={inputRef}
            autoFocus
            defaultValue=""
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const first = scene.indexByWord.has(query) ? query : suggestions[0]
              if (first !== undefined) pick(first)
            }}
            submitBehavior="blurAndSubmit"
            placeholder="語を探す"
            placeholderTextColor={colors.sub}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[
              typography.body,
              styles.input,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.sub },
            ]}
          />

          {suggestions.length === 0 ? (
            <Text style={[typography.caption, styles.empty, { color: colors.sub }]}>
              {query.length === 0
                ? '出会った語とゴースト点から探せます。'
                : 'この宇宙には見つかりませんでした。'}
            </Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {suggestions.map((word, index) => (
                <ListRow
                  key={word}
                  title={word}
                  onPress={() => pick(word)}
                  textColor={colors.text}
                  subColor={colors.sub}
                  divided={index > 0}
                />
              ))}
            </ScrollView>
          )}
        </GlassCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dock: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg },
  sheet: { gap: spacing.md },
  input: {
    height: SPACE_SEARCH_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
    paddingHorizontal: spacing.lg,
  },
  empty: { paddingVertical: spacing.sm },
})
