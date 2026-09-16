# React Native / Expo Go (SDK 57, iOS-first) implementation techniques for a polished Japanese word-puzzle UI: Skia, Reanimated 4, Gesture Handler, detented slider, Japanese IME, share-image capture, data layer, keyboard

## 要約

**Baseline (verified against `apps/mobile/package.json`, which is already scaffolded correctly).** Latest Expo is **SDK 57** (released 2026-06-30): React Native 0.86, React 19.2, New Architecture only (Legacy dropped in SDK 55). Expo Go SDK 57 pins these exact native versions — you must match them or Expo Go breaks: `@shopify/react-native-skia@2.6.2`, `react-native-reanimated@4.5.1`, `react-native-worklets@0.10.1`, `react-native-gesture-handler@~2.32.0`, `react-native-view-shot@5.1.0`, `react-native-keyboard-controller@1.21.9`, `@react-native-community/slider@5.2.0`, `react-native-svg@15.15.4`, `@shopify/flash-list@2.0.2`.

**Two premises in the brief are wrong.** (a) `@react-native-community/slider` **is** in Expo Go (5.2.0) — it's still the wrong tool here, but because it has no detents/haptics, not because of Expo Go. (b) `react-native-view-shot` **is** in Expo Go (5.1.0). The real problem is different and worse: `captureRef` renders through the view's `draw()` path, and Skia renders into its own texture/surface, so **Skia canvases come out blank/missing**. So the Skia snapshot route is mandatory anyway — but for offscreen composition, not because view-shot is absent.

**Skia.** 2.6.2 is Expo-Go-compatible; npm latest is 2.11.2 — do not install it. For 2000+ points with per-point color and size, **`Atlas` is the right primitive**: one draw call, one `RSXform` per instance (position + rotation + *uniform* scale) and one `SkColor` per instance via `colors` + `colorBlendMode`. `Points` takes a single paint (one color, one width for all). `Vertices` gives per-vertex colors but you hand-build triangles and lose round dots. Drive the buffer with `useRSXformBuffer(n, worklet)` — it mutates a preallocated native buffer on the UI thread at near-zero cost. Build the one-dot texture with `useTexture(<element/>, size)`.

**Reanimated 4.5 breaking changes that matter.** Worklets moved to `react-native-worklets`; **`babel-preset-expo` wires `react-native-worklets/plugin` automatically — do NOT create a `babel.config.js` with `react-native-reanimated/plugin`, it now errors.** `runOnJS`→`scheduleOnRN` (args passed directly, not curried), `runOnUI`→`scheduleOnUI`, `useScrollViewOffset`→`useScrollOffset`, `useAnimatedGestureHandler` and `useWorkletCallback` removed, `withSpring` now uses `energyThreshold` and reinterprets `duration` (divide old values by 1.5).

