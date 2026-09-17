# デザインシステム刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「しょぼい」の実体（絵文字・中途半端なガラス・余白とヒエラルキーの不足）を潰し、iOS 純正アプリと並べても違和感のない土台にする。

**Architecture:** 土台は静かに、演出だけ派手に。`SymbolIcon`（SF Symbols）と `GlassButton`（Liquid Glass）の 2 部品を新設し、既存画面をそれで置き換える。トークン（余白・タイポ）を Apple のメトリクスに合わせる。ロジック層とハプティクスとタブバーには触らない。

**Tech Stack:** Expo SDK 57, expo-symbols, expo-glass-effect, expo-blur, React Native 0.86, Reanimated 4

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §4

## Global Constraints

- Expo Go で動くこと。Expo Go 非同梱のネイティブモジュールを追加しない
  （`expo-symbols` / `expo-glass-effect` / `expo-blur` は**既に依存に入っている**）
- **既に良い評価を得ているものを壊さない**: ハプティクス、Liquid Glass のタブバー（`(tabs)/_layout.tsx`）、実装ロジック
- トーンは「**静かな土台＋演出で爆発**」。通常の画面は落ち着かせ、混合とクリアだけ派手にする
- `GlassView` の `opacity: 0` は描画されない。フェードは**親レイヤー**で行うこと
- iOS 26 未満 / Android / Web では必ずフォールバックが出ること
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること

---

### Task 1: `SymbolIcon` を作り、絵文字を追放する

実績アイコンは最初から SF Symbols 名（`sparkle` / `crown` / `flame.fill` …）で定義されており
（`packages/contracts/src/achievements.ts`）、`expo-symbols` も依存に入っている。
**絵文字にフォールバックしていただけ**なので、描画する部品を用意して差し替える。

**Files:**
- Create: `apps/mobile/src/components/SymbolIcon.tsx`
- Modify: `apps/mobile/src/components/index.ts`
- Modify: 絵文字を使っている各画面（Step 4 で洗い出す）

**Interfaces:**
- Consumes: `expo-symbols` の `SymbolView`
- Produces:
  - `SymbolIcon({ name, size, color, weight }): JSX.Element`
    — `name` は SF Symbols 名。iOS では `SymbolView`、それ以外はフォールバック

- [ ] **Step 1: フォールバックの方針を決めて実装する**

`SymbolIcon` の要件:

- iOS: `expo-symbols` の `SymbolView` で描画する
- iOS 以外（Android / Web）: `SymbolView` は使えないので、**Skia か SVG パスで描いた最小の代替**に落とす。
  代替を持たない名前が来たら、その場で気づけるよう **開発ビルドでは警告を出し、本番では無害な点を描く**
  （絵文字にフォールバックしないこと。それが今回潰している問題そのもの）
- `size` / `color` / `weight` は必須ではなく既定値を持つ。既定値は `theme/tokens.ts` に置く

**展示で使う名前は限られている**ので、代替は総当たりで用意せず
「実際に使う名前の集合」を定数として持ち、そこに対してだけ代替を用意する。

- [ ] **Step 2: 使用するシンボル名を一覧にする**

Run: `grep -rn "icon:" packages/contracts/src/achievements.ts`
実績 12 個のアイコン名と、画面で新たに使う名前（メニューの `ellipsis.circle`、
ヒントの `lightbulb`、ギブアップの `flag`、共有の `square.and.arrow.up` など）を
`apps/mobile/src/components/constants.ts` に**定数として**まとめる。

- [ ] **Step 3: 実績表示を `SymbolIcon` に差し替える**

`apps/mobile/src/app/(tabs)/play/result/[id].tsx` の実績表示が
`achievement.icon` を文字として出しているなら、`SymbolIcon` に置き換える。

- [ ] **Step 4: 残っている絵文字を洗い出して潰す**

Run:
```bash
grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" apps/mobile/src --include="*.tsx" --include="*.ts" | grep -v "^\S*: *\*"
```
見つかったものを `SymbolIcon` に置き換える。

**例外（残すもの）**: `apps/mobile/src/features/game/result.ts` の `⬜🟩🟦🟨`。
これは X に貼るシェアテキストの一部で、SF Symbols では代替できず、
絵文字であること自体が機能している。**このファイルは触らないこと。**

