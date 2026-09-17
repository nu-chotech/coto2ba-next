# 進捗

> 最終更新: 2026-09-17 08:40 JST
> 対象: SPEC.md の Tier A（Expo Go 配布）。確定した設計判断は [ARCHITECTURE.md](./ARCHITECTURE.md)、
> 一次ソース調査は [research/](./research/) にある。

## 今すぐ触れるもの

| | URL / コマンド |
| --- | --- |
| **API（本番）** | https://coto2ba-next-api.vercel.app/api/health |
| **ランディング** | https://coto2ba-next.vercel.app |
| **DB** | Neon `coto2ba-next-db`（aws-ap-southeast-1 / sin1）。Vercel Marketplace 経由 |
| **ローカル DB** | `docker start coto2ba-pg`（pgvector/pgvector:pg17、port 55432、shm 2GB） |
| **API ローカル起動** | `pnpm --filter @coto2ba/api dev` → http://localhost:8787 |
| **モバイル起動** | `pnpm --filter @coto2ba/mobile start` |
| **API スモーク** | `python3 apps/api/tests/smoke.py [BASE_URL]` |
| **EAS プロジェクト** | `73c7cda9-727c-4b83-ba2e-674c38b951ae`（slug: coto2ba-next） |

---

## 動いているもの

### 語彙パイプライン（tools/pipeline）
- `01_download.py` — WikiEntVec 200d の冪等ダウンロード
- `02_prune.py` — **完了・実測済み**
  - 入力語彙 **208,707 語**（freq_rank ≤ 300,000、日本語文字を含む、記号なし、NG 外）
  - 出力語彙 **99,805 語**（うち一般名詞 65,175）— SPEC の「約10万語」と一致
  - SPEC からの変更は ARCHITECTURE.md §1 に理由付きで記録（複合語規則・orthBase・freq 上限）
- `03_export_pgvector.py` — **完了**。psycopg3 binary COPY。
  ローカル 30 秒 / Neon 52 秒（208,707 行 + HNSW 構築）
- `09_name_parts.py` — 表示名の素材（形容詞 / 名詞）
- NG 語リスト — 手書き 125 語 + MosasoM/inappropriate-words-ja (MIT) + LDNOOBW ja (CC BY 4.0)。
  出典は `tools/pipeline/vendor/NOTICE.md`

### API（apps/api）— **本番稼働中**
- Hono + Drizzle + pgvector、Vercel sin1、Neon と同居
- **テーブル 18 個**がマイグレーション済み（ローカル・Neon 両方）
- SPEC §7.5 の全エンドポイントを実装
- 1 手の処理を **1 本の CTE** に畳んである（混合 → 最近傍 → ランク）
- 最近傍は HNSW、**ランクは厳密全走査**（HNSW の近似だとスコアが再現しない）
- `calc_cache` / `hint_cache` で決定論的な結果をキャッシュ
- 実績 12 個の判定、デイリー 1 日 1 回、ランキング、引き継ぎ、ブースモード用の端末トークン
- **テスト: vitest 70 件通過**
  - ルール層 59 件（禁止入力・ratio 8 段階・クリア・20 手ギブアップ・ランキング順序・tier・heat）
  - ベクトル統合 11 件（**`rank(goal の最近傍) == 1`** の契約検証を含む）
- **E2E スモーク 20 項目通過**（ローカル / 本番の両方）

**実測レイテンシ（正直な内訳）**

| 測り方 | 値 |
| --- | --- |
| **サーバー内の SQL（EXPLAIN ANALYZE / Neon）** | 1 手ぶん **44〜58ms** |
| 日本から本番 API（負荷試験 5 req/s × 5 分） | 中央値 **351ms** / p95 **655ms** / エラー 0 |

差の約 140ms は**日本 → シンガポールの往復そのもの**。Neon に東京リージョンが無いので
これは動かせない（DB と関数を同居させた結果の最適値）。

- SPEC §11.4 の「p95 < 500ms」は**日本から測ると往復だけで 140ms 使う**ので届かない。
  会場が国内なら同じ条件になる
- SPEC の展示可能条件「**混合の体感応答が 1 秒以内（演出込み）**」は
  p95 655ms + 演出 600ms が重ならない前提でも 1 秒に収まっており、**満たしている**