**Japanese IME is the biggest real risk.** CJK IME on iOS Fabric has been broken since RN 0.76 (issue #56463; fix PR #56082 still unmerged): composition underline missing, a controlled `value` prop destroys composition state, and `maxLength` truncates mid-変換. Since SDK 55 dropped Legacy Arch there is no escape hatch — you must use an **uncontrolled** `TextInput` (`defaultValue` + ref), never `maxLength`, and commit on `onSubmitEditing`/`onEndEditing`. `blurOnSubmit` is deprecated in 0.86 in favour of `submitBehavior`.

**Keyboard.** `react-native-keyboard-controller@1.21.9` **is** in Expo Go for SDK 57 (the library's own docs still claim otherwise — they're stale). Use `KeyboardProvider` + `KeyboardStickyView` for a word-entry bar; it beats `KeyboardAvoidingView`, which needs per-platform `behavior` and jitters on iOS.

**Data layer.** `@tanstack/react-query@5.103.1` (already pinned), `zustand@5.0.15`. You have `@better-auth/expo` — native has no cookie jar, so attach `Cookie: await authClient.getCookie()` manually with `credentials: 'omit'`.


## 事実

- **[high]** Latest Expo SDK is 57 (expo@57.0.23 in this repo), released 2026-06-30, shipping React Native 0.86 and React 19.2. New Architecture is the only architecture (Legacy dropped in SDK 55).
  - source: `https://expo.dev/changelog/sdk-57`
- **[high]** Expo Go SDK 57 pins @shopify/react-native-skia to exactly 2.6.2. npm latest is 2.11.2 — installing it will break Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json`
- **[high]** @shopify/react-native-skia IS included in Expo Go (Android, iOS, tvOS, Web). Install with `npx expo install @shopify/react-native-skia`.
  - source: `https://docs.expo.dev/versions/latest/sdk/skia/`
- **[high]** Expo Go SDK 57 bundled versions: react-native-reanimated 4.5.1, react-native-worklets 0.10.1, react-native-gesture-handler ~2.32.0, react-native-view-shot 5.1.0, react-native-keyboard-controller 1.21.9, @react-native-community/slider 5.2.0, react-native-svg 15.15.4, react-native-safe-area-context ~5.7.0, @shopify/flash-list 2.0.2.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json`
- **[high]** CORRECTION to the brief: @react-native-community/slider IS included in Expo Go (5.2.0). It is still the wrong choice for a detented slider — it has no detent haptics and no UI-thread gesture control — but not for Expo Go reasons.
  - source: `https://docs.expo.dev/versions/latest/sdk/third-party-overview/`
- **[high]** CORRECTION to the brief: react-native-view-shot IS included in Expo Go (5.1.0), with captureRef documented by Expo.
  - source: `https://docs.expo.dev/versions/latest/sdk/captureRef/`
- **[high]** react-native-view-shot cannot capture React Native Skia canvas content: screenshot methods use the view's internal draw() function, and Skia draws into a TextureView/native surface that does not draw itself into that canvas. Result is a blank or missing region.
  - source: `https://github.com/Shopify/react-native-skia/issues/1052`
- **[high]** react-native-keyboard-controller IS included in Expo Go for SDK 57 (Expo docs badge: 'Android, iOS, Included in Expo Go'). The library's own docs still say it requires a development build — that is outdated.
  - source: `https://docs.expo.dev/versions/latest/sdk/keyboard-controller/`
- **[high]** Atlas props: image (SkImage), sprites (SkRect[]), transforms (RSXform[]), colors (SkColor[], optional), colorBlendMode (default dstOver), blendMode, sampling. It is the primitive for drawing a very large number of similar objects in one draw call.
  - source: `https://shopify.github.io/react-native-skia/docs/shapes/atlas`
- **[high]** useRSXformBuffer(count, worklet) preallocates a native RSXform buffer and mutates it on the UI thread via val.set(scos, ssin, tx, ty) — 'Atlas transforms can be animated with near-zero cost using worklets'. useRectBuffer does the same for SkRect[]. The 'worklet' directive is mandatory in the callback.
  - source: `https://shopify.github.io/react-native-skia/docs/animations/hooks`
- **[high]** RSXform encodes uniform scale + rotation + translation only. There is no per-sprite non-uniform scale or skew; per-point 'size' must be a uniform scale factor.
  - source: `https://shopify.github.io/react-native-skia/docs/shapes/atlas`
- **[high]** Skia Points component takes a single paint (one color, one strokeWidth) for the whole point set — it cannot do per-point color or per-point size.
  - source: `https://shopify.github.io/react-native-skia/docs/shapes/polygons`
- **[high]** Skia fonts: useFont(require('./x.ttf'), size) returns an SkFont for <Text>; useFonts({Family:[require(...)]}) returns an SkFontMgr for matchFont(style, fontMgr) and Skia.ParagraphBuilder.Make(paragraphStyle, fontMgr). Both return null until loaded.
  - source: `https://shopify.github.io/react-native-skia/docs/text/fonts`
- **[high]** Skia's font manager is entirely separate from expo-font. Fonts loaded with expo-font's useFonts are NOT visible to Skia's matchFont/Paragraph — you must register them a second time through Skia's own useFonts.
  - source: `https://shopify.github.io/react-native-skia/docs/text/paragraph`
- **[medium]** @expo-google-fonts/noto-sans-jp exposes each weight as a subpath module whose export is the Metro asset id: `import { NotoSansJP_400Regular } from '@expo-google-fonts/noto-sans-jp/400Regular'`. That binding is what require() of the .ttf returns, so it can be passed straight to Skia's useFont/useFonts.
  - source: `https://github.com/expo/google-fonts/tree/main/font-packages/noto-sans-jp`
- **[high]** Reanimated 4 moved worklets to react-native-worklets and requires the babel plugin to change from 'react-native-reanimated/plugin' to 'react-native-worklets/plugin'.
  - source: `https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/`
- **[high]** With babel-preset-expo you should NOT write a babel.config.js for this: the preset automatically adds react-native-worklets/plugin when react-native-worklets is installed. Manually adding react-native-reanimated/plugin now throws an error.
  - source: `https://github.com/expo/fyi/blob/main/expo-54-reanimated.md`
- **[high]** Reanimated 4 renames: runOnJS→scheduleOnRN, runOnUI→scheduleOnUI, runOnRuntime→scheduleOnRuntime, executeOnUIRuntimeSync→runOnUISync. Args are passed directly, not via a second call. runOnJS is deprecated and removed in the next major.
  - source: `https://docs.swmansion.com/react-native-worklets/docs/threading/runOnJS/`
- **[high]** Reanimated 4 removed: useWorkletCallback, useAnimatedGestureHandler, combineTransition, addWhitelistedNativeProps/UIProps. useScrollViewOffset renamed to useScrollOffset. withSpring replaces restDisplacementThreshold/restSpeedThreshold with energyThreshold and reinterprets duration (divide old values by 1.5).
  - source: `https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/`
- **[high]** withDecay config: velocity, deceleration (default 0.998), clamp ([min,max]), velocityFactor (default 1), rubberBandEffect (default false), rubberBandFactor (default 0.6), reduceMotion.
  - source: `https://docs.swmansion.com/react-native-reanimated/docs/animations/withDecay/`
- **[high]** Gesture Handler current API: Gesture.Pan()/Gesture.Pinch() with .onBegin/.onUpdate/.onChange/.onEnd/.onFinalize, composed via Gesture.Simultaneous/Exclusive/Race, mounted with <GestureDetector>. A <GestureHandlerRootView> must wrap the app root.
  - source: `https://docs.swmansion.com/react-native-gesture-handler/docs/2.x/gestures/pan-gesture/`
- **[high]** CJK (Japanese) IME input is broken on iOS Fabric for all New Architecture users since RN 0.76: composition underline vanishes, Fabric's synchronous updateState:/defaultTextAttributes reapplication destroys composition state, maxLength truncates mid-composition, and a controlled `value` prop breaks CJK input entirely. Fix PR #56082 was still unmerged as of the issue's last update.
  - source: `https://github.com/react/react-native/issues/56463`
- **[medium]** React Native has no onCompositionStart/onCompositionEnd equivalent — the IME marked-text range is not exposed to JS. onChangeText fires for every composition update including unconverted かな, so '変換中' cannot be detected reliably; commit on onSubmitEditing/onEndEditing instead.
  - source: `https://github.com/react/react-native/issues/56463`
- **[high]** blurOnSubmit is deprecated in RN 0.86; submitBehavior replaces it and overrides any behavior blurOnSubmit defines. Values: 'submit' (fire onSubmitEditing, keep focus), 'blurAndSubmit', 'newline' (multiline).
  - source: `https://reactnative.dev/docs/0.86/textinput`
- **[high]** Skia snapshot APIs: useCanvasRef().current.makeImageSnapshot(rect?) (sync) and makeImageSnapshotAsync() (UI thread, required when the canvas contains textures). SkImage has encodeToBytes() → Uint8Array and encodeToBase64() → string.
  - source: `https://shopify.github.io/react-native-skia/docs/canvas/overview/`
- **[high]** makeImageFromView(ref) captures a React Native View as an SkImage; the target View must have collapsable={false} or it errors.
  - source: `https://shopify.github.io/react-native-skia/docs/snapshotviews/`
- **[high]** expo-file-system SDK 54+ uses a class API: new File(Paths.cache, 'x.png'); file.create(); file.write(base64, { encoding: 'base64' }); file.uri. write() signature is write(content: string | Uint8Array, options?: { append?: boolean; encoding?: 'utf8' | 'base64' }): void. The old functional API is available at expo-file-system/legacy.
  - source: `https://docs.expo.dev/versions/latest/sdk/filesystem/`
- **[high]** @tanstack/react-query latest v5 is 5.102.x–5.103.x (this repo pins 5.103.1); zustand latest is 5.0.15 (already pinned).
  - source: `https://www.npmjs.com/package/@tanstack/react-query`
- **[high]** TanStack Query RN setup: wire onlineManager.setEventListener with expo-network's addNetworkStateListener, and focusManager.setFocused from AppState 'change' events (guarded by Platform.OS !== 'web').
  - source: `https://tanstack.com/query/v5/docs/framework/react/react-native`
- **[high]** better-auth on native has no cookie jar: retrieve the session cookie with authClient.getCookie() and set it as a `Cookie` header manually, with credentials: 'omit' (credentials: 'include' interferes with the manually-set header).
  - source: `https://better-auth.com/docs/integrations/expo`
- **[high]** expo-haptics API: Haptics.selectionAsync() for selection/detent ticks, Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light|Medium|Heavy|Rigid|Soft), Haptics.notificationAsync(NotificationFeedbackType.Success|Warning|Error).
  - source: `https://docs.expo.dev/versions/latest/sdk/haptics/`
- **[high]** experiments.reactCompiler is currently true in this repo's app.json. React Compiler is incompatible with NativeWind's className transform — if NativeWind is ever added, that flag must be turned off.
  - source: `https://docs.expo.dev/versions/latest/sdk/reanimated/`

## コード片

### 1a. Install — Expo-Go-safe versions only (never `npm install`, always `expo install`)

```bash
# apps/mobile
# Expo Go pins native versions; `expo install` picks the compatible one.
npx expo install \
  @shopify/react-native-skia \
  react-native-reanimated react-native-worklets \
  react-native-gesture-handler \
  react-native-keyboard-controller \
  react-native-view-shot \
  expo-haptics expo-file-system expo-sharing expo-network

# Fonts (pick ONE of the two, see snippet 2c)
npx expo install @expo-google-fonts/noto-sans-jp expo-font

# Already correct in apps/mobile/package.json — do NOT bump these by hand:
#   @shopify/react-native-skia  2.6.2     (npm latest is 2.11.2 -> BREAKS Expo Go)
#   react-native-reanimated     4.5.1
#   react-native-worklets       0.10.1
#   react-native-gesture-handler ~2.32.0
#   react-native-view-shot      5.1.0

# There is intentionally NO babel.config.js in apps/mobile.
# babel-preset-expo injects react-native-worklets/plugin automatically.
# Adding `react-native-reanimated/plugin` yourself now throws at build time.

# After any native-version change:
npx expo start --clear
```

### 1b. Full-screen animated Skia Canvas driven by Reanimated shared values

