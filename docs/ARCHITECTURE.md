# 実装決定（調査に基づく確定事項）

> 2026-09-17。`docs/research/` の一次ソース調査と敵対的検証を踏まえた確定事項。
> **実装者はこのファイルを SPEC.md と一緒に必ず読むこと。** SPEC と食い違う箇所は
> ここが優先（理由を併記してある）。

## 0. バージョン確定値

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| Expo SDK | **57**（`expo@~57.0.23`） | App Store の Expo Go は **57.0.9**（2026-09-02 リリース、iTunes API で確認）。SDK 57 は Expo Go で動く |
| React Native / React | 0.86.3 / 19.2.3 | SDK 57 テンプレートの pin |
| New Architecture | **常時有効・無効化不可**（SDK 55 以降） | `newArchEnabled` は無視される |
| Reanimated | 4.5.1 + `react-native-worklets@0.10.1` | worklets は直接依存が必須。`babel-preset-expo@57` が plugin を自動注入するので babel.config.js は不要 |
| Skia | `@shopify/react-native-skia@2.6.2` | **Expo Go 同梱**（third-party overview で確認） |
| view-shot | `react-native-view-shot@5.1.0` | **Expo Go 同梱**。ただし Expo Go バイナリは 4.0.3 を抱えている可能性あり（version skew、実機で早めに検証） |
| Native Tabs | `expo-router/unstable-native-tabs` | SDK 57 はこのパス。SDK 58 で `expo-router/native-tabs` になる |
| `import { Tabs } from 'expo-router'` | **非推奨** | `expo-router/js-tabs` を使う |
| Better Auth | `better-auth@1.7.5` / `@better-auth/expo@1.7.5` | CLI は **`npx auth@1.7.5 generate`**。`@better-auth/cli` は 1.4.21 で止まっていて古いスキーマを吐く |
| Drizzle | `drizzle-orm@0.45.2` / `drizzle-kit@0.31.10` | 1.0.0-rc 系は使わない |
| Postgres driver | **`pg` + `drizzle-orm/node-postgres`** | postgres-js は named prepared statement を使うため Neon の PgBouncer(transaction mode) で断続的に壊れる（実測確認済み） |

### ⚠️ 期限リスク
**SDK 58 beta が 2026-09-15 に告知済み**（RN 0.88 RC、beta 3〜4 週間）。安定版が出ると
App Store の Expo Go は 58 に切り替わり、**SDK 57 のプロジェクトは Expo Go で開けなくなる**。
技育博が約1か月後なら、直前に SDK 58 への追従が必要になる可能性が高い。展示の 1 週間前に
Expo Go のバージョンを必ず確認すること。

## 1. 語彙（確定）

| 項目 | 値 |
| --- | --- |
| `N_INPUT` | **208,707**（freq_rank ≤ 300,000、日本語文字を含む、記号なし、NG 外） |
| `N_OUTPUT` | **102,520**（上記のうち freq_rank ≤ **180,000**、2文字以上、数字なし、品詞条件） |
| 一般名詞 | 67,304（ゴールプール候補） |

SPEC §4.2 からの変更（理由付き）:

1. **「単一トークン」条件を緩めた。** unidic-lite は `潤滑油`→`潤滑`+`油(接尾辞)`、
   `銀河系`→`銀河`+`系`、`伝統芸能`→`伝統`+`芸能` と分割する。単一トークン限定だと
   ゲームに最も向いた名詞複合語が全滅する。規則:
   - 単一トークン: 品詞 名詞/動詞/形容詞/形状詞、名詞は 数詞・代名詞を除く
   - 複数トークン: 全トークンが 名詞/接頭辞/接尾辞、名詞を1つ以上含み、
     末尾が 名詞 か 接尾辞-名詞的
2. **基本形判定は `feature.orthBase`**（`lemma` ではない）。`斬ら` の lemma は `切る`
   （語彙素）だが orthBase は `斬る`。lemma で比較すると活用断片を取りこぼす。
3. **未知語（`is_unk`）は出力語彙から除外。** 品詞情報が信用できない。
4. **出力語彙に `freq_rank ≤ 180,000` の上限を追加。** 180,000 以降は
   `曽野木 / 羽ノ浦 / 優弥 / 紫山` のような地名・人名の長い尾で、混合結果・ヒントの質を落とす。
   この上限が SPEC の「約10万語」という目標値に一致する。
5. 演出帯のしきい値（10 / 300 / 3,000）は **SPEC の値を維持**。
   参照実装は 10 / 999 / 9,999 だが SPEC が優先。

### ライセンス
- ベクトル本体（WikiEntVec jawiki 20190520）は **CC BY-SA 3.0**。派生データ公開時は継承。
- NG 語リスト: MosasoM/inappropriate-words-ja (MIT) + LDNOOBW ja (CC BY 4.0) + 手書き分。
  `tools/pipeline/vendor/NOTICE.md` に出典。**公開リストは網羅的ではない。展示前に人間のレビュー必須。**

## 2. 認証（確定）

**サーバー: Better Auth（`anonymous` + `bearer` + `expo` プラグイン、Drizzle pg アダプタ）。
クライアント: Bearer トークンのみ。Cookie を使わない。**

