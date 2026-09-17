# コトコトバ Next — 実装仕様書 v1

> Claude Code に渡す実装仕様。ハッカソン版 [coto2-ba](https://github.com/nu-chotech/coto2-ba) を、React Native（Expo）+ Hono + pgvector で作り直す。
> 技育博出展用。稼働できる時間は 1〜2 週間なので、優先度（Must / Should / Stretch）を厳守すること。

---

## 0. 読み方と前提

| 用語 | 意味 |
| --- | --- |
| **Tier A** | 本仕様の本体。**Apple Developer Program なし・Expo Go で配布**する前提。すべての Must / Should は Tier A で動くこと |
| **Tier B** | Apple Developer Program（US$99）を契約した場合に解放される追記（§12）。Tier A のコードを壊さずに足せる構造にしておく |
| **Must** | 展示に必要。これがないと出せない |
| **Should** | 展示の質を決める。時間が許す限りやる |
| **Stretch** | 余った時間で。手を付ける前に Must / Should が全部終わっていること |

### 絶対制約

1. **Expo Go で動くこと。** カスタムネイティブモジュールは使えない。Expo Go に同梱されているライブラリだけで構成する。ネイティブモジュール前提の機能（パスキー、Live Activity）は Tier B に隔離し、`Constants.executionEnvironment === "storeClient"` で必ずガードする。
2. **ゲーム状態はサーバーが持つ。** クライアントは `input_word` と `ratio` しか送らない。ランキングを守るため。
3. **モデルの実行時ロードは行わない。** word2vec は Postgres（pgvector）のテーブル。Python はオフラインのパイプラインのみ。
4. **iOS ファースト。** Android は Expo Go でフォールバック動作すればよく、最適化はしない。

### 確定済みの値

| 項目 | 値 |
| --- | --- |
| リポジトリ | `nu-chotech/coto2ba-next`（モノレポ） |
| API ドメイン | `coto2ba-next-api.chotech.dev`（Hono。後から改名しても影響なし） |
| ランディングドメイン | `coto2ba-next.chotech.dev`（静的サイト。Tier B では rpID / AASA の置き場所になるので改名不可） |
| インフラ | Vercel Hobby に統一：Functions（api）+ 静的サイト（landing）+ Marketplace の Neon Postgres。デプロイは GitHub Actions から `vercel` CLI（§11.5） |
| Bundle ID（Tier B 用） | `dev.chotech.coto2ba` |
| 配布 | Expo Go + EAS Update（production チャンネル） |
| 認証 | 匿名アカウント（ログイン画面なし）+ 自動生成名 + 引き継ぎ QR |
| ゴール語 | 一般名詞のみのプールから抽選（100億固定は廃止） |
| mix_ratio | 0.1〜0.8、0.1 刻みの 8 段階 |

---

## 1. プロダクト概要

**コトコトバ**は、word2vec の意味空間で言葉を「混合（錬成）」し、ゴール語に近づけるワードパズル。現在の語に好きな語を混ぜると、ベクトルの線形補間の最近傍語に変化する。ゴール語から見たランクが 10 位以内に入ればクリア。

### ハッカソン版からの変更点

| 項目 | coto2-ba（ハッカソン版） | Next |
| --- | --- | --- |
| クライアント | Next.js PWA | React Native（Expo Router）、iOS ネイティブ体験 |
| ゴール語 | 「100億」固定 | 難易度付きプールから抽選。デイリーは全員共通 |
| スタート語 | 固定 16 語からランダム | ゴールから見たランクが一定範囲に入る一般語から抽選 |
| 語彙 | 751,361 語をそのまま | 入力語彙 208,707 語 / 出力語彙 102,520 語に刈り込み |
| ベクトル演算 | FastAPI + gensim（常駐） | pgvector（SQL）。Python はオフラインのみ |
| ゲーム状態 | クライアント | サーバー（`games` / `moves`） |
| mix_ratio | 0.0〜1.0 連続 | 0.1〜0.8、8 段階 |
| ヒント | 常時 6 語表示 | ボタンで開く。開いた回数を記録 |
| ユーザー | なし | 匿名アカウント、デイリー、ランキング、図鑑、実績 |
| 単語の説明 | Wikipedia を同期で毎回取得 | Postgres キャッシュ + 遅延取得 |
| 演出 | CSS（白黒→カラー→宇宙→黄金） | 同じ 4 段階を、ガラス tint・ハプティクス・SE・Skia 粒子で表現 |
| 新規画面 | — | 図鑑（3D ベクトル空間）、ランキング、結果 / シェア |

### 非スコープ（v1 でやらない）

App Store 公開、パスキー（Tier B）、Android 最適化、X への直接投稿（シェアシートで代替）、WebSocket によるリアルタイム同期、チュートリアル動画。

> **注記（2026-09-18）**: 対戦（**対戦ルーム**）は 1 秒ポーリングで実装済み。
> この SPEC には節が無く、仕様は `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §9 にある
> （コード中の「設計 §9.x」はそちらを指す。SPEC の §9 は図鑑で別物）。
> WebSocket を使う同期は採らなかった（理由は `docs/QUESTIONS.md`）。

---

## 2. アーキテクチャ

```
┌──────────────────────────────┐
│  iPhone (Expo Go)            │
│  apps/mobile — Expo Router   │
│  ・入力語彙 18 万語を同梱     │
│  ・Better Auth expo client   │
└──────────────┬───────────────┘
               │ HTTPS  https://coto2ba-next-api.chotech.dev
               ▼
┌──────────────────────────────┐        ┌──────────────────────────┐
│  apps/api — Hono (Vercel)    │  SQL   │  Neon Postgres (Vercel MP)│
│  ・Better Auth (anonymous)   │◀──────▶│  ・pgvector: vocab       │
│  ・games / moves / daily     │        │  ・games, moves, users…  │
│  ・ベクトル演算は SQL         │        │  ・calc_cache            │
│  ・OG ページ (Optional)      │        └──────────────────────────┘
│  ・(Stretch) AI Gateway 呼出 │
└──────────────────────────────┘
               ▲
               │ オフライン（一度だけ / 必要時）
┌──────────────┴───────────────┐
│  tools/pipeline — Python uv  │
│  ・WikiEntVec → 刈り込み      │
│  ・pgvector 書き出し          │
│  ・ゴールプール / 難易度実測    │
│  ・デイリー日程生成            │
│  ・(図鑑) UMAP 3D 座標        │
│  ・(Stretch) 埋め込み・説明文   │
└──────────────────────────────┘
```

### 主要な設計判断とその理由

- **word2vec を pgvector に載せる**：gensim 常駐（1.6GB テキスト、コールドスタート数分）をなくす。刈り込みはベクトルを 1 本も変えず候補集合を減らすだけなので、意味空間の質は不変。
- **Wikipedia をホットパスから外す**：ハッカソン版の遅さの主因は毎手 2 回の同期 Wikipedia 呼び出し。説明文は別エンドポイント + キャッシュにし、結果表示後に遅延取得する。
- **結果は決定論的なのでキャッシュ**：`(goal, current, input, ratio)` が同じなら結果は同じ。ヒント語タップの連打は DB ヒットで返る。
- **Better Auth を採用するが、詰まったら切り替える**：anonymous プラグイン + expo プラグインで匿名セッションを作る。Expo Go の `exp://` オリジンまわりで **2 時間以上詰まったら**、`POST /devices` が opaque token を発行する自前方式（§7.4）に切り替えてよい。認証はこのプロジェクトの価値ではない。
- **Postgres は Vercel Marketplace 経由の Neon**：pgvector は Postgres の拡張なので提供元を選ばない。Neon なら `vercel integration add neon` で Vercel プロジェクトに紐づき、`DATABASE_URL` が自動注入され、請求も Vercel にまとまる（Hobby は Neon Free 相当）。運用面の入口が Vercel 一つになる。Function のリージョンは **DB と同じ場所**にする（1 手あたり SQL 往復が 4〜5 回あるので、端末→サーバーの 1 往復より効く）。

---

## 3. リポジトリ構成

```
coto2ba-next/
├── .github/workflows/          # ci.yml, deploy-api.yml, deploy-landing.yml, eas-update.yml
├── apps/
│   ├── mobile/                 # Expo（Expo Router、TypeScript）
│   │   ├── app/                # ルート（(tabs)/play, space, ranking, settings）
│   │   ├── src/
│   │   │   ├── features/       # game, collection, ranking, profile, share
│   │   │   ├── components/     # glass, tier, slider, word …
│   │   │   ├── lib/            # api client, auth client, vocab, audio, haptics
│   │   │   ├── theme/          # tokens（tier palette、typography、spacing）
│   │   │   └── store/          # zustand（UI 状態のみ）
│   │   ├── assets/
│   │   │   ├── vocab/input.txt # 入力語彙（1 行 1 語、約 1.5MB）
│   │   │   ├── sounds/
│   │   │   └── fonts/
│   │   ├── app.json
│   │   └── eas.json
│   └── api/                    # Hono（Vercel Node runtime、region hnd1）
│       ├── src/
│       │   ├── index.ts
│       │   ├── auth.ts         # Better Auth 設定
│       │   ├── db/             # drizzle schema、migrations
│       │   ├── routes/         # games, daily, leaderboard, words, collection, transfer, landing
│       │   ├── services/       # vector（SQL ラッパ）、game（ルール）、achievements
│       │   └── lib/
│       ├── drizzle.config.ts
│       └── vercel.json
│   └── landing/                # 静的ランディング（index.html + vercel.json + .well-known/）
├── packages/
│   └── contracts/              # zod スキーマ、API 型、定数（両アプリが import）
│       └── src/{constants.ts, schemas.ts, tiers.ts}
├── tools/
│   └── pipeline/               # Python 3.12 + uv
│       ├── pyproject.toml
│       ├── data/               # .gitignore（モデル、中間ファイル）
│       ├── scripts/
│       │   ├── 01_download.py
│       │   ├── 02_prune.py
│       │   ├── 03_export_pgvector.py
│       │   ├── 04_goal_pool.py
│       │   ├── 05_daily_schedule.py
│       │   ├── 06_umap_coords.py
│       │   ├── 07_descriptions.py
│       │   └── 08_embeddings.py        # Stretch
│       └── ng_words.txt
├── docs/
│   ├── SPEC.md                 # このファイル
│   └── adr/                    # 決定記録（任意）
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── package.json
└── README.md
```

### 規約

- **Node 22+、pnpm、Turborepo、Biome**（lint / format）。TypeScript は `strict: true`。
- Python は **uv** 管理、`ruff` で lint。`tools/pipeline` は Turborepo から `package.json` の `scripts` 経由で呼べるようにする（`pnpm pipeline:prune` など）。
- `packages/contracts` の zod スキーマが API の入出力の唯一の定義。mobile も api もここから型を取る。
- 定数（ratio の範囲、クリア条件、演出境界）は `packages/contracts/src/constants.ts` に一元化。**マジックナンバーをコードに書かない。**
- 秘密情報は `.env.local`（api）と EAS の環境変数（mobile）。リポジトリに含めない。

---

## 4. 語彙とベクトル空間（tools/pipeline）

### 4.1 元データ

- **WikiEntVec** `jawiki.word_vectors.200d.txt.bz2`（20190520）
  `https://github.com/singletongue/WikiEntVec/releases/download/20190520/jawiki.word_vectors.200d.txt.bz2`
- 751,361 語 × 200 次元、**頻度順**に並んでいる。
- 実測した帯域ごとの内容（刈り込み方針の根拠）：

| 位置 | 例 | 純ラテン文字 | 数字含む |
| --- | --- | --- | --- |
| 1〜5 | 、 の 。 に を | — | — |
| 50,000〜 | 相姦 アオ カリー 太平洋側 蚕 潤滑油 | 22% | 8% |
| 100,000〜 | 外国作品 Saddle 昆陽 博明 Administrator TCC | 29% | 7% |
| 300,000〜 | Mightiest バカラー COUPE 南桜井 SEMPO ジェファーソン郡 | 33% | 8% |
| 700,000〜 | タマガー matC 怯台 鈴嶋 higgs 09095 | 36% | 6% |

### 4.2 二層語彙

| 層 | 用途 | 目標サイズ | フィルタ |
| --- | --- | --- | --- |
| **入力語彙** `is_input` | プレイヤーが打った語のベクトル引き当て | 約 18 万語 | 頻度順位 ≤ 300,000、かつ **日本語スクリプト（ひらがな・カタカナ・漢字）を 1 文字以上含む**、NG リスト除外 |
| **出力語彙** `is_output` | 混合結果・ヒント・ランク計算の候補集合 | 約 10 万語 | 入力語彙のうち、MeCab（`fugashi` + `unidic-lite`）で **単一トークンかつ品詞が 名詞 / 動詞 / 形容詞 で、表層形＝基本形**。記号・助詞・助動詞・接尾辞・活用断片（「斬ら」等）を除外。**数字を含まない**、**2 文字以上**、NG リスト除外 |

- NG リスト `tools/pipeline/ng_words.txt`：差別語・性的表現・暴力表現。出力語彙とゴールプールの両方から除外。展示・審査に出すので必須。初期リストはチームで用意し、LLM に「公開の場で表示して問題がある語」を出力語彙から拾わせて補強してよい（Stretch）。
- 出力語彙のサイズ `N_OUTPUT` はパイプラインの結果として決まる。演出の境界（§5.5）はこの値を基準に決めているので、大きく変わったら再調整する。

### 4.3 pgvector スキーマ

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vocab (
  word       text PRIMARY KEY,
  freq_rank  integer NOT NULL,           -- 元ファイルの行番号（1 始まり）
  is_input   boolean NOT NULL DEFAULT true,
  is_output  boolean NOT NULL DEFAULT false,
  pos        text,                        -- MeCab の品詞（出力語彙のみ）
  w2v        halfvec(200) NOT NULL,
  pos3       real[],                      -- 図鑑用 3D 座標 [-1,1]^3（出力語彙のみ）
  emb        halfvec(768)                 -- Stretch: 埋め込みモデルのベクトル
);

CREATE INDEX vocab_output_hnsw
  ON vocab USING hnsw (w2v halfvec_cosine_ops)
  WHERE is_output;

CREATE INDEX vocab_output_freq ON vocab (freq_rank) WHERE is_output;
```

- `halfvec` で 18 万語 × 200 次元 ≈ 72MB。Neon Free（0.5GB）に収まる（Stretch の `emb` 768 次元を足しても約 230MB）。
- 書き出しは `COPY` または 5,000 行ずつのバッチ INSERT。

### 4.4 パイプラインのスクリプト

| スクリプト | 入力 → 出力 | 備考 |
| --- | --- | --- |
| `01_download.py` | GitHub Release → `data/jawiki.200d.txt` | 588MB、初回のみ |
| `02_prune.py` | txt → `data/vocab.parquet`（word, freq_rank, is_input, is_output, pos, vec） | フィルタ規則は §4.2。統計（各層のサイズ、除外理由の内訳）を stdout に出す |
| `03_export_pgvector.py` | parquet → Postgres `vocab` | 冪等（`ON CONFLICT DO UPDATE`） |
| `04_goal_pool.py` | vocab → `goal_pool` | §6 |
| `05_daily_schedule.py` | goal_pool → `daily_challenges`（120 日分） | §6.4 |
| `06_umap_coords.py` | 出力語彙の w2v → `vocab.pos3` | §9.1 |
| `07_descriptions.py` | ゴールプール + 頻度上位 5 万語 → `word_descriptions` | §7.6 |
| `08_embeddings.py` | 出力語彙 → `vocab.emb` | Stretch（§10.1） |

パイプラインは gensim を使ってよい（`KeyedVectors.load_word2vec_format`）。ランタイムでは使わない。

---

## 5. ゲームルール

### 5.1 定数（`packages/contracts/src/constants.ts`）

```ts
export const RATIO_MIN = 0.1;
export const RATIO_MAX = 0.8;
export const RATIO_STEP = 0.1;           // 0.1, 0.2, …, 0.8 の 8 段階
export const CLEAR_RANK = 10;            // rank <= 10 でクリア
export const MAX_MOVES = 20;             // 20 手でギブアップ扱い
export const HINT_COUNT = 6;             // ヒントの上限件数（下回ることがある。§5.4）
export const HINT_EXTRAPOLATION_NEIGHBORS = 24;  // 外挿点ごとに集める近傍数
export const HINT_VERIFY_LIMIT = 16;     // 実際に混ぜて検証する候補数
export const TIERS = [                   // 演出帯（出力語彙 ≈ 10 万語 を前提）
  { id: "gold",   maxRank: 10 },
  { id: "cosmos", maxRank: 300 },
  { id: "color",  maxRank: 3000 },
  { id: "mono",   maxRank: Infinity },
] as const;
export const DAILY_TZ = "Asia/Tokyo";
export const START_RANK_RANGE = [3000, 30000] as const;
```

### 5.2 用語

- **goal**：ゴール語。プレイヤーに常に表示する。
- **current**：現在の語。ゲーム開始時は start。
- **input**：プレイヤーが打った語。
- **ratio**：混合比率。`v_new = (1 - ratio) * v_current + ratio * v_input`。
- **result**：`v_new` の出力語彙内の最近傍（`current`・`input` を除く）。次の `current` になる。
- **rank**：ゴール語から見た `result` の順位。定義：`1 + |{ w ∈ 出力語彙, w ≠ goal, cos(w, goal) > cos(result, goal) }|`。`result == goal` のときは **rank 0 =「完全錬成」**。
- **tier**：rank から決まる演出帯。`TIERS` の先頭から `rank <= maxRank` を満たす最初のもの。

### 5.3 1 手の処理（サーバー）

```
POST /games/:id/moves { input_word, ratio }

1. ゲームが進行中（status = playing）であること。違えば 409
2. ratio が 8 段階のいずれかであること。違えば 422
3. input_word の正規化：trim、全角英数→半角、NFKC
4. 禁止入力：
   - input == goal            → 422 { code: "GOAL_INPUT" }
   - input == current         → 422 { code: "SAME_AS_CURRENT" }
   - vocab に無い / is_input=false → 422 { code: "OOV" }
5. calc_cache を (goal, current, input, ratio) で引く。ヒットすればそれを使う
6. v_new を計算し、出力語彙から最近傍 10 件を取り、{current, input} を除いた先頭を result とする
7. rank を計算（§5.2）
8. calc_cache に保存
9. moves に行を追加、games.current / move_count / status を更新
   - rank <= CLEAR_RANK → status = cleared, cleared_at = now
   - move_count >= MAX_MOVES → status = gave_up（自動）
10. word_encounters を更新（result を source=result、input を source=input で upsert）
11. 実績判定（§8.4）
12. レスポンス：{ result, rank, tier, move_count, status, unlocked_achievements[] }
```

`description` はこのレスポンスに**含めない**（§7.6 の別エンドポイントで遅延取得）。

### 5.4 ヒント

- `POST /games/:id/hints` で **`{ word, ratio }` を最大 `HINT_COUNT`（6）件**返し、`games.hint_count` を +1 する。
  **語だけでなく「どの比率で混ぜるか」まで返す。**
- 生成（`hintCandidates`）。**内挿ではなく外挿**である。1 手は `blend(v_current, 1-r, v_input, r)` なので、
  現在とゴールの中間にある語を混ぜても結果は現在からほとんど動かない。比率 `r` でゴールに着地させる入力語は

  ```
  v_W*(r) = (v_goal − (1 − r) · v_current) / r
  ```

  の方向にある。

  1. `RATIOS` の比率ごとに `v_W*(r)` を作り、出力語彙の近傍を `HINT_EXTRAPOLATION_NEIGHBORS` 件ずつ集める（1 本の SQL）
  2. 各候補について全比率を走査し、混合結果がゴールに最も近づく比率を算術で選ぶ
  3. 上位 `HINT_VERIFY_LIMIT` 件を**実際に混ぜて**、結果語のゴール類似度が `current` を超えるものだけ残す
  4. `{current, goal}`・**そのゲームで既に登場した語（history）**・`games.forbidden_inputs`・
     表記揺れ（`isMorphologicalVariant`）を除く
  5. 残った先頭 `HINT_COUNT` 件を、**`(goal, current)` を種にした決定的シャッフル**で並べ替えて返す

- **6 件に満たないことがある。0 件もありうる。** 効かない語で埋めると「ヒントが効かない」に戻るため、
  件数が減ることを許す。0 件のときは端末がその旨を出す。
- 並びは**ゴールに近い順ではない**。近い順だと 1 位が常に勝ち確定の手になり、反射的に一番上を押されるため。
  ただし `hint_cache` が `(goal, current)` でキャッシュされる以上、
  **同じ盤面なら常に同じ語・同じ並び**でなければならない（`Math.random()` を使わない理由）。
- 同じ current に対して 2 回開いても同じ結果（キャッシュ）。カウントは開くたびに増える。
- クライアントはヒントをタップすると**語と比率の両方**を入力に載せる（自動で混合はしない）。
- **ヒントの強さに上限は設けていない。** 実測では一番上のヒントの約半数がそのままクリア圏に着地する。
  抑止は §5.8 のランキング（ヒント数が最優先キー）が担う。

### 5.5 演出帯

| tier | rank | 演出 |
| --- | --- | --- |
| `mono` | 3,001〜 | 白黒。ガラスは無彩色 |
| `color` | 301〜3,000 | 淡い色が入る。ガラスに tint |
| `cosmos` | 11〜300 | 宇宙。Skia の星粒子、深い青紫 |
| `gold` | 0〜10 | 黄金。粒子 + 光条。クリア |

ランクは対数で「温度」に変換して表示：`heat = 1 - log10(max(rank,1)) / log10(N_OUTPUT)`（0〜1）。数値のランクも併記する。

### 5.6 デイリーモード

- **JST 0:00 に切り替え。** `daily_challenges.date` は JST の日付。サーバーは UTC で保存し、比較時に変換する。
- 全員同じ goal / start。`daily_challenges` テーブルから引く（事前生成、§6.4）。
- **1 日 1 回。** `POST /games { mode: "daily" }` はその日の自分の daily game があれば既存を返す（新規作成しない）。
- **最初の 1 手を打った時点で確定。** やり直し・undo なし。終了条件は cleared か gave_up（明示的ギブアップ、または 20 手）。
- 開始前は start をシャッフルできる**か**：デイリーは全員共通なので**シャッフル不可**。フリーは可。

### 5.7 フリーモード

- `POST /games { mode: "free", difficulty: "easy" | "normal" | "hard" }`。プールから難易度で抽選、start は §6.3 の規則で抽選。
- 試行無制限、ランキング対象外。`users.best_free_moves[difficulty]` に自己ベストだけ記録。
- 自己ベストは `{ moves, hints }`。良さの基準は**ランキングと同じ (ヒント数, 手数) の辞書順**（§5.8）で、
  ノーヒント 15 手はヒント 1 回 3 手より良い記録として上書きする。
  手数だけで比べると、ヒント 1 回で出した「1 手」が永久に残り以後更新できなくなるため。
  手数だけの旧形式（`{ normal: 8 }`）はヒント数が不明なので**記録なしとして捨てる**。
- 図鑑の「出会い」はフリーでも増える。

### 5.8 ランキング

- 対象：その日のデイリーで `status = cleared` のゲーム。
- 順序：`hint_count ASC, move_count ASC, cleared_at ASC`。
  **ヒント数が最優先**なので、ヒントを 1 回でも使った人はノーヒントでクリアした全員より下になる。
  ヒントを外挿にした（§3.3 / `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md`）結果、
  ヒント 1 手でゴール圏まで届くほど強くなったため、ヒントを弱める代わりにランキングで課金する形にした
  （経緯は `docs/QUESTIONS.md`）。
- 表示：上位 50 + 自分の順位。名前は `users.display_name`。
- ブースモード（§8.6）で作られた匿名ユーザーもそのまま載る。

### 5.9 完全錬成

result がゴール語そのもの（rank 0）。クリア扱いに加えて実績 `perfect` を付与。ランキング上の扱いは通常クリアと同じ。

---

## 6. ゴールプールとスタート語

### 6.1 候補の抽出（`04_goal_pool.py`）

出力語彙のうち：

- 頻度順位 **500〜30,000**
- MeCab 品詞が **名詞-普通名詞**（固有名詞・数詞・代名詞・サ変接続のみの語は除外）
- 2 文字以上、数字なし、NG リスト外
- 上位 10 近傍の健全性チェック（自動フラグ）：
  - 上位 10 語のうち 5 語以上が goal と 2 文字以上の接頭辞 / 接尾辞を共有する（表記揺れクラスタ）
  - 上位 10 語に数字を含む語が 3 語以上
  - フラグが立った語は `review_needed = true` にして人が確認する

### 6.2 難易度の実測（ヒント追従ボット）

各候補 goal に対して、§6.3 の規則で選んだ **5 個の start** から次のボットを回す：

```
state = start; moves = 0
while moves < 15:
    hints = hint_words(state, goal)                  # ゲームと同じアルゴリズム（§5.4）
    best = argmin over h in hints, r in {0.3, 0.5, 0.8}
           of rank(nearest(mix(state, h, r)), goal)
    state = best.word; moves += 1
    if rank(state, goal) <= CLEAR_RANK: return moves
return None                                          # 到達不能
```

- 5 回の平均 `bot_moves` で分類：**Easy ≤ 4 / Normal 5〜7 / Hard 8〜12**。13 以上または None が 1 回でもあれば除外。
- これにより「ヒントに従えば必ず解ける」ことが保証される。
- 目標：Easy 80 / Normal 150 / Hard 70 程度。足りなければ頻度範囲を広げる。

> **注記（2026-09）**: `goal_pool.difficulty` に入っている値は**旧ヒントアルゴリズム（内挿）基準**である。
> ヒントを外挿に作り直した（§5.4）結果、このボットは現在ほぼ全てのゴールを 1 手でクリアするため、
> **`bot_moves` の絶対値は現行ヒントの手数とは対応しない。**
> ただしゴール同士の**相対的な難易度の順序づけ**としては引き続き有効なので、そのまま使っている。
> 作り直すにはパイプラインの再実行が要る。詳細は `docs/QUESTIONS.md`。

### 6.3 スタート語の規則

- 出力語彙、頻度順位 ≤ 20,000、名詞-普通名詞、NG 外。
- **ゴールから見たランクが `START_RANK_RANGE` = [3,000, 30,000]** に入る語からランダム。
- ゴールと 1 文字以上の漢字を共有しない（「銀河」に対して「銀行」を避ける程度の粗い規則で十分）。

### 6.4 デイリー日程（`05_daily_schedule.py`）

- 今日から 120 日分を生成し `daily_challenges` に入れる。シードは日付文字列。
- 難易度ローテーション：**月〜金 Normal、土 Hard、日 Easy**（定数で変更可）。
- 同じ goal は 120 日内で再登場しない。
- テーブルは人が眺めて差し替えてよい（展示日は面白い goal を手で選ぶ想定）。

### 6.5 ゴール語の説明文

`goal_pool.description` に一行（40 字以内）。「今日の目的地：『蚕』— 絹を吐く虫」の形で表示。`07_descriptions.py` で Wikipedia REST（`/page/summary/{title}`、User-Agent 必須）の 1 文目を取り、長ければ LLM で 40 字に要約（Stretch でも可。最初は Wikipedia の 1 文目を切り詰めるだけでよい）。

### 6.6 テーブル

```sql
CREATE TABLE goal_pool (
  word          text PRIMARY KEY REFERENCES vocab(word),
  difficulty    text NOT NULL CHECK (difficulty IN ('easy','normal','hard')),
  bot_moves     real NOT NULL,
  description   text,
  review_needed boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT true
);

CREATE TABLE daily_challenges (
  date        date PRIMARY KEY,                 -- JST
  goal        text NOT NULL REFERENCES goal_pool(word),
  start       text NOT NULL REFERENCES vocab(word),
  difficulty  text NOT NULL
);
```

---

## 7. バックエンド（apps/api）

### 7.1 スタック

- **Hono**（TypeScript）、Vercel Node runtime（`hono/vercel` アダプタ）。region は **Neon の DB と同じ**（東京があれば `hnd1`、なければシンガポール `sin1`）
- **Drizzle ORM** + `postgres`（postgres-js）。マイグレーションは `drizzle-kit`
- **Better Auth**：`anonymous` プラグイン、`expo` プラグイン
- **zod**（`packages/contracts`）で入出力を検証
- テスト：vitest（ルール層 `services/game` はユニットテスト必須）

### 7.2 環境変数

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon（Marketplace 連携が自動注入。pooled 接続文字列を使う） |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth |
| `API_ORIGIN` / `LANDING_ORIGIN` | `https://coto2ba-next-api.chotech.dev` / `https://coto2ba-next.chotech.dev` |
| `EXPO_UPDATE_URL` | ランディングページの「開く」リンク |
| `AI_GATEWAY_API_KEY` | Stretch |

### 7.3 データモデル

Better Auth が作る `user / session / account / verification` に加えて：

```sql
-- Better Auth の user に列を足す（drizzle の schema 拡張で）
ALTER TABLE "user" ADD COLUMN display_name text NOT NULL;
ALTER TABLE "user" ADD COLUMN best_free_moves jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "user" ADD COLUMN booth boolean NOT NULL DEFAULT false;

CREATE TABLE games (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES "user"(id),
  mode         text NOT NULL CHECK (mode IN ('daily','free','room')),
  daily_date   date,                                -- mode=daily のとき JST 日付
  difficulty   text NOT NULL,
  goal         text NOT NULL,
  start        text NOT NULL,
  current      text NOT NULL,
  current_rank integer NOT NULL,
  move_count   integer NOT NULL DEFAULT 0,
  hint_count   integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'playing' CHECK (status IN ('playing','cleared','gave_up')),
  perfect      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at   timestamptz,
  UNIQUE (user_id, daily_date)                      -- デイリーは 1 日 1 回
);
-- 並びは ヒント数 → 手数 → クリア時刻（§5.8）。インデックスも同じ順（マイグレーション 0005）。
CREATE INDEX games_daily_leaderboard ON games (daily_date, hint_count, move_count, cleared_at) WHERE status = 'cleared';

CREATE TABLE moves (
  game_id    uuid NOT NULL REFERENCES games(id),
  seq        integer NOT NULL,
  input_word text NOT NULL,
  ratio      real NOT NULL,
  result     text NOT NULL,
  rank       integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, seq)
);

CREATE TABLE calc_cache (
  goal text, current text, input text, ratio real,
  result text NOT NULL, rank integer NOT NULL,
  PRIMARY KEY (goal, current, input, ratio)
);

CREATE TABLE hint_cache (
  goal text, current text,
  -- `{ word, ratio }[]`。語だけでは「どう混ぜるか」が落ちるので
  -- マイグレーション 0004 で text[] から jsonb に変えた（§5.4）。
  hints jsonb NOT NULL,
  PRIMARY KEY (goal, current)
);

CREATE TABLE word_encounters (
  user_id       text NOT NULL REFERENCES "user"(id),
  word          text NOT NULL,
  source        text NOT NULL CHECK (source IN ('start','result','input')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  first_game_id uuid,
  count         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, word, source)
);

CREATE TABLE word_descriptions (
  word       text PRIMARY KEY,
  text       text NOT NULL,
  source     text NOT NULL,                          -- 'wikipedia' | 'llm'
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
  user_id     text NOT NULL REFERENCES "user"(id),
  achievement text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  game_id     uuid,
  PRIMARY KEY (user_id, achievement)
);

CREATE TABLE transfer_tokens (
  token      text PRIMARY KEY,                       -- 32 文字ランダム
  user_id    text NOT NULL REFERENCES "user"(id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
```

### 7.4 認証

- **匿名アカウント**：アプリ初回起動時にクライアントが `signIn.anonymous()` を呼ぶ。ユーザーは何も見ない。セッションは `expo-secure-store`（Better Auth expo クライアントが扱う）。
- `display_name` は作成時にサーバーが自動生成：出力語彙から **形容詞 1 語 + 名詞 1 語**（例「静かな蚕」「黄金の潤滑油」）。形容詞は「〜い / 〜な」形の候補リストをパイプラインで 200 語ほど用意しておく。ユーザーは設定で変更可（1〜12 文字、NG 語チェック）。
- **引き継ぎ**：`POST /transfer` で 10 分有効のトークンを発行し、QR（`exp://…?transfer=<token>` の形の EAS Update リンク）にする。新端末で `POST /transfer/claim { token }` を呼ぶと、そのセッションのユーザーを既存ユーザーに差し替える（旧匿名ユーザーは削除）。
- **フォールバック（Better Auth で詰まった場合）**：`POST /devices` が `user` 行と 48 文字の opaque token を作り、クライアントは `Authorization: Bearer <token>` で送る。サーバーは `device_tokens(token, user_id)` を引くだけ。この方式でも上記のすべてが成立する。

### 7.5 エンドポイント

すべて `/api` 配下。認証必須のものは Better Auth のセッション（またはフォールバックの Bearer）。

| メソッド / パス | 認証 | 内容 |
| --- | --- | --- |
| `POST /api/auth/*` | — | Better Auth |
| `GET /api/me` | ✓ | `{ id, display_name, booth, best_free_moves, stats }` |
| `PATCH /api/me` | ✓ | `{ display_name? , booth? }` |
| `GET /api/daily` | ✓ | 今日の `{ date, difficulty, goal, description, start, my_game? }`（goal の rank は返さない） |
| `POST /api/games` | ✓ | `{ mode, difficulty? }` → game。daily は既存があればそれを返す |
| `GET /api/games/:id` | ✓ | game + moves |
| `POST /api/games/:id/shuffle-start` | ✓ | free かつ move_count=0 のときのみ。start を引き直す |
| `POST /api/games/:id/moves` | ✓ | §5.3 |
| `POST /api/games/:id/hints` | ✓ | §5.4 |
| `POST /api/games/:id/give-up` | ✓ | status = gave_up |
| `GET /api/leaderboard/daily?date=YYYY-MM-DD` | ✓ | 上位 50 + `me: { rank, … }` |
| `GET /api/words/:word/description` | ✓ | §7.6 |
| `GET /api/words/check?w=` | — | `{ ok: boolean }`。端末側判定の保険。通常は使わない |
| `GET /api/collection` | ✓ | 出会った語 `[{ word, source, first_seen_at, count, pos3 }]` + クリア済みゲームの経路 |
| `GET /api/achievements` | ✓ | 定義一覧 + 自分の解除状況 |
| `POST /api/transfer` / `POST /api/transfer/claim` | ✓ | §7.4 |
| `GET /share/:gameId` | — | Optional：OG 付きの結果ページ（X 投稿時のカード用） |

ランディング（`/`）と AASA（Tier B）は API ではなく `apps/landing` が配信する（§11.2、§12.2）。`/share/:gameId` を `coto2ba-next.chotech.dev/share/…` の URL で出したい場合は、landing 側 `vercel.json` の `rewrites` で API に転送する（Optional）。

エラーは `{ code, message }`。`code` は `GOAL_INPUT / SAME_AS_CURRENT / OOV / INVALID_RATIO / GAME_FINISHED / DAILY_DONE / …` を `packages/contracts` に enum として持つ。

### 7.6 単語の説明

- `GET /api/words/:word/description`：`word_descriptions` にあれば返す。なければ Wikipedia REST `https://ja.wikipedia.org/api/rest_v1/page/summary/{word}` を叩き（User-Agent に連絡先を入れる）、`extract` の 1 文目を保存して返す。見つからなければ `{ text: null }`。
- 事前バッチ（`07_descriptions.py`）でゴールプール全語 + 頻度上位 5 万語を埋めておく。展示当日はほぼキャッシュヒットになる。
- クライアントは結果アニメーションが終わってから呼ぶ。失敗しても UI は壊れない。

### 7.7 ベクトル演算（SQL）

`services/vector.ts` に以下をラップする。ベクトルは JS 側で `number[]` として持ち、`'[…]'::halfvec(200)` リテラルで渡す。

```sql
-- 2 語のベクトル取得
SELECT word, w2v::text FROM vocab WHERE word = ANY($1);

-- 最近傍（出力語彙、除外語あり）
SELECT word FROM vocab
WHERE is_output AND word <> ALL($2)
ORDER BY w2v <=> $1::halfvec(200)
LIMIT 10;

-- ランク（§5.2 の定義）
WITH g AS (SELECT w2v FROM vocab WHERE word = $1),
     r AS (SELECT w2v FROM vocab WHERE word = $2)
SELECT 1 + count(*)::int AS rank
FROM vocab v, g, r
WHERE v.is_output AND v.word <> $1
  AND (v.w2v <=> g.w2v) < (r.w2v <=> g.w2v);
```

- ランクは出力語彙 10 万行のフルスキャン。数十 ms で返る。事前計算テーブルは作らない。
- `<=>` はコサイン距離。混合ベクトルは正規化しなくてよい（コサインなので）。
- HNSW の `ef_search` はデフォルトのままで十分。

### 7.8 レート制限・保護

- ユーザーごと **持続 5 req/s**（in-memory の token bucket。Vercel のインスタンス跨ぎで甘くなるのは許容）。
- **容量（バースト）は持続レートとは別の定数**で、汎用は 20、部屋のポーリングは持続 4 req/s・容量 12。
  容量を持続レートと同じ 5 にしていたため、起動時の一斉リクエスト（実測 1 秒以内に 7 本）で
  **アプリを開くたびに 429 が出ていた**。値と根拠は `packages/contracts/src/constants.ts`。
- `POST /api/games` は 1 ユーザー 10 req/min。
- すべてのルールはサーバーで判定する。クライアントの値は信用しない。

---

## 8. モバイル（apps/mobile）

### 8.1 スタック

- **Expo**：`npx create-expo-app@latest` が選ぶ **最新 SDK**。Expo Go（App Store 版）はその 1 バージョンしか動かないので、SDK を上げるときは Expo Go と同時に。
- **Expo Router**（タブ + スタック）。タブバーは **Native Tabs**（SDK 現行の API）。iOS 26 ではシステムのガラスのタブバーになる。
- `expo-glass-effect`（`GlassView` / `GlassContainer`、`isLiquidGlassAvailable()`）、`expo-blur`（フォールバック）
- `react-native-reanimated`、`react-native-gesture-handler`
- `@shopify/react-native-skia`（演出帯の粒子、図鑑の 3D）
- `expo-haptics`、`expo-audio`、`expo-symbols`
- `expo-secure-store`、`expo-asset`、`expo-file-system`
- `react-native-view-shot` + `expo-sharing`（シェア画像）
- `@tanstack/react-query`（サーバー状態）、`zustand`（UI 状態）
- Better Auth expo クライアント（`@better-auth/expo`）
- **使ってはいけないもの**：Expo Go に同梱されていないネイティブモジュール全般。迷ったら Expo の SDK ページで「Included in Expo Go」を確認する。

### 8.2 画面構成

```
(tabs)
├── play/            # プレイ
│   ├── index        # ロビー：今日のデイリー（goal + 説明 + 自分の状態）、フリーモード（難易度選択）
│   ├── game/[id]    # ゲーム画面
│   └── result/[id]  # 結果・シェア・解除実績
├── space/           # 図鑑（3D ベクトル空間）
│   └── index
├── ranking/         # デイリーランキング（日付切替）
│   └── index
└── settings/        # 名前変更、ブースモード、引き継ぎ QR、サウンド ON/OFF、クレジット
    └── index
```

### 8.3 ゲーム画面

上から：

1. **ゴールカード**（GlassView）：goal、一行説明、難易度、手数 `n / 20`
2. **現在の語**：画面の主役。大きな和文タイポ。結果が変わるときはクロスフェード + スケール。tier に応じて背景（§8.5）
3. **ランク表示**：数値 + 温度バー（対数）。前手からの変化を矢印と色で。
4. **入力欄**：日本語入力。端末側の語彙判定（§8.7）で、辞書にない語は送信前に赤く警告。前方一致の候補を 5 件までチップ表示。
5. **ratio スライダー**：8 段階の検出スライダー。各段階でハプティクス（selection）。ラベルは「今の語寄り ←→ 混ぜる語寄り」。
6. **混合ボタン**：大きい。押すと入力欄を閉じ、混合演出（§8.5）→ 結果。
7. **ヒントボタン**：押すとシートで 6 語（GlassView）。開いた回数をカードに小さく表示。タップで入力欄に入れる。
8. **履歴**：横スクロールのチップ列（`input ×ratio → result (rank)`）。全手表示（ハッカソン版の 5 件制限は撤廃）。
9. ギブアップは「…」メニューの中。確認ダイアログあり。

演出のルール：**待ちが発生する処理（API 往復）は必ず混合演出で覆う。** 応答が 300ms 未満でも演出は最低 600ms 見せる（体感の一貫性）。

### 8.4 結果画面と実績

- 表示：goal、start、手数、ヒント数、tier のマスで表した経路（1 手 1 マス。⬜ mono / 🟩 color / 🟦 cosmos / 🟨 gold）、完全錬成なら特別表示、解除した実績。
- ボタン：**シェア**（画像 + テキスト）、**図鑑で見る**（今回の経路をハイライト）、ブースモード時は **次の人へ**。
- シェア画像：`react-native-view-shot` で結果カードを PNG 化 → `expo-sharing`。iOS のシェアシートから X にもそのまま投稿できる。テキスト版：

  ```
  コトコトバ 9/17 ⬜⬜🟩🟩🟦🟨
  6手でクリア（ヒント1）
  https://coto2ba-next.chotech.dev
  ```

- 実績（v1 の 12 個）。判定はサーバー（`services/achievements.ts`）、結果画面でまとめて演出：

| id | 条件 |
| --- | --- |
| `meet_10` / `meet_50` / `meet_100` / `meet_500` | 出会った語（start + result）の累計 |
| `reach_cosmos` | rank ≤ 300 に初到達 |
| `reach_gold` | rank ≤ 10 に初到達（= 初クリア） |
| `perfect` | 完全錬成 |
| `no_hint_clear` | ヒント 0 でクリア |
| `clear_5` | 5 手以内でクリア |
| `streak_3` / `streak_7` | デイリー連続クリア |
| `comeback` | 前日ギブアップ → 翌日クリア |

### 8.5 デザインシステム

- **Liquid Glass**：カード・シート・ボタンは `GlassView`。`isLiquidGlassAvailable()` が false（iOS 25 以前、Android）なら `expo-blur` の `BlurView` + 半透明背景に自動フォールバック。ガラスの `tintColor` は tier パレットから取る。ガラスの上に強い色を置かない（HIG の原則）。既知の問題：`GlassView` の `opacity: 0` は描画されないので、フェードは `opacity` ではなく別レイヤーで。
- **tier パレット**（`src/theme/tiers.ts`）：`mono`（黒白灰）、`color`（淡い暖色）、`cosmos`（深紫〜群青、星粒子）、`gold`（金〜琥珀、光条）。背景は Skia の全画面 Canvas 1 枚で描き、tier 遷移はパラメータ補間（再マウントしない）。
- **タイポグラフィ**：システムフォント（SF Pro + ヒラギノ）。現在の語は 44〜56pt、太め。ラベルは Dynamic Type に追従。
- **モーション**：Reanimated の spring 基調。混合演出は「2 語が中央で溶けて 1 語になる」1 種類だけ作り込む（複数種類は作らない）。
- **アイコン**：`expo-symbols`（SF Symbols）。

### 8.6 ハプティクス・サウンド

`src/lib/feedback.ts` に **イベント名 → (haptic, sound)** の対応表を 1 つ置き、UI はイベント名だけ呼ぶ。

| イベント | ハプティクス | SE |
| --- | --- | --- |
| `slider_detent` | `selectionAsync` | 小さなクリック |
| `mix_start` | `impactAsync(Medium)` | 溶ける音（600ms） |
| `result_closer`（rank が縮んだ） | `impactAsync(Light)` | tier ごとに音高が上がるチャイム |
| `result_farther` | `impactAsync(Soft)` | 低く短い音 |
| `tier_up` | `notificationAsync(Success)` | tier 固有のスティング |
| `tier_down` | `impactAsync(Rigid)` | なし |
| `clear` | Success + 300ms 後に Heavy | ファンファーレ（2 秒） |
| `perfect` | clear + Heavy ×2 | ファンファーレ + 追加音 |
| `hint_open` | `selectionAsync` | ページをめくる音 |
| `error_oov` | `notificationAsync(Error)` | エラー音 |
| `achievement` | `notificationAsync(Success)` | バッジ音 |

- `expo-audio` で SE はアプリ起動時にプリロード。サイレントスイッチ ON のときは鳴らさない（ゲームだが展示会場で鳴り続けるのを避ける）。設定で SE を OFF にできる。
- SE 素材：**自作の合成音 10 本**（`tools/pipeline/scripts/11_sounds.py` がサイン波から合成、`pnpm pipeline:sounds`）。外部素材は使っていないのでライセンス上の制約は無い。内訳は `assets/sounds/CREDITS.md`。

### 8.7 端末側の語彙判定

- `assets/vocab/input.txt`（入力語彙、1 行 1 語、UTF-8、ソート済み、約 1.5MB）を `expo-asset` で読み、起動時に `Set<string>` とソート済み配列を作る（バックグラウンドで、初回のみ 1 秒程度）。
- 入力中：正規化（NFKC、trim）→ `Set` で存在判定 → 無ければ二分探索で前方一致 5 件を候補チップに出す。
- これにより OOV の往復がなくなる。サーバー側の判定は残す（最終権威）。

### 8.8 ブースモード

設定でトグル（`users.booth = true`）。ON のとき：

- 結果画面に **次の人へ** ボタン。押すと新しい匿名ユーザーを作って（現ユーザーのセッションは破棄）ロビーに戻る。
- クリア時に **名前を入れてランキングに残す** の 1 入力欄（省略可。省略なら自動生成名のまま）。
- 自動生成名を大きく表示（「あなたは『静かな蚕』です」）。
- 3 分無操作でロビーに戻る。

### 8.9 Web ターゲット（Optional）

`expo export --platform web` で同じコードを Vercel に静的配置し、Expo Go を入れたくない人向けの体験版にする。コンポーネントは web-safe に保つ（`GlassView` はフォールバック、Skia は web でも動くが重い）。優先度は低い。ランディングに「ブラウザで試す」として置く。

---

## 9. 図鑑（3D ベクトル空間）

### 9.1 座標の事前計算（`06_umap_coords.py`）

- 出力語彙（約 10 万語）の w2v に **UMAP（n_components=3, n_neighbors=15, min_dist=0.1, metric="cosine"）** を一度かけ、各軸を `[-1, 1]` に正規化して `vocab.pos3` に保存。
- 全ユーザー共通の「世界地図」。ゴール語もこの座標上に固定される。
- 局所の近さは保たれるが大域の距離は近似である。タップした語の詳細には所持語との**実コサイン類似度**（サーバー計算、上位 5 語）を数値で出して補う。
- ゴースト点：出力語彙から頻度上位 2,000 語を「未取得の薄い粒子」として固定サンプルする（クライアントにハードコード可、`assets/vocab/ghost.json`）。

### 9.2 レンダリング（Skia 2.5D）

`features/collection/SpaceCanvas.tsx`：

- 全画面 Skia Canvas。カメラは **yaw / pitch / distance** の 3 値（Reanimated shared value）。パン → yaw/pitch、ピンチ → distance、慣性あり。
- 各点：`pos3` を回転 → 透視投影（focal 1.5）→ 画面座標。**深度でサイズ（0.6〜1.4 倍）とアルファ（0.35〜1.0）** をフォールオフ。深度ソートは毎フレーム。
- 点の描画：所持語は tier 色（初遭遇時の rank の tier）の円 + 微発光。ゴースト点は小さい灰色。今日のゴール語は金の輪で強調。
- ラベル：所持語のうち **画面上で近い上位 40 語** だけ和文ラベルを billboard で描く（Skia の `Paragraph` / `Text`、フォントは同梱の Noto Sans JP を `matchFont` で）。それ以外はズームで出る。
- 経路：クリア済みゲームの `start → result… → goal` を細い線で描く。結果画面から遷移したときは今回の経路をハイライトして開始。
- タップ：投影後の画面座標で最近傍（半径 24pt）を拾う。ヒットで **ガラスのボトムシート**：語、説明文（§7.6）、初遭遇日、出会ったゲーム、所持語の中で近い 5 語（実コサイン）、「この語で始まった / 通ったゲーム」。
- 検索：上部の検索欄で語を打つとカメラがその語へ移動。
- パフォーマンス目標：所持 500 語 + ゴースト 2,000 点で 60fps（Pro Motion なら 120）。点は `Points` / `Vertices` でバッチ描画、ラベルは上限 40。

### 9.3 データ

- `GET /api/collection` が `[{ word, source, first_seen_at, count, pos3, first_tier }]` と `cleared_paths: [{ game_id, daily_date?, words[] }]` を返す。
- 所持語 1,000 語を超えたらページングを検討（v1 では不要）。

---

## 10. AI 拡張（Stretch）

順番はこの通り。それぞれ独立に入れられる。

### 10.1 「解釈」— 埋め込みによる OOV 入力の変換

- `08_embeddings.py`：出力語彙 10 万語を **AI Gateway 経由の埋め込みモデル**（`google/gemini-embedding` または `openai/text-embedding-3-large`、日本語品質で試して選ぶ）で埋め込み、`vocab.emb` に保存（768 次元に切り詰め、halfvec）。コストは数十円。`emb` に HNSW を張る（`WHERE is_output`）。
- ランタイム：`POST /moves` の OOV 分岐で、input を埋め込み → `emb` 空間で出力語彙の近傍 5 語 → その **w2v ベクトルを類似度で重み付け平均** → それを `v_input` として通常の混合へ。レスポンスに `interpreted_as: "機内食"` を含め、UI は「『宇宙飛行士の朝食』→ 機内食 として解釈」と表示。
- 埋め込み結果は `input_embeddings(text, emb)` にキャッシュ。
- 端末側の語彙判定は「辞書にない語です」を「解釈して混ぜます」に変える。
- これで入力は任意テキスト（句・絵文字・固有名詞）になる。ゴール語そのものの入力禁止は維持。

### 10.2 LLM によるフレーバー

- **ゴール語の説明文**を LLM で 40 字に要約・演出（§6.5 の置き換え）。
- **錬金術師の一言**：混合結果に対して短いリアクション（15 字以内、例「蚕から絹へ。いい糸を引いた。」）。`(current, input, result)` をキーに生成してキャッシュ。結果アニメーション後に非同期で表示、来なくても UI は成立。トーンは仕様として `prompts/alchemist.md` に固定。
- **ゴールプールの知名度採点**（§6.1 のフィルタ強化）。

### 10.3 みんなの軌跡

デイリー参加者全員の経路を図鑑に淡く重ねる（`GET /api/collection/daily-trails`、上位 200 本、自分以外は匿名）。ブースで人が増えるほど画面が育つ。

### 10.4 X 投稿の強化

`GET /share/:gameId` に OG 画像（結果カードのサーバー側レンダリング）を付け、共有テキストの URL をこれにする。シェアシートからの投稿はすでに動くので、優先度は低い。

---

## 11. 運用・配布

### 11.1 EAS Update

- `eas update:configure`。`runtimeVersion` は `{ "policy": "sdkVersion" }`（Expo Go 互換に必須）。
- チャンネル：`production`（ブース・配布用）、`preview`（開発者確認用）。
- 展示前日に `production` へ publish し、以後は緊急修正のみ。
- QR は `qr.expo.dev` の URL（`projectId` + `channel`）から生成。

### 11.2 ランディングページ（`apps/landing`）

`index.html` 1 枚 + `vercel.json` の静的サイトを、Vercel の別プロジェクトとして `coto2ba-next.chotech.dev` に置く。内容：

1. タイトルと一行説明
2. **① Expo Go を入れる**（App Store リンク）
3. **② コトコトバを開く**（`exp://` の EAS Update リンク。Expo Go が入っていれば直接開く）
4. （Optional）ブラウザで試す
5. ChoTech / 長崎大学 のクレジット

QR はこのページ 1 枚に向ける。

### 11.3 ブース運用

- **主戦場は iPhone / iPad 2〜3 台**（Expo Go 導入済み、ブースモード ON、`production` チャンネルを開いた状態）。
- 来場者にはまず端末で遊んでもらい、持ち帰り用 QR は気に入った人へ。
- 会場 Wi-Fi が不安なら iPhone のテザリング。ラップトップは不要（EAS Update は Expo のサーバーから配信）。

### 11.4 インフラ

- **Vercel Hobby** に 2 プロジェクト：`api`（Root Directory `apps/api`、Node runtime、ドメイン `coto2ba-next-api.chotech.dev`）と `landing`（Root Directory `apps/landing`、静的、ドメイン `coto2ba-next.chotech.dev`）。
- **Neon Postgres**（Vercel Marketplace、Hobby → Neon Free 相当）：`vercel integration add neon` で `api` プロジェクトに紐づけ、`CREATE EXTENSION vector` を流す。リージョンは作成時に東京の有無を確認し、なければシンガポール。Function のリージョンを DB に合わせる。
- Neon Free は **5 分無通信でコンピュートが休止し、次のクエリで 1 秒弱かけて復帰**する。ブースでは通信が続くので実害はないが、開場直後の 1 手目だけ遅い。気になるなら開場前に 1 回叩く。Supabase のような「1 週間で一時停止」はない。
- Hobby の制約：**非商用のみ**（学生展示は可）、**メンバー招待不可**（プロジェクトは代表者の個人アカウントに置き、他メンバーは GitHub Actions 経由でデプロイする）、組織リポジトリの Git 連携不可（§11.5 で回避）。
- **負荷試験**：`k6` で `POST /moves` を **5 req/s × 5 分**、p95 < 500ms を確認。展示規模（同時 10〜20 人）の 3 倍相当。
- ログ：Vercel のログで十分。エラー率だけ見る。

### 11.5 CI/CD（GitHub Actions）

Vercel Hobby は GitHub 組織リポジトリ（`nu-chotech/coto2ba-next`）を Git 連携できないので、**Vercel の Git 連携は使わず**、GitHub Actions から `vercel` CLI でデプロイする。CLI はビルド成果物を直接アップロードするだけなので、リポジトリの所有者は関係ない。手元から `vercel --prod` を叩く手動デプロイも同じ経路で、いつでも代替できる。

| ワークフロー | トリガー | 内容 |
| --- | --- | --- |
| `ci.yml` | push / PR | `pnpm install` → Biome → `tsc --noEmit` → vitest（api）→ `ruff`（pipeline） |
| `deploy-api.yml` | `main` への push（`apps/api/**`, `packages/**`） | `vercel pull --environment=production` → `drizzle-kit migrate` → `vercel build --prod` → `vercel deploy --prebuilt --prod`。PR では `--environment=preview` で preview URL を出し、PR にコメント |
| `deploy-landing.yml` | `main` への push（`apps/landing/**`） | 同じ手順（ビルドなし） |
| `eas-update.yml` | `main` への push（`apps/mobile/**`, `packages/**`） | `expo/expo-github-action` で `eas update --channel preview --auto`。`production` への publish は `workflow_dispatch` の手動実行のみ |

GitHub Secrets：`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID_API`、`VERCEL_PROJECT_ID_LANDING`、`DATABASE_URL`（migrate 用）、`EXPO_TOKEN`。`VERCEL_ORG_ID` / `PROJECT_ID` は各アプリで `vercel link` した `.vercel/project.json` から取る。

`deploy-api.yml` の骨子：

```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: pnpm }
- run: pnpm install --frozen-lockfile
- run: pnpm --filter api exec drizzle-kit migrate
  env: { DATABASE_URL: ${{ secrets.DATABASE_URL }} }
- run: npx vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
  working-directory: apps/api
- run: npx vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
  working-directory: apps/api
- run: npx vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
  working-directory: apps/api
  env:
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_API }}
```

---

## 12. Tier B（Apple Developer Program を契約した場合）

Tier A のコードに**足すだけ**で有効になるように書いておく。契約しなければこの節は無視。

### 12.1 Development Build / TestFlight

- `eas build --profile development` で dev client、`--profile production` + `eas submit` で TestFlight。
- TestFlight 公開リンクで最大 1 万人、審査なし、90 日有効。ランディングの「① Expo Go を入れる」を「TestFlight から入れる」に差し替える。
- Bundle ID `dev.chotech.coto2ba`。

### 12.2 パスキー

- クライアント：`expo-passkey`（Better Auth プラグイン兼 Expo モジュール）。`Constants.executionEnvironment === "storeClient"` のときは import しない（動的 require）。設定画面に「パスキーでこの端末を守る」ボタンを出す（匿名 → 本アカウントへ昇格）。
- サーバー：Better Auth `passkey` プラグイン。`rpID: "coto2ba-next.chotech.dev"`、`origin: "https://coto2ba-next.chotech.dev"`（iOS ネイティブは clientDataJSON の origin がこの形）。
- `apps/landing/.well-known/apple-app-site-association`（拡張子なし。`vercel.json` の `headers` で `Content-Type: application/json` を付ける）、リダイレクトなしで
  `{"webcredentials":{"apps":["<TEAM_ID>.dev.chotech.coto2ba"]}}`。Apple の CDN が取りに来る。
- `app.json`：`ios.associatedDomains: ["webcredentials:coto2ba-next.chotech.dev"]`。開発ビルドでは `?mode=developer` を付けて CDN キャッシュを迂回。
- **rpID はパスキーに永久に紐づく**。ランディングのドメインを後から変えない。API ホストは rpID と別でよく、改名自由。

### 12.3 Live Activity

現在の語とランクを Dynamic Island に出す。Widget Extension が必要（`@bacons/apple-targets` 等）。ブース映えは最高だが工数は重い。最後の最後。

---

## 13. 実装フェーズ

稼働 1〜2 週間を前提に、**Phase 2 が終わった時点で展示に出せる**状態を作る。

### Phase 0 — 土台（0.5 日）

- モノレポ雛形（pnpm + Turborepo + Biome）、`packages/contracts` に定数と最初のスキーマ
- Vercel に `api` / `landing` の 2 プロジェクト、`vercel integration add neon` で Postgres、`CREATE EXTENSION vector`、DNS 2 レコード（`coto2ba-next` / `coto2ba-next-api`）を Vercel へ、GitHub Secrets 登録、`ci.yml` が通る状態
- `tools/pipeline` の uv 環境、`01_download.py`

### Phase 1 — コアループ（3〜4 日）

- パイプライン：`02_prune` → `03_export`（vocab が DB に入る）、`04_goal_pool`（ボット含む）、`05_daily_schedule`
- API：Better Auth（または fallback）、`games` / `moves` / `hints` / `daily` / `leaderboard`、ベクトル演算 SQL、calc_cache、ルール層のユニットテスト
- モバイル：ロビー → ゲーム → 結果 を **素の UI** で一周させる。端末側語彙判定、8 段階スライダー、履歴
- ここで一度 `preview` チャンネルに publish して Expo Go で通しプレイ

### Phase 2 — 展示品質（3〜4 日）

- ガラス（フォールバック込み）、tier 背景（Skia）、混合演出、ハプティクス・SE 対応表
- 結果画面、シェア画像・テキスト、実績 12 個
- ブースモード、ランキング画面、設定画面（名前、引き継ぎ QR）
- `07_descriptions.py` バッチ、説明の遅延取得
- ランディングページ、`production` チャンネル、負荷試験
- **→ ここで展示可能**

### Phase 3 — 図鑑（2〜3 日）

- `06_umap_coords.py`、`GET /api/collection`
- SpaceCanvas（orbit、投影、点、ラベル 40、タップ、シート、経路、検索）
- 結果画面からの遷移

### Phase 4 — Stretch（残り時間）

§10 の順に。§12 は契約した場合のみ。

### 展示可能の定義（Definition of Done）

- Expo Go でロビー → デイリー 1 回 → 結果 → シェア までがクラッシュなく回る
- ブースモードで来場者を 5 人連続で切り替えられる
- ランキングに 5 人分が正しい順で載る
- ガラスが iOS 26 で出て、それ未満でフォールバックが出る
- 混合の体感応答が 1 秒以内（演出込み）
- 負荷試験 5 req/s × 5 分で p95 < 500ms、エラー 0

---

## 14. 未決事項

| 項目 | 状態 | 影響 |
| --- | --- | --- |
| 技育博の正確な日程 | 約 1 か月後（要確認） | Phase 3 / 4 の切り方 |
| Apple Developer Program | 契約しない前提 | §12 の有無 |
| NG ワードリストの初期版 | チームで用意 | 出力語彙・ゴールプール |
| SE 素材 | 解決済み（自作の合成音 10 本。外部素材ゼロ） | §8.6 |
| Noto Sans JP の同梱 | 図鑑のラベル用 | §9.2 |
| Better Auth の Expo Go 動作確認 | 最初に 2 時間で判定 | §7.4 のフォールバック採用可否 |
| Neon の東京リージョン有無 | DB 作成時に確認 | Vercel Function のリージョン（§7.1） |
| 埋め込みモデルの選定 | Stretch | §10.1 |
| チーム内の担当分担 | — | Python パイプラインは Python 担当者、それ以外は Claude Code 主体 |

---

## 付録 A — Claude Code への作業指示

1. まずこのファイルを読み、**Phase 0 → 1 → 2 の順**に進める。Phase をまたぐ前に通しプレイで確認する。
2. 定数は `packages/contracts` に置き、UI とサーバーの両方から参照する。数値のハードコードを見つけたら移す。
3. Expo Go に同梱されていないライブラリを追加しようとしたら止まって確認する。
4. ネイティブモジュール依存の機能（§12）は `Constants.executionEnvironment` でガードし、Expo Go で必ず非表示になることをテストする。
5. API のルール層（`services/game.ts`）は vitest でカバーする：禁止入力、ratio 検証、クリア判定、20 手ギブアップ、デイリー 1 回制限、ランキング順序。
6. パイプラインは冪等に書く。途中成果物は `tools/pipeline/data/` に置き、`.gitignore` する。
7. 各 Phase の終わりに `docs/PROGRESS.md` を更新する（何が動き、何が未着手か）。
8. 分からないことは推測で進めず、`docs/QUESTIONS.md` に書いて止まる。

## 付録 B — ハッカソン版からの流用

`coto2-ba-frontend/src` で流用できるもの：`components/game/*` の構造と命名（`WordDisplay`, `MixSlider`, `HintWords`, `HistoryList`, `RankDisplay`, `MixingOverlay`）は RN 版でも同じ分割にする。`hooks/useGameState.ts` の状態遷移はサーバー側 `services/game.ts` の参考。`backend/app/services/vector_engine.py` の `_hint_words_for` / `_nearest_word` はパイプラインのボットとサーバー SQL の仕様の元。ランタイムのコードとしては流用しない。