```tsx
// apps/mobile/src/components/skia/breathing-field.tsx
import {
  Canvas,
  Circle,
  Fill,
  Group,
  LinearGradient,
  vec,
} from '@shopify/react-native-skia'
import { useEffect } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

// Skia props accept SharedValue<T> and DerivedValue<T> directly — no
// useAnimatedStyle, no re-render, everything stays on the UI thread.
export function BreathingField() {
  const { width, height } = useWindowDimensions()
  const t = useSharedValue(0)

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    )
  }, [t])

  // useDerivedValue is how you compute Skia props from shared values.
  const r = useDerivedValue(() => 80 + t.value * 60)
  const cx = useDerivedValue(() => width / 2)
  const cy = useDerivedValue(() => height / 2 + t.value * 24)
  const opacity = useDerivedValue(() => 0.35 + t.value * 0.4)

  // A whole element tree can be driven by one derived transform.
  const transform = useDerivedValue(() => [{ rotate: t.value * Math.PI * 2 }])

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Fill>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(width, height)}
          colors={['#0B0B10', '#141425']}
        />
      </Fill>

      <Group origin={vec(width / 2, height / 2)} transform={transform}>
        <Circle cx={cx} cy={cy} r={r} color="#61DAFB" opacity={opacity} />
      </Group>
    </Canvas>
  )
}

// NOTE: use Skia's interpolateColors(), not Reanimated's interpolateColor() —
// Skia stores colors as Float32Array and the two are not interchangeable.
```

### 1c. 2400 points, per-point colour + size, one draw call — Atlas + useRSXformBuffer (THE answer to "is Atlas right?": yes)

```tsx
// apps/mobile/src/components/skia/point-cloud.tsx
//
// WHY Atlas and not Points/Vertices:
//   Points   -> one SkPaint for the whole set: ONE colour, ONE strokeWidth. Out.
//   Vertices -> per-vertex colours, but you hand-build triangles; 2400 round
//               dots = 9600 verts of quads and you lose the circular shape
//               unless you also ship a shader. Out.
//   Atlas    -> ONE draw call, ONE RSXform per instance (pos + rot + uniform
//               scale) and ONE SkColor per instance. This is the primitive.
//
// LIMIT: RSXform is uniform-scale only. Per-point "size" must be a scalar.

import {
  Atlas,
  BlendMode,
  Canvas,
  Circle,
  Group,
  RadialGradient,
  Skia,
  rect,
  useRSXformBuffer,
  useTexture,
  vec,
} from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { GestureDetector } from 'react-native-gesture-handler'
import { useOrbitCamera } from '../orbit-camera'

const DOT = 32 // sprite texture edge, px
const R = DOT / 2
const FOCAL = 900
const CAM_DIST = 3.2

export type CloudPoint = { x: number; y: number; z: number; size: number; color: string }

export function PointCloud({ points }: { points: CloudPoint[] }) {
  const { width, height } = useWindowDimensions()
  const { camera, gesture } = useOrbitCamera()
  const n = points.length

  // 1) ONE soft white dot, rendered once into a GPU texture on the UI thread.
  //    White + alpha so `colors` can tint it with SrcIn.
  const texture = useTexture(
    <Group>
      <Circle cx={R} cy={R} r={R}>
        <RadialGradient
          c={vec(R, R)}
          r={R}
          colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
          positions={[0, 0.55, 1]}
        />
      </Circle>
    </Group>,
    { width: DOT, height: DOT },
  )

  // 2) CRITICAL: pack point data into typed arrays held in shared values.
  //    Do NOT close over `points` (a 2400-element array of objects) inside the
  //    worklet — Reanimated deep-copies captured JS values into the UI runtime
  //    every time the worklet is rebuilt. Float32Array is cheap.
  const xyz = useSharedValue(new Float32Array(0))
  const sizes = useSharedValue(new Float32Array(0))
  useMemo(() => {
    const p = new Float32Array(n * 3)
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      p[i * 3] = points[i].x
      p[i * 3 + 1] = points[i].y
      p[i * 3 + 2] = points[i].z
      s[i] = points[i].size
    }
    xyz.value = p
    sizes.value = s
  }, [points, n, xyz, sizes])

  // 3) Every instance samples the SAME sub-rect of the atlas texture.
  const sprites = useMemo(
    () => new Array(n).fill(0).map(() => rect(0, 0, DOT, DOT)),
    [n],
  )

  // 4) Per-point colour. SkColor is a Float32Array; a plain array of them is
  //    fine when colours are static. Wrap in useDerivedValue to animate them.
  const colors = useMemo(
    () => points.map((p) => Skia.Color(p.color)),
    [points],
  )

  // 5) THE HOT PATH. Mutates a preallocated native buffer on the UI thread.
  //    Zero allocation, zero bridge traffic, runs every frame of the orbit.
  const transforms = useRSXformBuffer(n, (val, i) => {
    'worklet'
    const p = xyz.value
    const x = p[i * 3]
    const y = p[i * 3 + 1]
    const z = p[i * 3 + 2]

    const cy = Math.cos(camera.yaw.value)
    const sy = Math.sin(camera.yaw.value)
    const cp = Math.cos(camera.pitch.value)
    const sp = Math.sin(camera.pitch.value)

    // yaw about Y, then pitch about X
    const x1 = x * cy + z * sy
    const z1 = -x * sy + z * cy
    const y1 = y * cp - z1 * sp
    const z2 = y * sp + z1 * cp

    // perspective divide
    const d = FOCAL / (FOCAL + (z2 + CAM_DIST) * 240)
    const scale = (sizes.value[i] / DOT) * camera.zoom.value * d

    // RSXform anchors at the sprite's TOP-LEFT, so shift back by half an edge
    const tx = width / 2 + x1 * d * 240 * camera.zoom.value - R * scale
    const ty = height / 2 + y1 * d * 240 * camera.zoom.value - R * scale

    // val.set(scos, ssin, tx, ty) — scos/ssin = scale*cos(theta), scale*sin(theta)
    val.set(scale, 0, tx, ty)
  })

  return (
    <GestureDetector gesture={gesture}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Atlas
          image={texture}
          sprites={sprites}
          transforms={transforms}
          colors={colors}
          // SrcIn = colour * spriteAlpha -> clean tint of a white/alpha dot.
          // (Default is dstOver, which shows the texture OVER the colour.)
          colorBlendMode={BlendMode.SrcIn}
        />
      </Canvas>
    </GestureDetector>
  )
}
```

### 2a. Skia + Noto Sans JP: simple SkFont path (useFont) — fastest, for single words

```tsx
// apps/mobile/src/components/skia/word-label.tsx
import { Canvas, Text, useFont } from '@shopify/react-native-skia'
// The @expo-google-fonts subpath export IS the Metro asset id that require()
// of the .ttf returns, so it drops straight into Skia's useFont.
import { NotoSansJP_700Bold } from '@expo-google-fonts/noto-sans-jp/700Bold'

// Equivalent if you vendor the file yourself (Metro's default assetExts
// already includes 'ttf' in expo/metro-config — no config change needed):
// const NotoSansJP_700Bold = require('../../../assets/fonts/NotoSansJP-Bold.ttf')

const FONT_SIZE = 44

export function WordLabel({ text }: { text: string }) {
  const font = useFont(NotoSansJP_700Bold, FONT_SIZE)
  if (!font) return null // null until the .ttf is parsed

  // Measure so you can centre it — y is the BASELINE, not the top.
  const m = font.measureText(text)

  return (
    <Canvas style={{ width: 320, height: 96 }}>
      <Text
        x={(320 - m.width) / 2}
        y={96 / 2 + FONT_SIZE * 0.35}
        text={text}
        font={font}
        color="#E9E9F2"
      />
    </Canvas>
  )
}

// CAVEAT: <Text> does no line breaking and no font fallback. A codepoint
// missing from the .ttf renders as .notdef (tofu). For 日本語 that wraps,
// mixes weights, or may contain emoji, use the Paragraph API (2b).
```