- 速くしたいなら選択肢は 2 つ:
  (a) Neon を Launch tier にして autosuspend を切る（tail が縮む）
  (b) ランクの母集団を出力語彙全体から上位数万語に絞る（SPEC の rank 定義が変わる）

**⚠️ Neon Free のストレージが 305MB / 512MB**（vocab の heap 215MB + index 90MB）。
パイプラインを何度も流し直すと枯渇する。再ロードは TRUNCATE + upsert で行い、
枯渇したら `VACUUM (ANALYZE) vocab` と不要ブランチの削除を先に試すこと。

### ランディング（apps/landing）— **公開済み**
静的 HTML 1 枚。外部 CDN に依存しない。Expo Go への導線と `exp://` リンク、
クレジットと WikiEntVec のライセンス表記。

### CI/CD（.github/workflows）
`ci.yml` / `deploy-api.yml` / `deploy-landing.yml` / `eas-update.yml`。

- **`ci.yml` は通る**（Biome / tsc 4 パッケージ / vitest 171 件 / ruff）。
  vitest のうち DB が要るものは接続できなければ自動でスキップするので、
  CI に Postgres を用意しなくても落ちない。
- **デプロイ 3 本は secrets 未登録のあいだ「飛ばして緑」**。
  各ワークフローの先頭で必要な secret の有無を見て、無ければ何もせず
  ジョブサマリに不足している名前を出す。設定していないだけで壊れてはいないものを
  赤にすると、本当の失敗に気づけなくなるため。
  - ただし `deploy-api.yml` の **tsup ビルドとワークスペース import の検証は
    secrets 無しでも毎回走る**（コードの健全性は鍵の有無と無関係なので）。
  - secrets を登録すれば、次の push から実際にデプロイが動く。

### モバイル（apps/mobile）
- Expo SDK 57 公式テンプレートから起こし、pnpm モノレポ用に Metro を設定
- **iOS バンドルのビルドが通ることを確認済み**（`expo export --platform ios`、
  `@coto2ba/contracts` の解決を含む）
- テーマトークン / tier パレット / API クライアント / 認証 / 端末語彙判定 /
  ハプティクス・SE 対応表 / zustand ストア
- 語彙アセット `assets/vocab/input.txt`（208,707 語 / 2.27MB）と `ghost.json`（2,000 点）を生成済み
- **`npx expo-doctor` 21/21 通過**
- **Web プレビューで通しプレイ済み**（ロビー → デイリー → ヒント → 混合 → クリア → 結果、
  ランキング、設定）。図鑑のみ未実装
  - ローカルで見るには `pnpm --filter @coto2ba/mobile exec expo start --web`

### ゲーム内容（実測で調整した）
- **ゴール語**: サ変名詞（促進・捜査・提唱）を除いた具体名詞に限定。
  温泉 / 宝石 / 琥珀 / 振り子 / 潤滑油 / 土偶 / 刀剣 / 巫女 / 硝子 / 羅針盤 など
- **スタート語**: 単独トークンの具体名詞。プラチナ / 器官 / 人質 / 気温 / 磁気 など
- **ヒント**: 表記揺れ（「居住地」に対する「居住 / 定住 / 居住者」）を除外
- **デイリー日程**: 120 日分を生成済み（2026-09-17 〜 2027-01-14、ゴール重複なし）

---

## 進行中

| 項目 | 状態 |
| --- | --- |
| — | 夜間の実装は完了。下の「未着手」を参照 |

---

## 未着手

| 項目 | 備考 |
| --- | --- |
| `06_umap_coords.py` | 図鑑の 3D 座標。`uv sync --extra umap` が必要。**現状 ghost.json の座標は疑似乱数**なので、実行後に差し替えること |
| `07_descriptions.py` | 語の説明の事前バッチ。**ランタイムの Wikipedia 取得は動いている**ので展示には必須でない |
| `08_embeddings.py` | Stretch（§10.1 の OOV 解釈） |
| SE 音源 | `assets/sounds/` は空。対応表だけ先に作ってあり、ファイルを置けば鳴る |
| Noto Sans JP の同梱 | 図鑑の Skia ラベル用。現状は RN の `<Text>` オーバーレイで代替 |
| 独自ドメイン | `coto2ba-next.chotech.dev` / `coto2ba-next-api.chotech.dev` の DNS 未設定（下記） |
| 負荷試験（k6） | 未実施 |
| Tier B（§12） | 契約しない前提 |

