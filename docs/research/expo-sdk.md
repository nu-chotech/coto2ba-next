# Expo SDK 57 (current stable, 2026-09-17) — Expo Go compatibility matrix, package versions, and API shapes for a React Native word-puzzle app

## 要約

**Latest stable is Expo SDK 57.** `npm view expo dist-tags` → `latest: 57.0.23` (`sdk-57: 57.0.23`). `npx create-expo-app@latest` (create-expo-app 4.0.0) pulls `expo-template-default@57.0.25`, whose package.json pins `"expo": "~57.0.23"`, `"react": "19.2.3"`, `"react-dom": "19.2.3"`, `"react-native": "0.86.3"`. SDK 57 shipped 2026-06-30 and is a deliberately small "pass-through" release: RN 0.85→0.86, React unchanged at 19.2. SDK 58 beta was announced 2026-09-15 (RN 0.88 RC), beta lasts 3–4 weeks — **that is the single biggest risk to this project** (below).

**Expo Go on the App Store is version 57.0.9, released 2026-09-02** (verified via the iTunes lookup API, which also states "this version of Expo uses React Native 0.86"; minimum iOS 16.4). So SDK 57 *is* on the store today — older blog/changelog chatter about SDK 55/56/57 being stuck in review is stale. Expo Go supports exactly one SDK; when SDK 58 goes stable (~mid-to-late Oct 2026) the store build flips to 58 and SDK 57 projects stop opening in it.

**Every single package on your list is included in Expo Go for SDK 57.** I verified three ways: the published `bundledNativeModules.json` inside `expo@57.0.23` (what `npx expo install` resolves against), `apps/expo-go/package.json` on the `sdk-57` branch (what the Expo Go binary is compiled from), and the docs' per-module "Included in Expo Go" badge plus `/versions/latest/sdk/third-party-overview/`. **`@shopify/react-native-skia` (2.6.2) and `react-native-view-shot` (5.1.0) are both in Expo Go** — confirmed on the third-party list and on the `captureRef` doc page (`inExpoGo: true`). Packages not in `apps/expo-go/package.json` directly (`expo-file-system`, `expo-symbols`, `expo-glass-effect`, `expo-status-bar`) are still present: the first is a dependency of `expo` itself, the next two are dependencies of `expo-router`, and `expo-status-bar` is pure JS.

**Caveats that are not "not included" but behave differently:** `expo-notifications` — local notifications work, remote/push is unavailable in Expo Go on Android since SDK 53 and is not production-usable on iOS Expo Go. `expo-updates` — the header says Included in Expo Go but "most of the Updates API is unavailable when running in Expo Go". `expo-glass-effect` — iOS 26+ only, silently degrades to a plain `View` elsewhere (incl. all of Android and web).