- [ ] **Step 5: Web プレビューで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
Expected: アイコンが崩れず、絵文字が出ない。コンソールに警告が出ていないこと

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): SF Symbols のアイコン部品を入れて絵文字を追放する"
```

---

### Task 2: `GlassButton` を作り、ガラスを統一する

`PrimaryButton` は「`GlassView` の `opacity: 0` が描画されない」問題を避けるため
**意図的にガラスを使っていない**（`components/PrimaryButton.tsx` の冒頭コメント）。
これが「中途半端に普通のボタン」の正体。

**Files:**
- Create: `apps/mobile/src/components/GlassButton.tsx`
- Modify: `apps/mobile/src/components/PrimaryButton.tsx`（内部で `GlassButton` を使うか、置き換える）
- Modify: `apps/mobile/src/components/index.ts`

**Interfaces:**
- Consumes: `expo-glass-effect` の `GlassView` / `isLiquidGlassAvailable`、既存の `canUseLiquidGlass()`
- Produces:
  - `GlassButton(props: PrimaryButtonProps): JSX.Element` — `PrimaryButton` と同じ props を取る

- [ ] **Step 1: `GlassButton` を実装する**

要件:

- `canUseLiquidGlass()` が true なら `GlassView` を地にする
- **フェード（disabled / loading）は `GlassView` の opacity ではなく、
  ラップしている `Animated.View` の opacity で行う**（既知の問題の回避）
- 押し込みは既存 `PrimaryButton` と同じ Reanimated のスケール
  （`BUTTON_PRESSED_SCALE` を再利用。新しい定数を作らない）
- `variant` は既存の `primary` / `secondary` / `ghost` を踏襲する。
  `primary` はガラスの上に tier の accent を乗せてコントラストを確保する
  （ガラスの上に薄い文字を置くと屋外照明の会場で読めない）
- フォールバック時は現行の見た目を維持する

- [ ] **Step 2: タップ領域を Apple の基準に合わせる**

すべてのボタンの最小タップ領域を **44pt** にする。
`components/constants.ts` に `MIN_TAP_SIZE = 44` を置き、`layout` トークン経由で使う。

- [ ] **Step 3: 主要な操作面をガラスに揃える**

置き換える対象:
- 混合ボタン（`play/game/[id].tsx`）
- ロビーのカード／「はじめる」（`play/index.tsx`）
- 結果画面のアクション（`play/result/[id].tsx`）
- ヒントシート（`components/HintSheet.tsx`）
- 設定画面の行（`settings/index.tsx`）

**タブバー（`(tabs)/_layout.tsx`）には触らない。** 既に良い評価を得ている。

- [ ] **Step 4: フォールバックを確認する**

`canUseLiquidGlass()` を一時的に `false` を返すよう書き換えて全画面を見る。
Expected: `BlurView` のフォールバックで破綻せず、文字が読めること。
**確認したら書き換えを必ず戻すこと。**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): ガラスのボタンを入れて主要な操作面を統一する"
```

---

### Task 3: 余白とタイポグラフィを Apple のメトリクスに寄せる

「しょぼい」の残りの実体は余白とヒエラルキーの不足である。

> **Task 5（ライト/ダーク両対応）と同じファイルを触る。**
> 色の持ち方を変えてから余白・タイポを詰めるほうが手戻りがないので、
> **Task 5 を先に終わらせてから、この Task 3 に着手すること。**

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts`
- Modify: 各画面（適用）

**Interfaces:**
- Consumes: なし
- Produces: `typography` / `spacing` / `layout` の値が更新される。**キー名は変えない**
  （画面側の参照を壊さないため）

- [ ] **Step 1: 現状のトークンを読む**

Run: `sed -n '1,200p' apps/mobile/src/theme/tokens.ts`
既存のキー構成を把握する。**キーの追加は可、リネームは不可。**

- [ ] **Step 2: タイポグラフィを整える**

- 画面タイトルは iOS の Large Title 相当（34pt / bold）を基準にする
- 本文 17pt、補足 15pt、ラベル 13pt を基準にし、行間を本文で 1.3 前後にする
- 日本語なので**字面が詰まって見えやすい**。`letterSpacing` は 0 か僅かに正にする（負にしない）
- ゲーム画面の語の表示（`WordDisplay`）だけは例外的に大きく、主役として扱う

- [ ] **Step 3: 余白を整える**

- 画面の左右余白を 16〜20pt に統一する
- セクション間は 24〜32pt を基準にし、**関連する要素同士は近く、違う塊は遠く**なるようにする
- セーフエリアの扱いを全画面で揃える（`useSafeAreaInsets` の足し方が画面ごとに違わないこと）

- [ ] **Step 4: 全画面を Web プレビューで見比べる**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
ロビー / ゲーム / 結果 / 図鑑 / ランキング / 設定を順に開く。
Expected: どの画面も「主役が 1 つ」に見えること。要素が等間隔に並んでいる画面は失敗

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/src/app apps/mobile/src/components
git commit -m "refactor(mobile): 余白とタイポグラフィを iOS のメトリクスに揃える"
```