### 2b. Skia Paragraph API for real Japanese layout (wrapping, mixed styles, fallback)

```tsx
// apps/mobile/src/components/skia/jp-paragraph.tsx
import {
  Canvas,
  Paragraph,
  Skia,
  TextAlign,
  useFonts,
} from '@shopify/react-native-skia'
import { NotoSansJP_400Regular } from '@expo-google-fonts/noto-sans-jp/400Regular'
import { NotoSansJP_700Bold } from '@expo-google-fonts/noto-sans-jp/700Bold'
import { useMemo } from 'react'

const WIDTH = 320

export function JpParagraph({ head, body }: { head: string; body: string }) {
  // Skia keeps its OWN font manager. Fonts registered via expo-font's useFonts
  // are invisible here — you must register them a second time, like this.
  const fontMgr = useFonts({
    'Noto Sans JP': [NotoSansJP_400Regular, NotoSansJP_700Bold],
  })

  const paragraph = useMemo(() => {
    if (!fontMgr) return null

    const base = {
      // Order matters: first family that has the glyph wins. Listing the iOS
      // system JP face second gives you free fallback for rare kanji/emoji.
      fontFamilies: ['Noto Sans JP', 'Hiragino Sans'],
      fontSize: 18,
      heightMultiplier: 1.7, // Japanese needs more leading than Latin
      color: Skia.Color('#E9E9F2'),
    }

    return Skia.ParagraphBuilder.Make(
      { textAlign: TextAlign.Left, maxLines: 6, ellipsis: '…' },
      fontMgr,
    )
      .pushStyle({ ...base, fontSize: 24, fontStyle: { weight: 700 } })
      .addText(`${head}\n`)
      .pop()
      .pushStyle(base)
      .addText(body)
      .pop()
      .build()
  }, [fontMgr, head, body])

  if (!paragraph) return null
  paragraph.layout(WIDTH) // call before reading getHeight()

  return (
    <Canvas style={{ width: WIDTH, height: paragraph.getHeight() }}>
      <Paragraph paragraph={paragraph} x={0} y={0} width={WIDTH} />
    </Canvas>
  )
}
```

### 2c. Zero-asset iOS alternative + font-size warning

```tsx
// Noto Sans JP static TTF is ~4–6 MB PER WEIGHT. Two weights ~= 10 MB added to
// every Expo Go / OTA download, plus a few hundred ms of parse on first use.
// Three ways out, in order of preference for an iOS-first Expo Go build:

// (A) Use the iOS system Japanese face. Zero bytes, zero load time.
import { matchFont, Skia } from '@shopify/react-native-skia'

const jpFont = matchFont({
  fontFamily: 'Hiragino Sans', // iOS. Android would need 'Noto Sans JP'.
  fontSize: 28,
  fontWeight: '600',
})
// matchFont() with no 2nd arg uses Skia.FontMgr.System(). Note this sees ONLY
// real system fonts — it does NOT see fonts you loaded with expo-font.

// (B) Subset the TTF down to your actual vocabulary. Usually 6 MB -> ~300 KB.
//   uv run pyftsubset NotoSansJP-Bold.ttf \
//     --text-file=vocab.txt \
//     --unicodes=U+3000-303F,U+3040-309F,U+30A0-30FF,U+FF00-FFEF,U+0020-007E \
//     --layout-features='' --flavor=woff2 --output-file=NotoSansJP-Bold.subset.ttf
//   (Skia reads .ttf/.otf; drop --flavor for a plain .ttf.)
//   This fits the pipeline you already have in tools/pipeline.

// (C) Ship the font, but load it behind the splash screen so the parse cost is
//     invisible:
//   import * as SplashScreen from 'expo-splash-screen'
//   SplashScreen.preventAutoHideAsync()
//   ... hide only once Skia's useFonts() has returned non-null.
```

### 3. Reanimated 4.5 — current API and every breaking change that bites

```tsx
// ---- The five things that will actually break you ----
//
// 1. NO babel.config.js. babel-preset-expo injects react-native-worklets/plugin
//    when react-native-worklets is installed. Writing your own config with
//    'react-native-reanimated/plugin' now THROWS. (Repo is already correct.)
// 2. runOnJS -> scheduleOnRN, imported from 'react-native-worklets'.
//    Args are passed DIRECTLY, not via a curried second call.
// 3. useAnimatedGestureHandler and useWorkletCallback are GONE.
// 4. useScrollViewOffset -> useScrollOffset.
// 5. withSpring: restDisplacementThreshold/restSpeedThreshold -> energyThreshold;
//    `duration` semantics changed — divide any Reanimated-3 value by 1.5.

import Animated, {
  clamp,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

export function Api45Reference({ onSettled }: { onSettled: (x: number) => void }) {
  const x = useSharedValue(0)
  const open = useSharedValue(0)

  // useDerivedValue: computed shared value, UI thread, no re-render.
  const shadow = useDerivedValue(() => clamp(Math.abs(x.value) / 100, 0, 1))

  // useAnimatedStyle: for RN views. (Skia takes shared values directly instead.)
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: 1 + open.value * 0.1 }],
    shadowOpacity: shadow.value,
  }))

  const g = Gesture.Pan()
    .onChange((e) => {
      x.value += e.changeX
    })
    .onEnd(() => {
      x.value = withSpring(0, {
        damping: 18,
        stiffness: 240,
        mass: 0.6,
        energyThreshold: 6e-9, // <- replaces the two rest* thresholds
      })
      // OLD (deprecated, removed next major): runOnJS(onSettled)(x.value)
      // NEW:
      scheduleOnRN(onSettled, x.value)
    })

  // withTiming is unchanged.
  const reveal = () => {
    open.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) })
  }

  return (
    <GestureDetector gesture={g}>
      <Animated.View style={style} onTouchEnd={reveal} />
    </GestureDetector>
  )
}

// Root wiring — app/_layout.tsx must have GestureHandlerRootView at the top.
// Also new in v4: CSS-style animations (animationName / transitionProperty on
// Animated.View styles). Nice for simple enter/exit, but shared values remain
// the right tool for anything gesture-driven.
```

### 4. Orbit camera — pan → yaw/pitch, pinch → zoom, with decay inertia and rubber-banded clamps