理由:
- Expo Go のオリジンは `exp://192.168.x.x:8081/--/` で DHCP 依存。安定しない。
- Better Auth は **Cookie ヘッダが無いリクエストではオリジン検証をスキップする**（実測確認）。
  Bearer 運用ならオリジン問題が構造的に発生しない。
- `@better-auth/expo` の SecureStore cookie jar には壊れ方の履歴が5系統ある（1.7.5 で修正済みだが
  失敗モードが常に「session が黙って null」で最悪）。Bearer なら自前の薄い保存で済む。

実装:
- `signIn.anonymous()` のレスポンスヘッダ `set-auth-token` を保存 → 以後 `Authorization: Bearer <token>`。
- **`signIn.anonymous()` は冪等ではない。** 既に匿名なら `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`
  を投げる。必ず `getSession()` で確認してから呼ぶ。
- `trustedOrigins`: `["coto2ba://", "exp+coto2ba://**", ...(ALLOW_EXPO_GO_ORIGINS === "1" ? ["exp://**"] : [])]`。
  **`exp://*` は誤り**（ワイルドカードが `/` を跨げず `exp://192.168.1.23:8081/--/` に 403）。
  **`NODE_ENV` で分岐しない**（Vercel は常に production）。専用の環境変数で分岐する。
- `rateLimit: { storage: "database" }`（既定のメモリ内は Vercel でインスタンス跨ぎに無意味、偽 429 の原因）。
- スキーマは手書きせず `npx auth@1.7.5 generate` で生成する。
- 追加フィールドは `user: { additionalFields: { display_name: { input: true }, best_free_moves: { input: false }, booth: { input: false } } }`。
  **`fieldName` は指定しない**（CLI が自動で snake_case にする。指定すると TS のプロパティ名まで snake_case になる）。
- ブースモード「次の人へ」は新しい匿名ユーザーを作って token を差し替えるだけ。

## 3. ベクトル演算（確定）

- **halfvec は drizzle-orm 0.45.2 にネイティブ対応**（`halfvec({ dimensions: 200 })`）。
- ベクトルは **Python 側で単位長に正規化して格納**する。`1 - (v <=> goal)` がそのまま類似度になる。
  混合は生ベクトル空間で行うが、コサインなので正規化済みでも線形補間の方向は保たれる。
- **最近傍は HNSW インデックス。ランクは厳密な全走査（seq scan）。**
  HNSW は近似なので、同じ盤面で rank が揺れてスコアが再現しなくなる（実測: 厳密9に対し近似7）。
- **混合ベクトルは CTE の結合ではなくスカラー副問い合わせで書く。**
  `WITH mixed AS (...) ... FROM vocab v, mixed ORDER BY v.w2v <=> mixed.v` と書くと
  Postgres は値を定数と見なせず **HNSW を使わず 100,853 行の全ソートに落ちる**（実測 220ms）。
  `ORDER BY v.w2v <=> ((SELECT ...) * ... + (SELECT ...) * ...)` と書くと InitPlan として
  定数化され HNSW が効く（実測 0.7ms）。**EXPLAIN で `Index Scan using vocab_output_hnsw`
  が出ることを必ず確認すること。**
- **1 手の処理は games 行を `FOR UPDATE` でロックしたトランザクションの中で行う。**
  ロック無しだと同時リクエストが同じ move_count を読んで同じ seq を insert し、
  `moves` の一意制約違反で 500 になる（負荷試験で 642 件発生）。
- **1手の処理を 1 本の SQL（CTE）に畳む。** 元の調査（research/drizzle-pgvector.md）は
  「**日本から** 70〜90ms」「**関数が Neon と同居していなければ** 4〜5往復で 300〜450ms」と
  書いており、**この 2 つの但し書きがここで落ちて**「Vercel↔Neon の RTT が 70〜90ms」と
  誤って伝わっていた（2026-09-18 に訂正）。
  **実測: sin1 の関数 ↔ sin1 の Neon は 1 往復 2〜5ms。** 日本→sin1 の床が 148〜161ms で、
  こちらは光の速度なので動かせない。
  それでも往復を畳む判断自体は正しい（往復数が多いほど分散が増え、tail が伸びるため）。
  **数字を引用するときは必ず「どこからどこへの往復か」を書くこと。**
- 除外リストは **必ず `sql.param(list)` + 明示的な `::text[]`**。
  `` sql`... <> ALL(${jsArray})` `` は パラメータ列にコンパイルされて 42809 エラーになる。
- マイグレーション:
  - `0000_*` は `--custom` で **`CREATE EXTENSION IF NOT EXISTS vector;` だけ**（drizzle-kit は出力しない）
  - **`CREATE INDEX CONCURRENTLY` をマイグレーションに入れない**（トランザクション内で失敗し、
    エラーを一切出さずに exit 1 する）
  - `drizzle-kit migrate` を使う。`push` は使わない。マイグレーションは **direct** エンドポイント、
    アプリは **pooler** エンドポイント。