**Native tabs:** for SDK 55–57 the import is `expo-router/unstable-native-tabs` (confirmed: the tarball has `unstable-native-tabs.js`/`.d.ts` at package root, no `native-tabs.js`; the official SDK 57 template's `src/components/app-tabs.tsx` imports from it). It becomes `expo-router/native-tabs` in SDK 58. Also: `import { Tabs } from 'expo-router'` is now **deprecated** — the d.ts says "Use `import { Tabs } from 'expo-router/js-tabs'` instead".

**New Architecture is mandatory** from SDK 55 onward — "always enabled and cannot be disabled"; `newArchEnabled` is ignored. Expo Go only supports the New Arch. Reanimated 4.5.1 therefore requires `react-native-worklets@0.10.1` as a direct dependency; `babel-preset-expo@57` auto-injects `react-native-worklets/plugin` when it's installed, so no hand-written babel.config.js is needed.

`npx expo export --platform ios` needs **no Xcode** — it's pure Metro bundling producing `dist/` (JS bundle + assets + metadata.json). It verifies JS/TS resolution, Metro config, and asset references only — it will *not* catch "this native module isn't in Expo Go". `npx expo-doctor` is the health check; `npx expo install --check` / `--fix` enforces the SDK 57 version pins.


## 事実

- **[high]** Latest stable Expo SDK is 57; `npm view expo dist-tags` returns latest: 57.0.23, sdk-57: 57.0.23. SDK 58 exists only as next: 58.0.0-preview.2 / canary.
  - source: `npm registry: `npm view expo dist-tags` (run 2026-09-17)`
- **[high]** `npx create-expo-app@latest` uses create-expo-app@4.0.0 and installs expo-template-default@57.0.25, which pins "expo": "~57.0.23".
  - source: `npm: `npm view create-expo-app version`; `npm pack expo-template-default@latest` → package/package.json`
- **[high]** SDK 57 pairs with react-native 0.86.3, react 19.2.3, react-dom 19.2.3, react-native-web ~0.21.0.
  - source: `expo@57.0.23 tarball → package/bundledNativeModules.json`
- **[high]** Expo SDK 57 was released 2026-06-30; it upgrades React Native 0.85→0.86 and leaves React at 19.2 (unchanged from SDK 56).
  - source: `https://expo.dev/changelog/sdk-57`
- **[high]** expo@57.0.17 bumped React Native to 0.86.3, fixing the Hermes V1 memory regression from SDK 56 affecting apps importing react-native-worklets / react-native-reanimated. Use >= 57.0.17.
  - source: `https://expo.dev/changelog/sdk-57`
- **[high]** Expo Go on the Apple App Store is version 57.0.9, released 2026-09-02, description says "this version of Expo uses React Native 0.86" (= SDK 57). Minimum iOS 16.4.
  - source: `https://itunes.apple.com/lookup?id=982107779&country=us (authoritative App Store metadata)`
- **[high]** Expo Go supports exactly one SDK at a time. The store build will move to SDK 58 shortly after SDK 58 stable, dropping SDK 57 support.
  - source: `https://expo.dev/changelog/sdk-58-beta`
- **[high]** SDK 58 beta was announced 2026-09-15 with React Native 0.88 RC; the beta period is 3–4 weeks, with stable shipping after RN 0.88 releases.
  - source: `https://expo.dev/changelog/sdk-58-beta`
- **[high]** expo-router for SDK 57 is ~57.0.21 and IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json; https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-glass-effect ~57.0.3 IS in Expo Go (it is a direct dependency of expo-router, so it is compiled into the Expo Go binary). Docs page lists "iOS, tvOS, Included in Expo Go".
  - source: `https://docs.expo.dev/versions/latest/sdk/glass-effect/ ; expo-router@57.0.21 package.json dependencies`
- **[high]** expo-blur ~57.0.3 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-haptics ~57.0.3 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-audio ~57.0.5 IS in Expo Go.
  - source: `https://docs.expo.dev/versions/latest/sdk/audio/ ; apps/expo-go/package.json (sdk-57)`
- **[high]** expo-symbols ~57.0.3 IS in Expo Go (dependency of expo-router). Docs header: "Android, iOS, tvOS, Web, Included in Expo Go".
  - source: `https://docs.expo.dev/versions/latest/sdk/symbols/`
- **[high]** expo-secure-store ~57.0.4 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-asset ~57.0.17 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-file-system ~57.0.7 IS in Expo Go (it is a direct dependency of the `expo` package itself). Docs header: "Included in Expo Go".
  - source: `https://docs.expo.dev/versions/latest/sdk/filesystem/ ; expo@57.0.23 package.json dependencies`
- **[high]** expo-file-system's default export is now the class API `import { File, Directory, Paths } from 'expo-file-system'`; the old API lives at `expo-file-system/legacy` and legacy methods throw at runtime if imported from the main entry.
  - source: `https://docs.expo.dev/versions/latest/sdk/filesystem/`
- **[high]** expo-clipboard ~57.0.2 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-image ~57.0.5 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-linking ~57.0.10 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-constants ~57.0.18 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-font ~57.0.4 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-sharing ~57.0.20 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-crypto ~57.0.3 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-application ~57.0.3 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-device ~57.0.2 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-status-bar ~57.0.1 works in Expo Go (it is a pure-JS package with no native module, so it needs no Expo Go inclusion).
  - source: `expo@57.0.23 bundledNativeModules.json; expo-status-bar has no native module`
- **[high]** expo-splash-screen ~57.0.9 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-system-ui ~57.0.4 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-web-browser ~57.0.3 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** expo-notifications ~57.0.19 IS in Expo Go, but push/remote notifications are unavailable in Expo Go on Android from SDK 53 onward and require a development build. Local notifications work.
  - source: `https://docs.expo.dev/versions/latest/sdk/notifications/`
- **[high]** expo-updates ~57.0.22 is listed as Included in Expo Go, but "most of the Updates API is unavailable when running in Expo Go" — treat it as unusable for this project.
  - source: `https://docs.expo.dev/versions/latest/sdk/updates/`
- **[high]** expo-image-picker ~57.0.18 IS in Expo Go.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** react-native-reanimated 4.5.1 IS in Expo Go, and requires react-native-worklets 0.10.1 installed as a sibling dependency.
  - source: `expo@57.0.23 bundledNativeModules.json; https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** react-native-gesture-handler ~2.32.0 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json`
- **[high]** react-native-safe-area-context ~5.7.0 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json`
- **[high]** react-native-screens ~4.26.0 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json`
- **[high]** react-native-svg 15.15.4 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json; https://docs.expo.dev/versions/latest/sdk/third-party-overview/`
- **[high]** react-native-webview 13.16.1 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json`
- **[high]** @shopify/react-native-skia 2.6.2 IS in Expo Go for SDK 57 — it is an explicit dependency of the Expo Go app and appears on the official third-party-in-Expo-Go list.
  - source: `https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json ; https://docs.expo.dev/versions/latest/sdk/third-party-overview/`
- **[high]** react-native-view-shot IS in Expo Go for SDK 57; docs captureRef page states "Android, iOS, Included in Expo Go" with inExpoGo: true. `npx expo install` resolves it to 5.1.0.
  - source: `https://docs.expo.dev/versions/v57.0.0/sdk/captureRef/ ; expo@57.0.23 bundledNativeModules.json`
- **[medium]** VERSION SKEW: bundledNativeModules.json for every expo 57.x patch pins react-native-view-shot 5.1.0, but apps/expo-go/package.json on the sdk-57 branch pins 4.0.3 — the Expo Go binary may carry the 4.0.3 native code. view-shot 5.1.0 peers are react>=18, react-native>=0.76, so the JS should still bind, but verify captureRef on a physical device early.
  - source: `expo@57.0.23 bundledNativeModules.json vs https://raw.githubusercontent.com/expo/expo/sdk-57/apps/expo-go/package.json`
- **[high]** @react-native-async-storage/async-storage 2.2.0 IS in Expo Go.
  - source: `expo@57.0.23 bundledNativeModules.json`
- **[high]** @shopify/flash-list 2.0.2 and @expo/vector-icons ^15.0.2 are also in Expo Go for SDK 57 (useful extras).
  - source: `expo@57.0.23 bundledNativeModules.json; https://docs.expo.dev/versions/latest/sdk/third-party-overview/`
- **[high]** For SDK 55–57 the native tabs import is `expo-router/unstable-native-tabs`; the expo-router@57.0.21 tarball contains unstable-native-tabs.js and unstable-native-tabs.d.ts at package root and has NO native-tabs.js entry.
  - source: `npm pack expo-router@57.0.21 → file listing; https://docs.expo.dev/router/advanced/native-tabs/`
- **[high]** In SDK 58 the import moves to `expo-router/native-tabs` (no longer 'unstable').
  - source: `https://docs.expo.dev/router/advanced/native-tabs/`
- **[high]** The official SDK 57 default template (expo-template-default@57.0.25) itself uses NativeTabs from 'expo-router/unstable-native-tabs' in src/components/app-tabs.tsx.
  - source: `npm pack expo-template-default@57.0.25 → package/src/components/app-tabs.tsx`
- **[high]** NativeTabs API surface: NativeTabs, NativeTabs.Trigger, NativeTabs.Trigger.Label, .Icon, .Badge, .VectorIcon, NativeTabs.BottomAccessory (with usePlacement()). Also exported as the standalone NativeTabTrigger.
  - source: `expo-router@57.0.21 → build/native-tabs/NativeTabs.d.ts, build/native-tabs/index.d.ts`
- **[high]** NativeTabs.Trigger.Icon props: `sf` (SF Symbol, iOS), `xcasset` (iOS asset catalog), `drawable` (Android resource), `md` (Material Symbols glyph, Android), `src` (ImageSourcePropType), plus `renderingMode` ('template'|'original', iOS) and `selectedColor`. Each icon prop accepts a string or `{ default, selected }`.
  - source: `expo-router@57.0.21 → build/native-tabs/common/elements.d.ts`
- **[high]** `import { Tabs } from 'expo-router'` is DEPRECATED in expo-router 57 — the type declaration says "Use `import { Tabs } from 'expo-router/js-tabs'` instead".
  - source: `expo-router@57.0.21 → build/exports.d.ts`
- **[high]** expo-router 57 also exports ThemeProvider, DarkTheme, DefaultTheme, useTheme, Stack, Link, Slot, Navigator, router, useRouter, and unstable_* standard-navigation helpers from the package root.
  - source: `expo-router@57.0.21 → build/exports.d.ts, build/index.d.ts`
- **[high]** expo-glass-effect exports exactly: GlassView (default-exported component), GlassContainer, isLiquidGlassAvailable(), isGlassEffectAPIAvailable(), plus types GlassStyle, GlassEffectStyleConfig, GlassColorScheme, GlassViewProps, GlassContainerProps.
  - source: `expo-glass-effect@57.0.3 → build/index.d.ts`
- **[high]** GlassViewProps: glassEffectStyle?: 'clear'|'regular'|'none' | { style, animate?, animationDuration? } (default 'regular'); tintColor?: ColorValue; isInteractive?: boolean (default false); colorScheme?: 'auto'|'light'|'dark' (default 'auto'); plus all ViewProps and ref.
  - source: `expo-glass-effect@57.0.3 → build/GlassView.types.d.ts`
- **[high]** GlassView is iOS 26+ (and tvOS) only. On Android, web and older iOS it silently falls back to rendering a regular View — no error, no visual effect.
  - source: `https://docs.expo.dev/versions/latest/sdk/glass-effect/`
- **[high]** Known expo-glass-effect bug: setting opacity to 0 on a GlassView or any parent stops the glass effect rendering entirely; use the built-in `animate`/`animationDuration` config instead.
  - source: `https://docs.expo.dev/versions/latest/sdk/glass-effect/`
- **[high]** expo-audio 57.0.5 exports useAudioPlayer(source, options), useAudioPlayerStatus(player), createAudioPlayer(source, options), setAudioModeAsync(mode), setIsAudioActiveAsync(active), preload(source, options), clearPreloadedSource, clearAllPreloadedSources, getPreloadedSources, plus recorder and playlist hooks.
  - source: `expo-audio@57.0.5 → build/ExpoAudio.d.ts`
- **[high]** AudioMode fields for setAudioModeAsync: playsInSilentMode (default true), interruptionMode: 'doNotMix'|'duckOthers'|'mixWithOthers' (default 'mixWithOthers'), allowsRecording (default false, iOS), shouldPlayInBackground (default false), shouldRouteThroughEarpiece (default false), allowsBackgroundRecording (optional).
  - source: `expo-audio@57.0.5 → build/Audio.types.d.ts`
- **[high]** To RESPECT the iOS hardware silent switch you must set playsInSilentMode: false — the expo-audio default is true (audio plays even when the ringer is muted).
  - source: `expo-audio@57.0.5 → build/Audio.types.d.ts ("@default true")`
- **[high]** AudioPlayerOptions: updateInterval (default 500ms), downloadFirst (default false), keepAudioSessionActive (iOS, default false — prevents deactivating the session on pause/finish, ideal for SFX), preferredForwardBufferDuration, crossOrigin (web).
  - source: `expo-audio@57.0.5 → build/AudioModule.types.d.ts`
- **[high]** AudioPlayer instance API: play(), pause(), seekTo(seconds, toleranceBefore?, toleranceAfter?), replace(source), remove(), setActiveForLockScreen(...), and properties playing, paused, muted, loop, isLoaded, isBuffering, currentTime, duration, volume.
  - source: `expo-audio@57.0.5 → build/ExpoAudio.d.ts`
- **[high]** The New Architecture is MANDATORY from SDK 55 onward: "SDK 55 and later run entirely on the New Architecture. The New Architecture is always enabled and cannot be disabled." Expo Go only supports the New Architecture. The newArchEnabled app.json key is ignored.
  - source: `https://docs.expo.dev/guides/new-architecture/`
- **[high]** babel-preset-expo@57.0.12 automatically resolves and injects `react-native-worklets/plugin` when react-native-worklets is installed (falling back to react-native-reanimated/plugin) — no manual babel.config.js is required, and the SDK 57 default template ships without one.
  - source: `npm pack babel-preset-expo@57.0.12 → build/configs/expo.js lines 96-107`
- **[high]** The SDK 57 default template's app.json contains no newArchEnabled and no runtimeVersion; it sets scheme, userInterfaceStyle: 'automatic', plugins: ['expo-router', ['expo-splash-screen', {...}]], and experiments: { typedRoutes: true, reactCompiler: true }.
  - source: `npm pack expo-template-default@57.0.25 → package/app.json`
- **[high]** runtimeVersion policies available: nativeVersion, sdkVersion, appVersion, fingerprint. runtimeVersion is irrelevant to Expo Go (which matches on SDK version) and only matters for EAS Update against real builds.
  - source: `https://docs.expo.dev/versions/latest/config/app/`
- **[high]** `npx expo export` does NOT require Xcode — it is a pure Metro bundling operation producing a dist/ directory with the JS bundle, assets and metadata.json. Flags: --platform ios|android|web|all, --output-dir, --dev, --no-minify, --no-bytecode, -c/--clear, --max-workers, --dump-sourcemap.
  - source: `https://docs.expo.dev/more/expo-cli/`
- **[high]** `npx expo-doctor` checks app config and package.json, dependency compatibility against the SDK, config files, and React Native Directory validation. Run with npx/yarn dlx/pnpm dlx/bunx; `npx expo-doctor --help` lists usage.
  - source: `https://docs.expo.dev/develop/tools/`
- **[high]** `npx expo install --check` prompts about incorrectly-versioned packages and exits non-zero in CI; `npx expo install --fix` rewrites them to the SDK-correct versions without prompting.
  - source: `https://docs.expo.dev/more/expo-cli/`

## コード片

### package.json — dependency block, every entry verified present in Expo Go SDK 57

```json
{
  "dependencies": {
    "expo": "~57.0.23",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-web": "~0.21.0",

    "expo-router": "~57.0.21",
    "expo-constants": "~57.0.18",
    "expo-linking": "~57.0.10",
    "expo-status-bar": "~57.0.1",
    "expo-splash-screen": "~57.0.9",
    "expo-system-ui": "~57.0.4",

    "expo-font": "~57.0.4",
    "expo-asset": "~57.0.17",
    "expo-image": "~57.0.5",
    "expo-symbols": "~57.0.3",
    "expo-blur": "~57.0.3",
    "expo-glass-effect": "~57.0.3",

    "expo-audio": "~57.0.5",
    "expo-haptics": "~57.0.3",

    "expo-secure-store": "~57.0.4",
    "expo-file-system": "~57.0.7",
    "expo-clipboard": "~57.0.2",
    "expo-sharing": "~57.0.20",
    "expo-crypto": "~57.0.3",
    "expo-application": "~57.0.3",
    "expo-device": "~57.0.2",
    "expo-web-browser": "~57.0.3",
    "expo-image-picker": "~57.0.18",
    "expo-notifications": "~57.0.19",

    "@react-native-async-storage/async-storage": "2.2.0",
    "@expo/vector-icons": "^15.0.2",

    "react-native-reanimated": "4.5.1",
    "react-native-worklets": "0.10.1",
    "react-native-gesture-handler": "~2.32.0",
    "react-native-safe-area-context": "~5.7.0",
    "react-native-screens": "~4.26.0",
    "react-native-svg": "15.15.4",
    "react-native-webview": "13.16.1",
    "react-native-view-shot": "5.1.0",
    "@shopify/react-native-skia": "2.6.2",
    "@shopify/flash-list": "2.0.2"
  },
  "devDependencies": {
    "@types/react": "~19.2.2",
    "typescript": "~6.0.3"
  }
}
```

### app.json — correct shape for SDK 57 + Expo Go (no newArchEnabled, no runtimeVersion needed)

```json
{
  "expo": {
    "name": "coto2ba",
    "slug": "coto2ba",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "coto2ba",
    "userInterfaceStyle": "automatic",
    "ios": {
      "bundleIdentifier": "app.coto2ba",
      "supportsTablet": false
    },
    "android": {
      "package": "app.coto2ba",
      "adaptiveIcon": {
        "backgroundColor": "#0E0E12",
        "foregroundImage": "./assets/images/android-icon-foreground.png",
        "monochromeImage": "./assets/images/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false
    },
    "web": { "output": "static" },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "backgroundColor": "#0E0E12",
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 76
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    },
    "extra": {
      "apiUrl": "https://coto2ba-api.vercel.app"
    }
  }
}
```

### app.config.ts — same config typed, when you need env vars (use instead of app.json, not alongside)

```ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'coto2ba',
  slug: 'coto2ba',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'coto2ba',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: { bundleIdentifier: 'app.coto2ba', supportsTablet: false },
  android: { package: 'app.coto2ba', predictiveBackGestureEnabled: false },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0E0E12', image: './assets/images/splash-icon.png', imageWidth: 76 }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  },
};

export default config;

// NOTE: `newArchEnabled` is IGNORED on SDK 55+ (New Arch is always on and cannot be disabled).
// NOTE: `runtimeVersion` is irrelevant to Expo Go; add it only when you start shipping EAS builds/updates:
//   runtimeVersion: { policy: 'fingerprint' }
```

### app/(tabs)/_layout.tsx — NativeTabs, the CURRENT SDK 57 API

```tsx
// SDK 55–57: 'expo-router/unstable-native-tabs'
// SDK 58+  : 'expo-router/native-tabs'   <-- rename on upgrade
import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs
      backgroundColor="#0E0E12"
      labelStyle={{ selected: { color: '#C9B8FF' } }}>
      <NativeTabs.Trigger name="index">
        {/* `sf` -> iOS SF Symbol, `md` -> Android Material Symbols glyph */}
        <NativeTabs.Trigger.Icon
          sf={{ default: 'sparkles', selected: 'sparkles' }}
          md="auto_awesome"
        />
        <NativeTabs.Trigger.Label>あそぶ</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Icon sf="clock" md="history" />
        <NativeTabs.Trigger.Label>きろく</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge>3</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        {/* raster fallback works on both platforms */}
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/settings.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>せってい</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

### app/(tabs)/_layout.tsx — stable JS Tabs fallback (note: 'expo-router/js-tabs', NOT 'expo-router')

```tsx
// `import { Tabs } from 'expo-router'` is DEPRECATED in expo-router 57.
import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#C9B8FF',
        tabBarInactiveTintColor: '#6B6B78',
        tabBarStyle: { backgroundColor: '#0E0E12', borderTopWidth: 0 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'あそぶ',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'きろく',
          tabBarBadge: 3,
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

### components/glass-panel.tsx — expo-glass-effect with a guaranteed cross-platform fallback

```tsx
import { BlurView } from 'expo-blur';
import {
  GlassContainer,
  GlassView,
  isLiquidGlassAvailable,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';
import { StyleSheet, View, type ViewProps } from 'react-native';

// isLiquidGlassAvailable(): compile-time + OS check (iOS 26+ / tvOS only).
// isGlassEffectAPIAvailable(): runtime check, needed for iOS 26 betas.
const LIQUID = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function GlassPanel({ children, style, ...rest }: ViewProps) {
  if (LIQUID) {
    return (
      <GlassView
        glassEffectStyle={{ style: 'regular', animate: true, animationDuration: 0.25 }}
        tintColor="rgba(150,120,255,0.18)"
        isInteractive
        colorScheme="auto"
        style={[styles.panel, style]}
        {...rest}>
        {children}
      </GlassView>
    );
  }
  // Android / web / iOS < 26: GlassView would render as a plain View, so branch explicitly.
  return (
    <BlurView intensity={40} tint="dark" style={[styles.panel, style]} {...rest}>
      {children}
    </BlurView>
  );
}

// Multiple glass surfaces that should merge into one effect:
export function GlassToolbar() {
  if (!LIQUID) return <View style={styles.row} />;
  return (
    <GlassContainer spacing={12} style={styles.row}>
      <GlassView style={styles.pill} glassEffectStyle="clear" />
      <GlassView style={styles.pill} glassEffectStyle="clear" />
    </GlassContainer>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 24, overflow: 'hidden', padding: 16 },
  row: { flexDirection: 'row' },
  pill: { width: 56, height: 56, borderRadius: 28 },
});

// GOTCHA: opacity:0 on a GlassView or ANY parent kills the effect entirely.
// Animate with glassEffectStyle={{ style, animate, animationDuration }} instead.
```

### lib/sfx.ts — expo-audio: preload short SFX, play, and respect the iOS silent switch

```ts
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';

const SOURCES = {
  pop: require('../assets/sfx/pop.mp3'),
  win: require('../assets/sfx/win.mp3'),
} as const;

type SfxName = keyof typeof SOURCES;

const players = new Map<SfxName, AudioPlayer>();

/** Call once, e.g. from the root layout on mount. */
export async function initSfx() {
  await setAudioModeAsync({
    // DEFAULT IS true. Set false so the iOS hardware mute switch silences the app.
    playsInSilentMode: false,
    // 'mixWithOthers' = never steal focus from the user's music. Right choice for SFX.
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
  });

  for (const name of Object.keys(SOURCES) as SfxName[]) {
    const player = createAudioPlayer(SOURCES[name], {
      updateInterval: 1000,      // we don't need fine-grained status for SFX
      downloadFirst: true,       // fully resolve the asset before first play
      keepAudioSessionActive: true, // don't tear the session down between blips
    });
    player.volume = 0.7;
    players.set(name, player);
  }
}

/** Fire-and-forget. Safe to call rapidly. */
export function playSfx(name: SfxName) {
  const player = players.get(name);
  if (!player?.isLoaded) return;
  void player.seekTo(0);
  player.play();
}

/** createAudioPlayer instances are manually managed — release them. */
export function disposeSfx() {
  for (const player of players.values()) player.remove();
  players.clear();
}
```

### Hook form of expo-audio (component-scoped, auto-released)

```tsx
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, Text } from 'react-native';

export function PopButton() {
  const player = useAudioPlayer(require('../assets/sfx/pop.mp3'), {
    downloadFirst: true,
    keepAudioSessionActive: true,
  });
  const status = useAudioPlayerStatus(player); // { playing, currentTime, duration, ... }

  return (
    <Pressable
      onPress={() => {
        void player.seekTo(0);
        player.play();
      }}>
      <Text>{status.playing ? '♪' : 'tap'}</Text>
    </Pressable>
  );
}
```

### Verification commands — what to run in CI and locally

```bash
# 1. Project health: app config, package.json, dependency/SDK compatibility,
#    React Native Directory validation, native dir sync.
npx expo-doctor

# 2. Enforce exact SDK 57 pins from expo's bundledNativeModules.json.
#    --check exits non-zero in CI; --fix rewrites versions.
npx expo install --check
npx expo install --fix

# 3. Metro bundle verification. NO Xcode required — pure JS/asset bundling.
#    Produces dist/ (_expo/static/js/ios/*.hbc + assets + metadata.json).
#    Verifies: module resolution, TS/Babel transform, Metro config, asset refs.
#    Does NOT verify: whether a native module actually exists inside Expo Go.
npx expo export --platform ios --output-dir dist --clear

# 4. The only real Expo Go compatibility test: open it in Expo Go 57.0.9.
npx expo start

# 5. Scaffold reference (installs expo ~57.0.23 today)
npx create-expo-app@latest my-app
```


## リスク

- EXPO GO SDK CLIFF (highest risk): Expo Go supports exactly one SDK. The App Store build is 57.0.9 today, but SDK 58 beta started 2026-09-15 with a 3–4 week beta, and Expo has stated the store Expo Go will move to SDK 58 shortly after stable. Expect the App Store Expo Go to stop opening SDK 57 projects around mid/late October 2026. Budget an SDK 58 upgrade sprint now, and keep `eas go` (build your own Expo Go via TestFlight, requires an Apple Developer account) as the escape hatch for pinning an SDK.
- VERSION PINS ARE NATIVE ABI CONTRACTS. Because Expo Go ships prebuilt native code, packages like @shopify/react-native-skia (2.6.2), react-native-svg (15.15.4), react-native-webview (13.16.1), react-native-screens (~4.26.0), react-native-reanimated (4.5.1) and react-native-worklets (0.10.1) must be EXACTLY the SDK 57 versions. A stray `pnpm add @shopify/react-native-skia@latest` will produce a JS/native mismatch that manifests as a cryptic runtime crash, not a build error. Add `npx expo install --check` to CI.
- react-native-view-shot version skew: `npx expo install` resolves 5.1.0 (from expo@57's bundledNativeModules.json) but apps/expo-go/package.json on the sdk-57 branch pins 4.0.3, so the Expo Go binary may contain 4.0.3's native code. view-shot 5.x peers accept RN >= 0.76 so the bridge should still bind, but prove captureRef() on a physical device in week one before designing any share-image feature around it.
- expo-glass-effect is cosmetic-only and iOS 26+ only. On Android, web and iOS < 26 it renders as a plain transparent View with NO error and NO visual effect. Never encode game state or affordance purely in glass. Branch on isLiquidGlassAvailable() && isGlassEffectAPIAvailable() and fall back to expo-blur's BlurView. Separately: opacity:0 on a GlassView or any ancestor kills the effect entirely — animate via glassEffectStyle={{ style, animate, animationDuration }}.
- expo-notifications in Expo Go: remote/push notifications are unavailable on Android since SDK 53 and are not usable for production on iOS Expo Go. Only LOCAL notifications work. If the game needs push (daily puzzle reminders), that feature cannot be validated in Expo Go at all and forces a development build — which conflicts with the project's Expo Go constraint.
- expo-updates is flagged 'Included in Expo Go' but 'most of the Updates API is unavailable when running in Expo Go'. Do not write any runtime code that depends on Updates.checkForUpdateAsync / fetchUpdateAsync while Expo Go is the only target; it will no-op or throw.
- New Architecture is MANDATORY on SDK 55+ and cannot be disabled — do not add `newArchEnabled: false` to app.json expecting it to work; it is silently ignored. Any library that is not New-Arch/Fabric-ready simply cannot be used. This is why Reanimated 4 (not 3) and Skia 2.x are the required lines.
- react-native-reanimated 4.5.1 REQUIRES react-native-worklets 0.10.1 as a direct dependency; omitting it breaks worklets at runtime. babel-preset-expo@57 auto-injects react-native-worklets/plugin only when the package resolves — so if you hand-write a babel.config.js that doesn't extend babel-preset-expo, or you hoist worklets somewhere pnpm can't resolve from the app, animations silently fail on the UI thread.
- pnpm workspaces + Expo: strict node_modules layout frequently breaks Expo autolinking and Metro resolution. The mobile app must have every Expo Go package as a direct dependency of apps/mobile (never only hoisted at the root), and you likely need `node-linker=hoisted` in .npmrc. This repo is a pnpm/Turborepo monorepo, so this will bite.
- `npx expo export --platform ios` proves nothing about Expo Go compatibility. It is Metro-only: it validates module resolution, TypeScript/Babel transform and asset references. A package that is NOT in Expo Go will export cleanly and then throw 'Cannot find native module ...' at runtime on device. The only real gate is opening the app in Expo Go 57.0.9.
- `import { Tabs } from 'expo-router'` is deprecated in expo-router 57 (use 'expo-router/js-tabs'), and the NativeTabs import path changes from 'expo-router/unstable-native-tabs' to 'expo-router/native-tabs' in SDK 58. Isolate tab layout behind one component file (like the official template's src/components/app-tabs.tsx) so the upgrade is a one-line change.
- expo-file-system's main entry is now the File/Directory/Paths class API; the old FileSystem.* functions throw at runtime unless imported from 'expo-file-system/legacy'. Any code or AI-generated snippet written against pre-SDK-54 docs will compile and then blow up.
- The SDK 57 default template enables `experiments.reactCompiler: true`. The React Compiler is still experimental and can surface as bizarre memoization/stale-closure bugs. If you hit unexplainable render behaviour, flip it off first before debugging your own code.
- Expo Go 57.0.9 requires iOS 16.4 minimum — anyone testing on an older device cannot install it at all.
- expo-audio's playsInSilentMode defaults to TRUE. If you don't explicitly call setAudioModeAsync({ playsInSilentMode: false }), the game will blare sound effects on a phone the user has muted — an App Store review and user-trust problem. Also prefer interruptionMode: 'mixWithOthers' so you never pause the user's music.

## 結論

Build on Expo SDK 57, pinned to `expo@~57.0.23` (require >= 57.0.17 for the RN 0.86.3 Hermes memory fix), React Native 0.86.3, React 19.2.3. Scaffold with `npx create-expo-app@latest` and keep the generated `app.json`/`tsconfig.json` shape: no `newArchEnabled` (ignored — New Arch is mandatory and always on), no `runtimeVersion` until you start doing EAS builds. Target Expo Go 57.0.9 from the App Store (released 2026-09-02, iOS 16.4+).

Every package on the list is usable in Expo Go — nothing has to be cut, including `@shopify/react-native-skia@2.6.2` and `react-native-view-shot@5.1.0`, both of which are compiled into the Expo Go binary and confirmed on Expo's own third-party-in-Expo-Go list. That means the visually ambitious parts of a word2vec mixing game are on the table: Skia for the semantic-space canvas / particle and gradient work, Reanimated 4.5.1 + gesture-handler 2.32.0 for the drag-to-mix interaction, and view-shot 5.1.0 + expo-sharing for share cards. Three packages come with asterisks rather than exclusions: `expo-notifications` (local only — remote push is dead in Expo Go), `expo-updates` (listed as included but its API is inert in Expo Go — don't code against it), and `expo-glass-effect` (iOS 26+ only, silently degrading to a plain View everywhere else).

Copy the pinned dependency block above verbatim and never install a mobile dependency without `npx expo install` — the Expo Go binary is a fixed native ABI, so an off-version Skia or SVG is a runtime crash, not a build error. Wire `npx expo-doctor` and `npx expo install --check` into the Turborepo `lint`/CI pipeline alongside the existing `pnpm typecheck`. Use `npx expo export --platform ios` as a cheap bundling smoke test (no Xcode needed) but understand it cannot detect "not in Expo Go" — the only real gate is launching on a device.

For navigation, use `NativeTabs` from `expo-router/unstable-native-tabs` (this is what the official SDK 57 template itself does) and isolate it in a single `components/app-tabs.tsx` so the SDK 58 rename to `expo-router/native-tabs` is one line. Avoid `import { Tabs } from 'expo-router'` — it's deprecated; the JS fallback lives at `expo-router/js-tabs`.

For audio, call `setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })` once at startup and preload every SFX with `createAudioPlayer(..., { downloadFirst: true, keepAudioSessionActive: true })`. The default `playsInSilentMode: true` would make the game play sound on a muted phone.

Treat `expo-glass-effect` as pure garnish behind an `isLiquidGlassAvailable() && isGlassEffectAPIAvailable()` guard with an `expo-blur` fallback — never let the Android build lose information because glass didn't render.

Finally, plan the SDK 58 upgrade now, not later. SDK 58 beta opened 2026-09-15 on RN 0.88 RC with a 3–4 week beta, and Expo has said the store Expo Go moves to SDK 58 shortly after stable. Roughly a month from today, App Store Expo Go will stop opening SDK 57 projects. Put "SDK 58 upgrade" on the roadmap as a hard-dated item in docs/PROGRESS.md, keep dependencies un-forked so `npx expo install --fix` can do most of the lift, and register an `eas go` custom Expo Go build as the contingency if the upgrade slips.
