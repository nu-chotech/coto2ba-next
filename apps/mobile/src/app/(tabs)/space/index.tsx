/**
 * 図鑑（SPEC §9）。
 *
 * 全画面の Skia Canvas に、出会った語（初遭遇の tier 色）・未取得のゴースト点・
 * 今日のゴール（金の輪）・クリア済みの経路を 2.5D で並べる。
 * パンで回し、ピンチで寄り、タップで語の詳細、上の検索欄で語まで飛ぶ。
 *
 * **サーバーが空でも落ちない。** `GET /api/collection` が失敗しても
 * ゴースト点だけの宇宙が出て、「まだ語に出会っていません」と案内する。
 */

import { SPACE_GHOST_COUNT } from '@coto2ba/contracts'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GlassCard, toMessageJa } from '../../../components'
import {
  buildSpaceScene,
  collectionSummary,
  type GoalMarker,
  hasRealGhosts,
  SPACE_SEARCH_HEIGHT,
  SPACE_SEARCH_LIMIT,
  SpaceCanvas,
  SpaceLabels,
  searchScene,
  useCollectionQuery,
  useSpaceCamera,
  useWordDetailQuery,
  WordSheet,
} from '../../../features/collection'
import { useDailyQuery } from '../../../features/game'
import { feedback } from '../../../lib/feedback'
import {
  borderWidth,
  layout,
  palette,
  paletteForTier,
  radius,
  spacing,
  typography,
} from '../../../theme'

/** 図鑑は宇宙。tier は固定。 */
const SPACE_TIER = 'cosmos'
const colors = paletteForTier(SPACE_TIER)

export default function SpaceScreen() {
  const insets = useSafeAreaInsets()

  const collection = useCollectionQuery()
  const daily = useDailyQuery()
  // 今日のゴールの座標はコレクションに無いことがあるので、語の詳細から取る。
  const goalWord = daily.data?.goal ?? null
  const goalDetail = useWordDetailQuery(goalWord)

  const goalMarker = useMemo<GoalMarker | null>(() => {
    if (goalWord === null) return null
    const pos3 = goalDetail.data?.pos3 ?? null
    return pos3 === null ? null : { word: goalWord, pos3 }
  }, [goalWord, goalDetail.data])

  const scene = useMemo(
    () => buildSpaceScene(collection.data, goalMarker),
    [collection.data, goalMarker],
  )
  /** 点の数が変わったら Canvas ごと作り直す（共有値の長さを合わせるため）。 */
  const sceneKey = `${collection.dataUpdatedAt}:${goalMarker?.word ?? ''}`

  const { camera, gesture, reset, focusOn } = useSpaceCamera()

  const [size, setSize] = useState({ width: 0, height: 0 })
  const onResize = useCallback((width: number, height: number) => {
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    )
  }, [])

  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [sheetIndex, setSheetIndex] = useState(-1)
  const [query, setQuery] = useState('')
  const searchRef = useRef<TextInput | null>(null)

  const focusIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= scene.count) return
      setSelectedIndex(index)
      focusOn([
        scene.xyz[index * 3] as number,
        scene.xyz[index * 3 + 1] as number,
        scene.xyz[index * 3 + 2] as number,
      ])
    },
    [scene, focusOn],
  )

  const onHit = useCallback((index: number) => {
    setSelectedIndex(index)
    setSheetIndex(index)
    if (index >= 0) feedback('hint_open')
  }, [])

  const onPickWord = useCallback(
    (word: string) => {
      const index = scene.indexByWord.get(word)
      if (index === undefined) return
      setSheetIndex(-1)
      focusIndex(index)
    },
    [scene, focusIndex],
  )

  const suggestions = useMemo(() => searchScene(scene, query, SPACE_SEARCH_LIMIT), [scene, query])

  const onSubmitSearch = useCallback(() => {
    const first = suggestions[0]
    const exact = scene.indexByWord.has(query) ? query : first
    if (exact === undefined) return
    const index = scene.indexByWord.get(exact)
    if (index === undefined) return
    focusIndex(index)
    searchRef.current?.blur()
  }, [suggestions, scene, query, focusIndex])

  const sheetNode = sheetIndex >= 0 ? (scene.nodes[sheetIndex] ?? null) : null
  const summary = collectionSummary(collection.data)

  return (
    <View style={styles.root}>
      <SpaceCanvas
        key={sceneKey}
        scene={scene}
        camera={camera}
        gesture={gesture}
        onHit={onHit}
        selectedIndex={selectedIndex}
        onResize={onResize}
      />
      <SpaceLabels
        scene={scene}
        camera={camera}
        width={size.width}
        height={size.height}
        color={colors.text}
      />

      {/* ── 上：検索 ── */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <TextInput
          ref={searchRef}
          defaultValue=""
          onChangeText={setQuery}
          onSubmitEditing={onSubmitSearch}
          submitBehavior="blurAndSubmit"
          placeholder="語を探す"
          placeholderTextColor={colors.sub}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[
            typography.body,
            styles.search,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.sub },
          ]}
        />
        {suggestions.length > 0 ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {suggestions.map((word) => (
              <Pressable
                key={word}
                onPress={() => {
                  const index = scene.indexByWord.get(word)
                  if (index !== undefined) focusIndex(index)
                  searchRef.current?.blur()
                }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: colors.sub,
                    backgroundColor: pressed ? palette.pressed : colors.surface,
                  },
                ]}
              >
                <Text style={[typography.label, { color: colors.text }]}>{word}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/* ── 下：状態と操作 ── */}
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}
        pointerEvents="box-none"
      >
        {scene.ownedCount === 0 ? (
          <GlassCard tint={colors.glassTint} style={styles.notice}>
            <Text style={[typography.subtitle, { color: colors.text }]}>
              まだ語に出会っていません
            </Text>
            <Text style={[typography.caption, { color: colors.sub }]}>
              {collection.isError
                ? toMessageJa(collection.error)
                : 'プレイして語に出会うと、この宇宙に色のついた星が増えます。'}
            </Text>
            <Text style={[typography.label, { color: colors.sub }]}>
              いま見えているのは
              {hasRealGhosts()
                ? `まだ出会っていない ${SPACE_GHOST_COUNT.toLocaleString('ja-JP')} 語`
                : '仮の星'}
              です
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.statusRow} pointerEvents="box-none">
            <Text style={[typography.label, styles.status, { color: colors.sub }]}>
              {summary ?? ''}
            </Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSelectedIndex(-1)
            reset()
          }}
          style={({ pressed }) => [
            styles.resetButton,
            {
              borderColor: colors.sub,
              backgroundColor: pressed ? palette.pressed : colors.surface,
            },
          ]}
        >
          <Text style={[typography.label, { color: colors.text }]}>視点をもどす</Text>
        </Pressable>
      </View>

      <WordSheet node={sheetNode} onClose={() => setSheetIndex(-1)} onPickWord={onPickWord} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.tiers.cosmos.bg },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.sm,
  },
  search: {
    height: SPACE_SEARCH_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
    paddingHorizontal: spacing.lg,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  notice: { gap: spacing.xs },
  statusRow: { alignItems: 'center' },
  status: { textAlign: 'center' },
  resetButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: borderWidth.hairline,
  },
})