```tsx
// apps/mobile/src/components/orbit-camera.ts
import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import {
  clamp,
  useSharedValue,
  withDecay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated'

// Per CLAUDE.md these belong in packages/contracts/src/constants.ts.
export const ORBIT = {
  YAW_PER_PX: 0.0065,
  PITCH_PER_PX: 0.0065,
  PITCH_MIN: -1.4, // ~±80°, stops the pole flip
  PITCH_MAX: 1.4,
  ZOOM_MIN: 0.5,
  ZOOM_MAX: 6,
  ZOOM_OVERSHOOT: 1.35, // allowed rubber-band beyond the clamp during pinch
  DECELERATION: 0.997, // higher = longer glide (default 0.998)
} as const

const SETTLE = { damping: 20, stiffness: 200, mass: 0.7 } as const

export type Camera = {
  yaw: SharedValue<number>
  pitch: SharedValue<number>
  zoom: SharedValue<number>
}

export function useOrbitCamera(initial = { yaw: 0, pitch: 0.35, zoom: 1 }) {
  const yaw = useSharedValue(initial.yaw)
  const pitch = useSharedValue(initial.pitch)
  const zoom = useSharedValue(initial.zoom)
  const zoomStart = useSharedValue(initial.zoom)

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      // 1 finger only, so the 2nd finger belongs unambiguously to the pinch
      .minPointers(1)
      .maxPointers(1)
      .onBegin(() => {
        // Self-assignment CANCELS a running withDecay. Without this, grabbing
        // mid-glide fights the animation instead of taking over from it.
        yaw.value = yaw.value
        pitch.value = pitch.value
      })
      .onChange((e) => {
        // Divide by zoom so the drag feels 1:1 at every zoom level.
        yaw.value -= (e.changeX * ORBIT.YAW_PER_PX) / zoom.value
        pitch.value = clamp(
          pitch.value + (e.changeY * ORBIT.PITCH_PER_PX) / zoom.value,
          ORBIT.PITCH_MIN,
          ORBIT.PITCH_MAX,
        )
      })
      .onEnd((e) => {
        // Yaw is unbounded -> plain decay, spins on forever, slowing down.
        yaw.value = withDecay({
          velocity: (-e.velocityX * ORBIT.YAW_PER_PX) / zoom.value,
          deceleration: ORBIT.DECELERATION,
        })
        // Pitch is bounded -> decay with clamp + rubber band at the poles.
        pitch.value = withDecay({
          velocity: (e.velocityY * ORBIT.PITCH_PER_PX) / zoom.value,
          deceleration: ORBIT.DECELERATION,
          clamp: [ORBIT.PITCH_MIN, ORBIT.PITCH_MAX],
          rubberBandEffect: true,
          rubberBandFactor: 0.6,
        })
      })

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        zoom.value = zoom.value // cancel any settle spring
        zoomStart.value = zoom.value
      })
      .onUpdate((e) => {
        // Allow overshoot during the gesture, snap back on release.
        zoom.value = clamp(
          zoomStart.value * e.scale,
          ORBIT.ZOOM_MIN / ORBIT.ZOOM_OVERSHOOT,
          ORBIT.ZOOM_MAX * ORBIT.ZOOM_OVERSHOOT,
        )
      })
      .onEnd(() => {
        const target = clamp(zoom.value, ORBIT.ZOOM_MIN, ORBIT.ZOOM_MAX)
        if (target !== zoom.value) zoom.value = withSpring(target, SETTLE)
      })

    // Simultaneous: both recognisers stay active, so you can orbit and zoom in
    // the same continuous touch without either cancelling the other.
    return Gesture.Simultaneous(pan, pinch)
  }, [yaw, pitch, zoom, zoomStart])

  const reset = () => {
    yaw.value = withSpring(initial.yaw, SETTLE)
    pitch.value = withSpring(initial.pitch, SETTLE)
    zoom.value = withSpring(initial.zoom, SETTLE)
  }

  return { camera: { yaw, pitch, zoom } as Camera, gesture, reset }
}

// Mount: <GestureDetector gesture={gesture}><Canvas .../></GestureDetector>
// and make sure app/_layout.tsx wraps everything in <GestureHandlerRootView>.
```

### 5. Detented slider — 8 steps, haptic at every detent, gesture-handler + Reanimated only

```tsx
// apps/mobile/src/components/detented-slider.tsx
//
// NOTE: @react-native-community/slider IS in Expo Go (5.2.0) — the brief's
// premise is wrong. We still hand-roll, because that component has no detent
// haptics and runs its value through the JS thread.

import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useMemo } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  clamp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

// -> packages/contracts/src/constants.ts (CLAUDE.md: no magic numbers)
export const SLIDER_STEPS = 8

const THUMB = 30
const TRACK_H = 6
const TICK = 3
const SNAP = { damping: 17, stiffness: 260, mass: 0.55, energyThreshold: 6e-9 } as const
const FLING = 0.06 // s of projected velocity used to pick the landing detent

type Props = {
  value: number // 0 .. steps-1
  onChange: (index: number) => void
  steps?: number
  disabled?: boolean
  label?: string
}

// Runs on the JS thread via scheduleOnRN. Edges get a firmer tap so you can
// feel that you've bottomed out without looking.
function tick(isEdge: boolean) {
  if (isEdge) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)
  else void Haptics.selectionAsync()
}

export function DetentedSlider({
  value,
  onChange,
  steps = SLIDER_STEPS,
  disabled = false,
  label,
}: Props) {
  const travel = useSharedValue(0) // usable px = trackWidth - THUMB
  const x = useSharedValue(0) // thumb left offset
  const startX = useSharedValue(0)
  const index = useSharedValue(value)
  const active = useSharedValue(0)

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const t = Math.max(e.nativeEvent.layout.width - THUMB, 1)
      travel.value = t
      x.value = (t / Math.max(steps - 1, 1)) * index.value
    },
    [steps, travel, x, index],
  )

  // Follow the parent when `value` is driven from outside (undo, reset…).
  useEffect(() => {
    if (value === index.value || travel.value === 0) return
    index.value = value
    x.value = withSpring((travel.value / Math.max(steps - 1, 1)) * value, SNAP)
  }, [value, steps, x, index, travel])

  const gesture = useMemo(() => {
    const step = () => {
      'worklet'
      return travel.value / Math.max(steps - 1, 1)
    }

    // Detect a detent crossing and fire exactly one haptic per crossing.
    const settle = (px: number, commit: boolean) => {
      'worklet'
      const i = clamp(Math.round(px / step()), 0, steps - 1)
      if (i !== index.value) {
        index.value = i
        scheduleOnRN(tick, i === 0 || i === steps - 1)
      }
      if (commit) {
        x.value = withSpring(step() * i, SNAP)
        scheduleOnRN(onChange, i)
      }
      return i
    }

    const pan = Gesture.Pan()
      .enabled(!disabled)
      .minDistance(0)
      .activeOffsetX([-4, 4]) // let a vertical parent scroll win
      .failOffsetY([-12, 12])
      .onBegin(() => {
        active.value = withSpring(1, SNAP)
        startX.value = x.value // also cancels any in-flight spring
      })
      .onUpdate((e) => {
        x.value = clamp(startX.value + e.translationX, 0, travel.value)
        settle(x.value, false) // haptic while dragging, no commit yet
      })
      .onEnd((e) => {
        // Velocity-aware: a flick carries you to the next detent.
        const projected = clamp(x.value + e.velocityX * FLING, 0, travel.value)
        settle(projected, true)
      })
      .onFinalize(() => {
        active.value = withSpring(0, SNAP)
      })

    const tap = Gesture.Tap()
      .enabled(!disabled)
      .maxDuration(260)
      .onEnd((e) => {
        settle(clamp(e.x - THUMB / 2, 0, travel.value), true)
      })

    return Gesture.Exclusive(pan, tap)
  }, [disabled, steps, onChange, x, startX, travel, index, active])

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: 1 + active.value * 0.16 }],
  }))
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + THUMB / 2 }))

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={onLayout}
        style={[s.root, disabled && s.disabled]}
        // VoiceOver: two-finger swipe up/down adjusts, and announces the step.
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: steps - 1, now: value }}
        onAccessibilityAction={(e) => {
          const d = e.nativeEvent.actionName === 'increment' ? 1 : -1
          const next = clamp(value + d, 0, steps - 1)
          if (next !== value) {
            tick(next === 0 || next === steps - 1)
            onChange(next)
          }
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      >
        <View style={s.track} />
        <Animated.View style={[s.fill, fillStyle]} />

        {/* detent pips */}
        <View style={s.ticks} pointerEvents="none">
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={[s.tick, i <= value && s.tickOn]} />
          ))}
        </View>

        <Animated.View style={[s.thumb, thumbStyle]} />
      </View>
    </GestureDetector>
  )
}

const s = StyleSheet.create({
  root: { height: 44, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: THUMB / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: '#61DAFB',
  },
  ticks: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tick: {
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  tickOn: { backgroundColor: '#0B0B10' },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#F3F3F8',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
})
```