- HNSW 構築は **ロード後**に `SET maintenance_work_mem='256MB'` を効かせてから
  （Neon Free の既定 64MB だと pgvector が遅いディスク2パス経路に落ちる）。

## 4. デプロイ（確定）

- **Vercel の Hono プリセットは使わない。** tsup で自己完結 ESM に束ねて "Other" プリセットで出す。
  pnpm ワークスペース + tsconfig paths が zero-config ビルドで壊れる報告が多数（検証済み）。
- エントリ名は **`src/main.ts`**。`src/index.ts` / `src/app.ts` / `src/server.ts` は
  Vercel が別の関数として自動検出してしまい二重デプロイになる。
- tsup: `noExternal: [/^@coto2ba\//]`、`external: ['pg-native']`、ESM、出力 `api/index.mjs`。
  検証: `grep -c '@coto2ba' apps/api/api/index.mjs` が 0 であること。
- `apps/api/public/.gitkeep` を作り `outputDirectory: "public"` を設定する
  （"Other" プリセットは public が無いとソースツリー全体を静的配信してしまう）。
- **リージョンは `sin1`（シンガポール）。Neon に東京リージョンは存在しない。**
  DB と関数を同居させるのが最優先。
- `.vercelignore` で `tools/`（word2vec データ）を除外する。

## 5. モバイル実装の注意（確定）

- **日本語 IME**: RN には composition イベントが無く、`onChangeText` は変換中のかなでも発火する。
  さらに RN 0.76+ の Fabric に CJK IME のバグがある（react/react-native#56463、未修正）。
  対策: TextInput を **controlled `value` にしない**（`defaultValue` + ref）、**`maxLength` を付けない**、
  確定は **送信ボタン**で行う（`onSubmitEditing` に頼らない）。
- `react-native-keyboard-controller` は **SDK 57 の Expo Go に同梱**されている。
  `KeyboardProvider` + `KeyboardStickyView` を使い、`KeyboardAvoidingView` と戦わない。
- Skia のフォントは expo-font とは別に登録が必要。`@expo-google-fonts/noto-sans-jp/400Regular`
  の export は Metro のアセット ID なので `useFont()` にそのまま渡せる。
  `useFonts` は値が **配列**であること（`{ "Noto Sans JP": [NotoSansJP_400Regular] }`）。
- `expo-glass-effect` は **iOS 26+ 限定**。それ以外では黙って素の View になるので、
  `isLiquidGlassAvailable()` で分岐して `expo-blur` にフォールバックする。
- `expo-file-system` の既定 export は新しいクラス API（`File`/`Directory`/`Paths`）。
  旧 API は `expo-file-system/legacy`。
- `npx expo export --platform ios` は Xcode 不要。**JS の解決・Metro 設定・アセット参照しか検証しない**
  （「そのネイティブモジュールが Expo Go に無い」ことは検出できない）。

## 6. ゲームアルゴリズム（参照実装から確定）

```
mix     : v_new = (1 - ratio) * v_current + ratio * v_input        # 生ベクトルで
nearest : 出力語彙のコサイン上位から {current, input} を除いた先頭
hint    : v_W*(r) = (v_goal - (1 - ratio) * v_current) / ratio      # 内挿ではなく外挿
          比率ごとに v_W*(r) の近傍を集め、実際に混ぜて current より
          ゴールに近づくものだけを残し、{current, goal, 既出語, forbidden_inputs,
          表記揺れ} を除いた先頭 6 件を (goal, current) 種の決定的シャッフルで返す
rank    : 1 + |{ w ∈ 出力語彙 : w ≠ goal, cos(w,goal) > cos(result,goal) }|
          result == goal のとき rank = 0（完全錬成）
```

- ヒントは **`{ word, ratio }` の組**を返す（語だけでは「どう混ぜるか」が落ちるため）。
  件数は 6 件に満たないことがあり、0 件もありうる。詳細と理由は SPEC §5.4。
- 最近傍は N=32 取ってから除外する（参照実装の topn=10 は除外後に枯れる）。
- **テスト**: `rank(goal の最近傍) == 1` を assert すること（gensim との契約の検証）。
- 参照実装の 3 つの誤りは踏襲しない:
  1. goal をクライアントから受け取らない（サーバーの games 行に固定）
  2. goal 語そのものの入力を拒否する（ratio=1.0 で即勝ちになる）
  3. NG 語・数字・ラテン文字ゴミ・goal の活用形を候補とヒントから除く


## 7. 実測値（本番、2026-09-17）

| 項目 | 値 |
| --- | --- |
| 1 手の応答（単独） | 中央値 **247ms**（日本 → Vercel sin1 → Neon sin1） |
| 負荷試験 5 req/s × 5 分 | **エラー 0 / 中央値 247ms / p95 338ms / p99 712ms** |
| 最近傍（HNSW、InitPlan 経由） | 0.7ms |
| ランク（102,520 行の厳密全走査） | 92ms |
| vocab のロード（208,707 行 + HNSW） | ローカル 30s / Neon 52s |

SPEC §11.4 の負荷試験目標（5 req/s × 5 分、p95 < 500ms、エラー 0）を達成済み。