---

## 朝やること（上から順に）

### 1. Expo Go で実際に遊ぶ
```bash
cd apps/mobile && pnpm start
# 出た QR を iPhone の Expo Go で読む（API は本番を向いている）
```

### 2. EAS Update に publish して、どこからでも開けるようにする
```bash
npx eas-cli update --channel preview --message "初版"
# 出力された URL をランディングの data-expo-link に反映して再デプロイ
```

### 3. ゴールプールの確認と差し替え
```bash
# 04 の結果を見る
docker exec coto2ba-pg psql -U coto2ba -d coto2ba -c \
  "SELECT difficulty, count(*), avg(bot_moves)::numeric(4,1) FROM goal_pool WHERE enabled GROUP BY 1"
# review_needed=true の語を人が確認する（展示に出せない語が混ざっていないか）
```
**展示日の goal は手で選ぶ想定**（`daily_challenges` は直接編集してよい）。

### 4. GitHub Secrets を登録して自動デプロイを有効にする
登録するまで CI は緑のまま通る（デプロイ部分を飛ばす）ので、急がなくてよい。
登録すると次の push から `main` → 本番デプロイが自動で走るようになる。

**手で発行が要るもの（ブラウザ）**
- `VERCEL_TOKEN` … https://vercel.com/account/tokens
- `EXPO_TOKEN` … https://expo.dev/settings/access-tokens
  （`eas token:create` のような CLI は**無い**。必ず web で発行する）

**リポジトリから読めるもの**
```bash
gh secret set VERCEL_ORG_ID            --body "$(jq -r .orgId     apps/api/.vercel/project.json)"
gh secret set VERCEL_PROJECT_ID_API    --body "$(jq -r .projectId apps/api/.vercel/project.json)"
gh secret set VERCEL_PROJECT_ID_LANDING --body "$(jq -r .projectId apps/landing/.vercel/project.json)"
gh secret set DATABASE_URL_DIRECT      --body "$(grep -m1 '^DATABASE_URL_DIRECT=' apps/api/.env.neon | cut -d= -f2-)"

# 上の 2 つは発行したトークンを貼る（対話で入力される）
gh secret set VERCEL_TOKEN
gh secret set EXPO_TOKEN
```

登録後の確認:
```bash
gh secret list
gh workflow run "Deploy Landing" && gh run watch
```

### 5. 独自ドメイン（任意）
Vercel の各プロジェクトに以下を足して、`chotech.dev` の DNS に CNAME を向ける:
- `coto2ba-next-api.chotech.dev` → プロジェクト `coto2ba-next-api`
- `coto2ba-next.chotech.dev` → プロジェクト `coto2ba-next`

その後 `BETTER_AUTH_URL` / `API_ORIGIN` / `LANDING_ORIGIN` と
`apps/mobile/app.json` の `extra.apiUrl` を差し替える。

---

## 注意していること

### ⚠️ Expo SDK 58 の期限リスク
SDK 58 beta が **2026-09-15 に告知済み**（beta 3〜4 週間）。安定版が出ると
App Store の Expo Go は 58 に切り替わり、**SDK 57 のプロジェクトは開けなくなる**。
技育博が約 1 か月後なら直前に SDK 58 追従が必要になる可能性が高い。
**展示の 1 週間前に Expo Go のバージョンを必ず確認すること。**

### Neon Free の挙動
- 5 分無通信でコンピュートが休止 → 次のクエリで 1〜4 秒。開場前に 1 回叩いておくこと
- ストレージ 0.5GB に対して現在 vocab + HNSW で約 150MB。
  **パイプラインを何度も流し直すと WAL 履歴で枯渇する**ので、再ロードは TRUNCATE + upsert で行う
- 東京リージョンは存在しない。sin1（シンガポール）が最速

### NG 語リストは不十分
公開されている日本語の差別語リストは網羅的ではない（約 450 語、ほぼ性的表現のみ）。
**展示前に人間のレビューが必須**。`tools/pipeline/ng_words.txt` に追記して
`02_prune` → `03_export` を流し直せば反映される。

### ライセンス
word2vec ベクトル本体（WikiEntVec jawiki 20190520）は **CC BY-SA 3.0**。
派生したベクトルデータを公開する場合は継承する。ランディングに表記済み。