### 6. Japanese TextInput — IME-safe, uncontrolled, correct props for RN 0.86 / Fabric

```tsx
// apps/mobile/src/components/jp-word-input.tsx
//
// THE RULE: on New-Architecture iOS (SDK 55+ has no opt-out), a CONTROLLED
// TextInput destroys IME composition state. Feeding `value` back while the user
// is 変換中 duplicates or eats characters. Go uncontrolled.

import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { TextInput, type TextInputProps } from 'react-native'

export type JpWordInputHandle = { clear: () => void; focus: () => void }

type Props = {
  onSubmit: (word: string) => void
  defaultValue?: string
  placeholder?: string
  maxChars?: number // enforced on COMMIT, never via maxLength
} & Pick<TextInputProps, 'editable' | 'style'>

// Normalise the way the server will (NFKC + trim). Full-width ＡＢＣ and
// half-width ｶﾅ both collapse to their canonical form.
function normalize(raw: string) {
  return raw.normalize('NFKC').trim()
}

export const JpWordInput = forwardRef<JpWordInputHandle, Props>(
  ({ onSubmit, defaultValue = '', placeholder = 'ことばを入力', maxChars = 16, ...rest }, ref) => {
    const input = useRef<TextInput>(null)
    // Mirror the text in a ref. NEVER in state that feeds back into `value`.
    const draft = useRef(defaultValue)

    useImperativeHandle(ref, () => ({
      clear: () => {
        draft.current = ''
        input.current?.clear()
      },
      focus: () => input.current?.focus(),
    }))

    // Fires on EVERY composition update, including unconverted かな. There is
    // no onCompositionStart/End in RN and the marked-text range is not exposed
    // to JS — so you cannot detect 変換中. Just record, never react.
    const onChangeText = useCallback((t: string) => {
      draft.current = t
    }, [])

    // Commit points. On the Japanese keyboard the return key doubles as 確定,
    // so onSubmitEditing can fire on a conversion commit — validate, don't trust.
    const commit = useCallback(() => {
      const w = normalize(draft.current)
      if (!w || w.length > maxChars) return // server re-validates anyway
      onSubmit(w)
    }, [onSubmit, maxChars])

    return (
      <TextInput
        ref={input}
        // UNCONTROLLED: defaultValue, not value.
        defaultValue={defaultValue}
        onChangeText={onChangeText}
        onSubmitEditing={commit}
        onEndEditing={commit} // covers dismissing the keyboard without 確定
        placeholder={placeholder}

        // --- the props that matter for Japanese ---
        // iOS autocorrect competes with the IME candidate bar. Always off.
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        // 'default' keeps the full IME. NEVER use 'ascii-capable',
        // 'visible-password', 'email-address' or 'numeric' — each of those
        // disables or bypasses the Japanese keyboard on iOS.
        keyboardType="default"
        returnKeyType="done"
        // blurOnSubmit is DEPRECATED in RN 0.86. submitBehavior replaces it and
        // overrides it. 'blurAndSubmit' = close keyboard + fire onSubmitEditing.
        submitBehavior="blurAndSubmit"
        // maxLength IS OMITTED ON PURPOSE: Fabric truncates mid-composition,
        // cutting off 変換 before the user can pick a candidate. Enforce length
        // in commit() and on the server instead.
        {...rest}
      />
    )
  },
)
JpWordInput.displayName = 'JpWordInput'

// Server side (apps/api/src/services/game.ts), per CLAUDE.md:
//   const word = raw.normalize('NFKC').trim()
//   if (word.length === 0 || word.length > MAX_WORD_LEN) -> 400
// Client length checks are cosmetic; the server owns the rule.
```

### 7. Share image — Skia offscreen render → base64 → expo-file-system → expo-sharing (works in Expo Go, captures Skia)

```tsx
// apps/mobile/src/features/share/make-share-image.ts
//
// react-native-view-shot@5.1.0 IS in Expo Go — but captureRef goes through the
// view's draw() path and Skia renders into its own surface, so a Skia canvas
// comes back BLANK. The Skia route below is the one that works, and it also
// frees you from mounting the card on screen at all.

import {
  Canvas,
  Circle,
  Fill,
  Group,
  ImageFormat,
  LinearGradient,
  Paragraph,
  Skia,
  TextAlign,
  drawAsImage,
  vec,
  type SkFontMgr,
} from '@shopify/react-native-skia'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

export const SHARE_W = 1080
export const SHARE_H = 1350 // 4:5, the safest single ratio for IG/X/LINE

type Result = { date: string; goal: string; turns: number; score: number }

function ShareCard({ result, fontMgr }: { result: Result; fontMgr: SkFontMgr }) {
  const title = Skia.ParagraphBuilder.Make(
    { textAlign: TextAlign.Center, maxLines: 2 },
    fontMgr,
  )
    .pushStyle({
      fontFamilies: ['Noto Sans JP', 'Hiragino Sans'],
      fontSize: 96,
      fontStyle: { weight: 700 },
      heightMultiplier: 1.4,
      color: Skia.Color('#F3F3F8'),
    })
    .addText(result.goal)
    .pop()
    .build()
  title.layout(SHARE_W - 160)

  return (
    <Group>
      <Fill>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(SHARE_W, SHARE_H)}
          colors={['#0B0B10', '#1B1B33']}
        />
      </Fill>
      <Circle cx={SHARE_W / 2} cy={SHARE_H * 0.32} r={260} color="#61DAFB" opacity={0.18} />
      <Paragraph paragraph={title} x={80} y={SHARE_H * 0.5} width={SHARE_W - 160} />
    </Group>
  )
}

export async function shareResult(result: Result, fontMgr: SkFontMgr) {
  // 1) Render OFFSCREEN at full export resolution. No mounted Canvas needed,
  //    so the share card can be bigger and cleaner than anything on screen.
  const image = await drawAsImage(
    <ShareCard result={result} fontMgr={fontMgr} />,
    { width: SHARE_W, height: SHARE_H },
  )
  if (!image) throw new Error('share: offscreen render failed')

  // 2) PNG -> base64
  const b64 = image.encodeToBase64(ImageFormat.PNG, 100)

  // 3) expo-file-system CLASS API (SDK 54+). Unique name so create() can never
  //    collide — create() throws on an existing path.
  const dir = new Directory(Paths.cache, 'share')
  if (!dir.exists) dir.create({ intermediates: true })
  const file = new File(dir, `coto2ba-${result.date}-${Date.now()}.png`)
  file.create()
  file.write(b64, { encoding: 'base64' })

  // 4) Native share sheet
  if (!(await Sharing.isAvailableAsync())) throw new Error('share: unavailable')
  await Sharing.shareAsync(file.uri, {
    mimeType: 'image/png',
    UTI: 'public.png', // iOS
    dialogTitle: 'コトコトバの結果をシェア',
  })

  image.dispose?.() // free the Skia surface
  return file.uri
}

// ---- Variant A: snapshot a Canvas that IS on screen ----
// import { useCanvasRef } from '@shopify/react-native-skia'
// const ref = useCanvasRef()
// <Canvas ref={ref} ...>
// const img = await ref.current!.makeImageSnapshotAsync()   // async: required
//   whenever the canvas contains textures (useTexture/Atlas). The sync
//   makeImageSnapshot() is only safe for texture-free drawings.

// ---- Variant B: composite plain RN UI into the Skia card ----
// import { makeImageFromView } from '@shopify/react-native-skia'
// const snap = await makeImageFromView(viewRef)   // viewRef needs collapsable={false}
// ...then draw <Image image={snap} .../> inside ShareCard.

// ---- When view-shot IS the right tool (pure RN views, no Skia) ----
// import { captureRef } from 'react-native-view-shot'
// const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile',
//   width: 1080 / PixelRatio.get(), height: 1350 / PixelRatio.get() })
// captureRef sizes in LOGICAL px — divide your target pixel size by PixelRatio.get().
```