---

### Task 4: ロゴを入れる

**アセットは入手済み。** `apps/mobile/assets/images/` に 2 種類ある:

| ファイル | 中身 | 使う場面 |
| --- | --- | --- |
| `logo-black.png` | 黒のワードマーク（2714×1060、透過） | **ライトモード**の明るい地の上 |
| `logo-white.png` | 白のワードマーク（同寸、透過） | **ダークモード**と、図鑑のような暗い地の上 |

意匠は「蓋の開いた鍋＋キラキラ」＋「コトコトバ」の文字。**横長（縦横比およそ 2.56:1）**なので、
正方形の枠に入れると余白だらけになる。高さを指定して幅を追従させること。

将来 "Next" を足したロゴに差し替わる予定。**同じファイル名で上書きすれば差し替わる**構造にする。

**Files:**
- Create: `apps/mobile/src/components/Logo.tsx`
- Modify: `apps/mobile/src/components/index.ts`
- Modify: `apps/mobile/src/app/(tabs)/play/index.tsx`（ロビーに置く）
- Test: `apps/mobile/tests/logo.test.ts`

**Interfaces:**
- Consumes: `useTheme()`（Task 5）、`expo-image`
- Produces:
  - `Logo({ height, variant }): JSX.Element`
    — `height` は必須。`variant` は `'auto' | 'light' | 'dark'`（既定 `'auto'`）
  - `LOGO_ASPECT_RATIO: number`（`components/constants.ts`）

- [ ] **Step 1: 実寸を確認して定数にする**

Run: `cd apps/mobile && node -e "const b=require('fs').readFileSync('assets/images/logo-black.png');console.log(b.readUInt32BE(16), b.readUInt32BE(20))"`
Expected: 幅と高さが出る。その比を `LOGO_ASPECT_RATIO` として
`apps/mobile/src/components/constants.ts` に置く（マジックナンバー禁止）。

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { LOGO_ASPECT_RATIO } from '../src/components/constants'

describe('ロゴ', () => {
  // 正方形の枠に入れると余白だらけになる。横長であることを固定しておく。
  it('横長の比率である', () => {
    expect(LOGO_ASPECT_RATIO).toBeGreaterThan(2)
  })

  it('実ファイルの比率と一致する', () => {
    const { readFileSync } = require('node:fs')
    const buf = readFileSync(`${__dirname}/../assets/images/logo-black.png`)
    // PNG の IHDR は 16 バイト目から幅、20 バイト目から高さ
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    expect(LOGO_ASPECT_RATIO).toBeCloseTo(width / height, 2)
  })

  it('白と黒の 2 種類が同じ寸法である', () => {
    const { readFileSync } = require('node:fs')
    const dims = (name: string) => {
      const buf = readFileSync(`${__dirname}/../assets/images/${name}`)
      return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    }
    expect(dims('logo-black.png')).toEqual(dims('logo-white.png'))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/mobile test logo`
Expected: FAIL（`LOGO_ASPECT_RATIO` が無い）

- [ ] **Step 4: `Logo` を実装する**

- `expo-image` で描く。`height` から `LOGO_ASPECT_RATIO` で幅を出す
- `variant === 'auto'` のときは `useTheme().scheme` を見て、
  **ライトなら `logo-black.png`、ダークなら `logo-white.png`** を選ぶ
- 図鑑のように地が常に暗い場所では `variant="dark"` を明示して白ロゴを強制できるようにする
- `accessibilityLabel` に「コトコトバ」を入れる（読み上げでファイル名が読まれないように）

`require()` は Metro が静的に解決するので、**変数でパスを組み立てないこと**。
2 つの `require` を定数として持ち、スキームで選ぶ。

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/mobile test logo && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: ロビーに置く**

`play/index.tsx` のヘッダに `Logo` を置く。
**ロゴを出すならタイトル文字（「コトコトバ」）は出さない**（同じ情報を二重に出さない）。

- [ ] **Step 7: 両スキームで確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
開発者ツールで `prefers-color-scheme` を切り替える。
Expected: ライトで黒ロゴ、ダークで白ロゴが出て、**どちらでも地に埋もれない**こと

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src apps/mobile/tests
git commit -m "feat(mobile): コトコトバのロゴをスキームに追従して表示する"
```

---

### Task 5: ライトモード / ダークモードの両対応

**この Task を Task 3 より先に行う。** 色の持ち方を変えてから余白・タイポを詰めるほうが手戻りがない。

現状はダーク固定（`app.json` の `userInterfaceStyle: "dark"`、`palette.base = '#0B0B10'`）。

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts`
- Modify: `apps/mobile/src/theme/tiers.ts`
- Modify: `apps/mobile/src/theme/color.ts`（`contrastRatio` を追加）
- Create: `apps/mobile/src/theme/scheme.tsx`
- Modify: `apps/mobile/src/theme/index.ts`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Test: `apps/mobile/tests/theme.test.ts`

**Interfaces:**
- Consumes: React Native の `useColorScheme()`
- Produces:
  - `ThemeProvider({ children }): JSX.Element`
  - `useTheme(): { scheme: 'light' | 'dark'; palette: Palette; paletteForTier(tier: TierId): TierPalette }`
  - `PALETTES: Record<'light' | 'dark', Palette>`
  - `TIER_PALETTES: Record<'light' | 'dark', Record<TierId, TierPalette>>`
  - `contrastRatio(foreground: string, background: string): number`（`theme/color.ts`）
  - `Palette` は**役割名**のキーを持つ:
    `base` / `surface` / `text` / `sub` / `border` / `accent` / `pressed` / `glassTint`

- [ ] **Step 1: Write the failing test**

`apps/mobile/tests/theme.test.ts`:

```ts
import { TIER_ORDER } from '@coto2ba/contracts'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../src/theme/color'
import { PALETTES, TIER_PALETTES } from '../src/theme/tokens'

const ROLES = ['base', 'surface', 'text', 'sub', 'border', 'accent', 'pressed', 'glassTint'] as const
const SCHEMES = ['light', 'dark'] as const

describe('パレット', () => {
  it('light と dark の両方がある', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['dark', 'light'])
  })

  // 片方にしか無い役割があると、その画面だけスキーム切替で破綻する。
  it('どちらのスキームも同じ役割を全部持つ', () => {
    for (const scheme of SCHEMES) {
      for (const role of ROLES) expect(PALETTES[scheme]).toHaveProperty(role)
    }
  })

  it('tier ごとに両スキームのパレットがある', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_ORDER) expect(TIER_PALETTES[scheme]).toHaveProperty(tier)
    }
  })

  // 会場は照明が明るい。コントラストが足りないと屋外光で読めない。
  it('本文と背景のコントラスト比が 4.5 以上ある', () => {
    for (const scheme of SCHEMES) {
      expect(contrastRatio(PALETTES[scheme].text, PALETTES[scheme].base)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('補足文字と背景のコントラスト比が 3 以上ある', () => {
    for (const scheme of SCHEMES) {
      expect(contrastRatio(PALETTES[scheme].sub, PALETTES[scheme].base)).toBeGreaterThanOrEqual(3)
    }
  })

  it('tier ごとの本文も読める', () => {
    for (const scheme of SCHEMES) {
      for (const tier of TIER_ORDER) {
        const p = TIER_PALETTES[scheme][tier]
        expect(contrastRatio(p.text, p.bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('contrastRatio', () => {
  it('白と黒は 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })

  it('同じ色は 1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })
})
```

`TierPalette` のキー名（`bg` / `text` / `sub` / `accent` / `surface` / `glassTint`）は
**既存の `theme/tiers.ts` の定義に合わせること**。上のテストの `p.bg` は
既存のキー名に読み替えて書く。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/mobile test theme`
Expected: FAIL（`PALETTES` が無い）

- [ ] **Step 3: `contrastRatio` を実装する**

`theme/color.ts` に WCAG の相対輝度で実装する。既存の色パース（`Rgba` 変換）を再利用する。

```ts
/** WCAG 2.1 の相対輝度。 */
function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * 前景と背景のコントラスト比（1〜21）。
 * 会場は照明が明るいので、読めるかどうかをテストで担保するために使う。
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseColor(foreground))
  const b = relativeLuminance(parseColor(background))
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
```

`parseColor` は既存の関数名に合わせること。

- [ ] **Step 4: トークンを役割名で再構成する**

- `PALETTES: Record<'light' | 'dark', Palette>` を作る。
  **dark は現行の値をそのまま移す**（既に評価されている見た目を変えない）
- light は新規に設計する。背景は純白にせず僅かに暖色を含んだ白、
  文字は純黒にしない（日本語の細い字画が潰れるため）
- `TIER_PALETTES` を両スキーム分作る。**tier は単純反転しない。**
  mono → 暖色 → 宇宙 → 黄金 という温度の物語をライトでも成立させる
  （宇宙はライトでも暗い面として残し、周囲を明るくする）

- [ ] **Step 5: プロバイダとフックを作る**

`theme/scheme.tsx` に `ThemeProvider` と `useTheme` を置く。
`useColorScheme()` を購読し、`null` のときは `'dark'` にフォールバックする。

既存の `palette` / `paletteForTier` の直接 export は**互換シムとして残す**
（ダーク固定の値を返す）。新規コードはフック経由にし、段階的に移す。

- [ ] **Step 6: `_layout.tsx` と `app.json` を直す**

- `app.json` の `"userInterfaceStyle": "dark"` を `"automatic"` にする
- `expo-splash-screen` の `backgroundColor` と `primaryColor` はダーク前提なので、
  ライトでも破綻しないか確認する（スプラッシュは両スキームの指定ができる）
- `_layout.tsx` を `ThemeProvider` で包む
- `expo-status-bar` の `style` をスキームに追従させる

- [ ] **Step 7: 全画面をフック経由に移す**

Run: `grep -rn "paletteForTier\|palette\." apps/mobile/src --include="*.tsx" | grep -v "theme/" | wc -l`
件数を把握してから移す。

**図鑑（`(tabs)/space/`）は意図的な例外**としてダーク固定を維持してよい（宇宙なので）。
その旨をコードのコメントに残すこと。

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/mobile test && pnpm typecheck`
Expected: PASS

- [ ] **Step 9: 両スキームで全画面を見る**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
開発者ツールで `prefers-color-scheme` を切り替え、
ロビー / ゲーム / 結果 / 図鑑 / ランキング / 設定 を両方で見る。
Expected: どちらでも文字が読め、ガラスが破綻しないこと

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/app.json apps/mobile/src/app/_layout.tsx apps/mobile/tests
git commit -m "feat(mobile): ライトモードとダークモードの両対応"
```

---

### Task 6: ブランドアセット（スプラッシュ / アイコン / ランディング）

展示で**最初に目に入る場所**が Expo テンプレートのまま残っている。

| 場所 | 現状 | 問題 |
| --- | --- | --- |
| `assets/images/splash-icon.png` | 228×213 のほぼ空白 | **QR を読んで開いた瞬間に出る画面**がテンプレート |
| `assets/images/icon.png` | Expo テンプレートの 1024×1024 | 持ち帰った人のホーム画面に残る |
| `assets/images/favicon.png` | 48×48 テンプレート | Web 版のタブ |
| `apps/landing/index.html` の OG 画像 / favicon | 生成した仮の意匠（点 2 つと線） | 共有時に本物のロゴが出ない |

**Files:**
- Create: `tools/pipeline/scripts/13_brand_assets.py`
- Modify: `package.json`（`pipeline:brand`）
- Create/Replace: `apps/mobile/assets/images/{splash-icon,icon,favicon}.png`
- Create: `apps/mobile/assets/images/logo-mark-{black,white}.png`（鍋のマークだけを切り出したもの）
- Modify: `apps/mobile/app.json`
- Modify: `apps/landing/index.html`
- Test: `tools/pipeline/tests/test_brand_assets.py`

**Interfaces:**
- Consumes: `apps/mobile/assets/images/logo-{black,white}.png`（2714×1060）
- Produces: 上記の画像一式

- [ ] **Step 1: マークの切り出し範囲を決める**

ロゴの左側が「蓋の開いた鍋＋キラキラ」のマーク、右側が「コトコトバ」の文字。
**マークだけを切り出す**と正方形に近いアイコンが作れる。

Run: `cd apps/mobile/assets/images && python3 -c "
from PIL import Image
im = Image.open('logo-black.png')
print(im.size, im.mode)
"`

透過 PNG なのでアルファチャンネルを見て、**文字が始まる直前の縦の空白列**を自動検出する。
座標を目で決め打ちしないこと（ロゴが差し替わったときに壊れるため）。
検出した境界の左側をマークとして切り出し、**正方形の余白を足して**アイコンにする。

- [ ] **Step 2: Write the failing test**

`tools/pipeline/tests/test_brand_assets.py`:

```python
from PIL import Image

from scripts import brand_assets


def test_finds_gap_between_mark_and_text(tmp_path):
    """マークと文字の間の空白列を見つけられること。決め打ち座標にしない。"""
    im = Image.open(brand_assets.LOGO_BLACK)
    split = brand_assets.find_mark_boundary(im)
    # マークは左側の一部。画像の半分より左で切れるはず。
    assert 0 < split < im.width // 2


def test_mark_is_square_with_padding(tmp_path):
    out = tmp_path / "mark.png"
    brand_assets.write_mark(brand_assets.LOGO_BLACK, out, size=1024)
    with Image.open(out) as im:
        assert im.size == (1024, 1024)
        assert im.mode == "RGBA"


def test_mark_is_not_blank(tmp_path):
    """切り出しに失敗して空白画像が出ると、気づかないまま展示に出る。"""
    out = tmp_path / "mark.png"
    brand_assets.write_mark(brand_assets.LOGO_BLACK, out, size=256)
    with Image.open(out) as im:
        alpha = im.getchannel("A")
        # 不透明なピクセルが全体の 5% 以上ある
        opaque = sum(1 for v in alpha.getdata() if v > 0)
        assert opaque > 256 * 256 * 0.05


def test_icon_has_opaque_background(tmp_path):
    """iOS のアイコンは透過を許さない。地を敷くこと。"""
    out = tmp_path / "icon.png"
    brand_assets.write_app_icon(out, size=1024)
    with Image.open(out) as im:
        assert im.size == (1024, 1024)
        alpha = im.getchannel("A")
        assert min(alpha.getdata()) == 255
```

`Pillow` を `tools/pipeline` の依存に追加する（`uv add pillow`）。

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tools/pipeline && uv run pytest tests/test_brand_assets.py`
Expected: FAIL

- [ ] **Step 4: 実装する**

- `find_mark_boundary`: アルファチャンネルを列ごとに合計し、
  **最初の連続した空白列の帯**を見つけてその中央を返す
- `write_mark`: 境界より左を切り出し、余白をトリムしてから正方形の中央に配置する
- `write_app_icon`: マーク（白）を**テーマの地の色**（`#0B0B10`）の上に置いて 1024×1024 で書く。
  **アルファを残さない**（iOS のアイコンは透過を許さない）
- `write_splash`: マークを透過のまま書き出す（スプラッシュの地は `app.json` が指定する）
- `write_favicon`: 48×48 と、Web 用に 180×180 も出す

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tools/pipeline && uv run pytest tests/test_brand_assets.py && uv run ruff check .`
Expected: PASS

- [ ] **Step 6: 生成して `app.json` を直す**

Run: `pnpm pipeline:brand`

`app.json` の `expo-splash-screen` の `imageWidth` は現在 **96**（マークには小さすぎる）。
マークが視認できる大きさに上げる。`backgroundColor` はライト/ダークの両方を指定する
（Task 5 でスキーム対応を入れているので、スプラッシュだけダーク固定にしない）。

- [ ] **Step 7: ランディングの OG 画像とファビコンを本物にする**

`apps/landing/index.html` の OG 画像は SVG を base64 で埋め込んでいる。
テキストで「コトコトバ」と描いている部分を、**本物のロゴを埋め込んだ形**に差し替える。

ランディングは**外部 CDN に依存しない**方針なので、画像は base64 で埋め込むか
同ディレクトリに置く。ファイルサイズに注意する（OG 画像は 1MB を超えない）。

favicon も生成したマークに差し替える。

- [ ] **Step 8: 実機で確認する**

Expo Go で開き、**スプラッシュにマークが出ること**を確認する。
ランディングを開き、ファビコンと、OG 画像（Slack か X に貼って確認）を見る。

- [ ] **Step 9: Commit**

```bash
git add tools/pipeline apps/mobile/assets/images apps/mobile/app.json apps/landing/index.html package.json
git commit -m "feat: スプラッシュ・アイコン・OG 画像を本物のロゴから生成する"
```