### 8a. TanStack Query v5 + better-auth cookie header (RN wiring)

```tsx
// apps/mobile/src/lib/query.ts
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'
import * as Network from 'expo-network'
import { AppState, Platform, type AppStateStatus } from 'react-native'

// --- online status (module scope, runs once) ---
onlineManager.setEventListener((setOnline) => {
  let seeded = false
  const sub = Network.addNetworkStateListener((s) => {
    seeded = true
    setOnline(!!s.isConnected)
  })
  Network.getNetworkStateAsync()
    .then((s) => { if (!seeded) setOnline(!!s.isConnected) })
    .catch(() => {})
  return sub.remove
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 2,
      // RN has no window focus; focusManager below drives refetch instead.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
})

// --- refetch when the app returns to the foreground ---
export function useAppStateFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active')
    })
    return () => sub.remove()
  }, [])
}

// apps/mobile/src/lib/api.ts -----------------------------------------------
import { authClient } from './auth' // createAuthClient({ plugins: [expoClient({...})] })

const BASE = process.env.EXPO_PUBLIC_API_URL!

// Native has no cookie jar: better-auth keeps the session cookie in SecureStore
// and you attach it by hand. credentials:'omit' is REQUIRED — 'include' makes
// the platform fetch clobber the header you just set.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = await authClient.getCookie()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return (await res.json()) as T
}

// If you ever switch to a bearer token instead of the cookie plugin, the only
// change is: Authorization: `Bearer ${await SecureStore.getItemAsync('token')}`

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// apps/mobile/src/app/_layout.tsx ------------------------------------------
// import { GestureHandlerRootView } from 'react-native-gesture-handler'
// import { KeyboardProvider } from 'react-native-keyboard-controller'
// import { QueryClientProvider } from '@tanstack/react-query'
//
// export default function RootLayout() {
//   useAppStateFocus()
//   return (
//     <GestureHandlerRootView style={{ flex: 1 }}>
//       <KeyboardProvider>
//         <QueryClientProvider client={queryClient}>
//           <Stack screenOptions={{ headerShown: false }} />
//         </QueryClientProvider>
//       </KeyboardProvider>
//     </GestureHandlerRootView>
//   )
// }
```

### 8b. zustand 5.0.15 in React Native (v5 selector gotcha)

```ts
// apps/mobile/src/stores/game-ui.ts
// zustand needs NO React Native setup — it is plain JS. Just install it.
import AsyncStorage from '@react-native-async-storage/async-storage' // in Expo Go
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { createJSONStorage, persist } from 'zustand/middleware'

type GameUi = {
  mixRatio: number // detented slider index, 0..SLIDER_STEPS-1
  selected: string[]
  setMixRatio: (i: number) => void
  toggle: (word: string) => void
  reset: () => void
}

export const useGameUi = create<GameUi>()(
  persist(
    (set) => ({
      mixRatio: 4,
      selected: [],
      setMixRatio: (mixRatio) => set({ mixRatio }),
      toggle: (word) =>
        set((s) => ({
          selected: s.selected.includes(word)
            ? s.selected.filter((w) => w !== word)
            : [...s.selected, word],
        })),
      reset: () => set({ selected: [] }),
    }),
    {
      name: 'coto2ba.game-ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ mixRatio: s.mixRatio }), // don't persist selection
    },
  ),
)

// v5 BREAKING BEHAVIOUR: there is no automatic shallow comparison any more.
// A selector returning a NEW object every call re-renders on every store write.
//   BAD:  const { a, b } = useGameUi((s) => ({ a: s.a, b: s.b }))
//   GOOD: two atomic selectors, or useShallow:
export const useMixRatio = () => useGameUi((s) => s.mixRatio)
export const useSelection = () =>
  useGameUi(useShallow((s) => [s.selected, s.toggle] as const))

// Rule of thumb: zustand for ephemeral UI state, TanStack Query for anything
// the server owns. Never mirror server state into zustand.
```

### 9. Keeping the input above the keyboard in Expo Go — keyboard-controller (it IS bundled)

```tsx
// react-native-keyboard-controller@1.21.9 IS included in Expo Go for SDK 57.
// The library's own docs still say "requires a development build" — stale.
// Verify with: https://docs.expo.dev/versions/latest/sdk/keyboard-controller/

// --- app/_layout.tsx: KeyboardProvider must wrap everything ---
import { KeyboardProvider } from 'react-native-keyboard-controller'
// <GestureHandlerRootView><KeyboardProvider>…</KeyboardProvider></GestureHandlerRootView>

// --- BEST for a word-entry bar pinned to the bottom ---
// KeyboardStickyView tracks the keyboard frame-by-frame off the JS thread, so
// the bar rides the keyboard's own curve instead of snapping after it.
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { JpWordInput } from '../components/jp-word-input'

export function GuessBar({ onSubmit }: { onSubmit: (w: string) => void }) {
  const insets = useSafeAreaInsets()
  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: -insets.bottom }} // don't double-count the home bar
    >
      <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, backgroundColor: '#12121C' }}>
        <JpWordInput onSubmit={onSubmit} />
      </View>
    </KeyboardStickyView>
  )
}

// --- For a scrolling form (settings, feedback) ---
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
// <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 16 }}>
//   …inputs…
// </KeyboardAwareScrollView>
// bottomOffset = extra gap you want between the focused field and the keyboard.

// --- Drop-in replacement for RN's component (no per-platform `behavior`) ---
// import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
// <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>

// --- Zero-dependency fallback, if you refuse the extra package ---
// RN's own KeyboardAvoidingView needs behavior="padding" on iOS and
// behavior="height" (or nothing) on Android, plus keyboardVerticalOffset tuned
// to your header height. It animates on a different curve from the keyboard, so
// it visibly lags on iOS. Only acceptable for a screen with one input and no
// header. Prefer keyboard-controller.
```


## リスク

- VERSION PINNING IS THE #1 BUILD KILLER. Expo Go embeds fixed native binaries. @shopify/react-native-skia must be exactly 2.6.2 — npm latest is 2.11.2 and installing it gives a JSI/native mismatch that often manifests as a blank canvas or a hard crash rather than a clear error. Always `npx expo install`, never `pnpm add`, for anything with native code. The repo's apps/mobile/package.json is currently correct; add a `pnpm --filter mobile doctor` (npx expo-doctor) step to CI to keep it that way.
- DO NOT CREATE apps/mobile/babel.config.js. There isn't one today, and that is correct: babel-preset-expo injects `react-native-worklets/plugin` automatically. Adding `react-native-reanimated/plugin` by hand now throws at build time, and adding the worklets plugin twice silently breaks worklet capture. If you ever do add a babel config for another reason, the worklets plugin must remain LAST in the plugin list.
- Japanese IME on iOS Fabric is genuinely broken (RN issue #56463, unfixed). Any controlled TextInput — `value` + `onChangeText` + setState — will eat or duplicate characters during 変換, and `maxLength` truncates mid-composition so users cannot reach their candidate. There is no Legacy Architecture fallback since SDK 55. The input MUST be uncontrolled (`defaultValue` + ref), must not set `maxLength`, and must commit on onSubmitEditing/onEndEditing. Budget real device testing time for this — it will not show up on a simulator with an English keyboard.
- Worklet closure capture will silently destroy Atlas performance. `useRSXformBuffer`'s callback is a worklet; any plain JS array or object it closes over is deep-copied into the UI runtime each time the worklet is rebuilt. Closing over a 2400-element array of point objects turns a free animation into a stutter. Pack coordinates into Float32Array held in useSharedValue and index into that.
- Atlas/RSXform is uniform-scale only — no per-sprite width/height, no skew. If the design calls for elliptical or differently-proportioned nodes, Atlas cannot express it and you need Vertices with a shader, or one draw per shape class. Decide this before the visual design is locked.
- react-native-view-shot will return a blank image over any Skia canvas. It is in Expo Go and captureRef works fine on plain RN views, so it will look like it's working right up until the share card is empty. Use drawAsImage / makeImageSnapshotAsync for anything Skia-rendered.
- `makeImageSnapshot()` (sync) is unsafe on a canvas that contains textures — which includes every Atlas drawing built with `useTexture`. Use `makeImageSnapshotAsync()`, or skip the mounted canvas and use `drawAsImage` offscreen.
- expo-file-system's `file.create()` THROWS if the path already exists, and `new Directory(...)` does not create the directory. Re-sharing the same result twice will crash unless you use a unique filename or guard with `dir.exists` / `file.exists`. Also note the whole API changed in SDK 54 — any snippet you find using `FileSystem.writeAsStringAsync` is the legacy API and now throws a deprecation error unless imported from `expo-file-system/legacy`.
- Skia's font manager and expo-font are completely separate registries. Loading Noto Sans JP through expo-font's useFonts makes it available to RN `<Text>` and to nothing else; `matchFont` with the system font manager will not see it. You must register fonts a second time via Skia's `useFonts`, or you get tofu inside the canvas while the surrounding UI looks fine.
- Noto Sans JP static TTF is ~4–6 MB per weight. Two weights adds ~10 MB to the Expo Go / OTA download and several hundred ms of parse. Subset it against your actual vocabulary in tools/pipeline (pyftsubset typically gets 6 MB → ~300 KB), or use iOS's built-in Hiragino Sans via matchFont for zero bytes.
- `experiments.reactCompiler: true` is already enabled in app.json. It is incompatible with NativeWind's className transform — if anyone adds NativeWind for styling, that flag must come out first. Also re-verify worklet-heavy components after any React Compiler upgrade; the compiler memoises aggressively and interacts with Reanimated's babel transform.
- withDecay inertia fights the next gesture unless you cancel it. Without the `yaw.value = yaw.value` self-assignment in `.onBegin`, grabbing the camera mid-glide produces a rubbery double-motion. Same applies to the slider thumb and any spring in flight.
- Gesture.Pan must be constrained with `.minPointers(1).maxPointers(1)` when composed Simultaneously with Gesture.Pinch, or the second finger's motion leaks into the pan translation and the camera lurches whenever a pinch starts.
- GestureHandlerRootView is not added for you. Without it at the root of app/_layout.tsx, every GestureDetector silently does nothing on iOS — no error, just dead touches.
- zustand v5 removed automatic shallow comparison. A selector returning a fresh object (`(s) => ({ a: s.a, b: s.b })`) now re-renders on every single store write. Use atomic selectors or `useShallow`. This is a performance regression that only appears under load, e.g. while dragging the slider.
- Haptics fired from a worklet must go through `scheduleOnRN` — calling `Haptics.selectionAsync()` directly inside a worklet crashes. And fire exactly once per detent crossing (guard on a shared `index` value), or a fast drag across 8 detents queues a burst of taps that feels like a buzz.
- `blurOnSubmit` is deprecated in RN 0.86 and is overridden by `submitBehavior` wherever both are present. Mixing them produces behaviour that depends on prop order — pick `submitBehavior` and delete every `blurOnSubmit`.
- expo-network is not currently in apps/mobile/package.json but the TanStack Query onlineManager wiring needs it. Add it with `npx expo install expo-network` (or use @react-native-community/netinfo, also in Expo Go).

## 結論

Build on Expo SDK 57 / Expo Go with the versions already pinned in `apps/mobile/package.json` — they are exactly right; treat them as frozen and enforce with `expo-doctor` in CI.

**Render the word-space with Skia `Atlas`, not `Points` or `Vertices`.** One white radial-gradient dot at 32×32 via `useTexture`, `sprites` as N copies of the same rect, `transforms` from `useRSXformBuffer` (3D orbit projection computed in the worklet), and per-point tint through `colors` + `colorBlendMode={BlendMode.SrcIn}`. Pack point coordinates into `Float32Array`s stored in shared values — never close over a JS object array in the buffer worklet. That gives one draw call and a free 60/120 fps orbit for 2400 points.

**Drive the camera with `Gesture.Simultaneous(pan, pinch)`**, pan constrained to one pointer, yaw on plain `withDecay`, pitch on `withDecay` with `clamp` + `rubberBandEffect`, zoom rubber-banding past its clamp during the pinch and springing back on release. Cancel in-flight decay in `.onBegin` with a self-assignment.

**Hand-roll the detented slider** (snippet 5) — `@react-native-community/slider` is available in Expo Go but has no detent haptics and runs values through JS. Detent crossing is detected in the pan worklet and fires `scheduleOnRN(tick, isEdge)` exactly once per crossing, with `selectionAsync()` for interior detents and `impactAsync(Rigid)` at the ends. Add `accessibilityRole="adjustable"` — it is four lines and makes the control usable with VoiceOver.

**Treat the Japanese input as the highest-risk item and design around the Fabric IME bug from day one**: uncontrolled `TextInput`, `defaultValue` + ref, no `maxLength`, `autoCorrect={false}`, `keyboardType="default"`, `submitBehavior="blurAndSubmit"`, commit on submit/end-editing, NFKC-normalise, and let `apps/api/src/services/game.ts` be the only thing that decides whether a word is legal. Test on a real iPhone with the Japanese keyboard before building anything on top of it.

**For share images, go Skia-only**: `drawAsImage` an offscreen 1080×1350 card → `encodeToBase64(ImageFormat.PNG)` → `File`/`Paths` from expo-file-system's class API (unique filename, since `create()` throws on collision) → `Sharing.shareAsync`. Keep `react-native-view-shot` for plain-RN captures only; it returns blank over Skia.

**Fonts**: start with iOS's `Hiragino Sans` via `matchFont` to get moving with zero payload, and only ship a Noto Sans JP subset — generated in `tools/pipeline` against the actual vocabulary — once the visual design demands it. Remember Skia needs its own `useFonts` registration separate from expo-font.

**Keyboard**: `react-native-keyboard-controller` is in Expo Go for SDK 57 despite its own docs saying otherwise. Wrap the root in `KeyboardProvider` and use `KeyboardStickyView` for the guess bar; do not fight RN's `KeyboardAvoidingView`.

Finally, per CLAUDE.md, lift every tuning number in these snippets — `SLIDER_STEPS`, the `ORBIT` block, `DOT`/`FOCAL`/`CAM_DIST`, `SHARE_W`/`SHARE_H`, `MAX_WORD_LEN` — into `packages/contracts/src/constants.ts` so the client and the server agree on them.
