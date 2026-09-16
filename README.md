# コトコトバ（coto2ba-next）

word2vec の意味空間で言葉を混ぜて、ゴールの語に近づけるワードパズル。技育博出展用。

今の語に好きな語を混ぜると、ベクトルの線形補間の最近傍語に変化する。
ゴールから見たランクが 10 位以内に入ればクリア。

| | |
| --- | --- |
| アプリ | Expo Go で開く → https://coto2ba-next.vercel.app |
| API | https://coto2ba-next-api.vercel.app/api/health |
| 仕様 | [docs/SPEC.md](docs/SPEC.md) |
| 進捗・引き継ぎ | [docs/PROGRESS.md](docs/PROGRESS.md) ← **まずこれ** |
| 設計の確定事項 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 未決事項 | [docs/QUESTIONS.md](docs/QUESTIONS.md) |
| 技術調査（一次ソース） | [docs/research/](docs/research/) |

## 構成

```
apps/
  mobile/     Expo SDK 57（Expo Router / Skia / Reanimated）— Expo Go で動く
  api/        Hono + Drizzle + pgvector（Vercel sin1 / Neon sin1）
  landing/    静的 HTML 1 枚
packages/
  contracts/  定数・zod スキーマ・型。**API の入出力の唯一の定義**
tools/
  pipeline/   Python + uv。語彙の刈り込み・pgvector 書き出し・ゴールプール
```

## はじめかた

```bash
pnpm install

# ローカル DB（pgvector）
docker run -d --name coto2ba-pg --shm-size=2g \
  -e POSTGRES_PASSWORD=coto2ba -e POSTGRES_USER=coto2ba -e POSTGRES_DB=coto2ba \
  -p 55432:5432 -v coto2ba-pgdata:/var/lib/postgresql/data pgvector/pgvector:pg17
cp .env.example .env.local     # DATABASE_URL をローカルに向ける
pnpm --filter @coto2ba/api exec drizzle-kit migrate

# 語彙を入れる（初回は 588MB のダウンロードがある）
pnpm pipeline:download && pnpm pipeline:prune && pnpm pipeline:export
pnpm pipeline:goal-pool && pnpm pipeline:daily && pnpm pipeline:names

# 起動
pnpm --filter @coto2ba/api dev       # http://localhost:8787
pnpm --filter @coto2ba/mobile start  # QR を Expo Go で読む
```

モバイルは既定で**本番 API** を向く。ローカル API を使いたいときは
`apps/mobile/.env` に `EXPO_PUBLIC_API_URL=http://<PCのLAN IP>:8787`
（`localhost` は実機からは届かない）。

## コマンド

| | |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Biome / tsc / vitest |
| `python3 apps/api/tests/smoke.py [URL]` | API の E2E スモーク（25 項目） |
| `python3 apps/api/tests/load.py [URL]` | 負荷試験（5 req/s × 5 分、p95 < 500ms） |
| `pnpm pipeline:<step>` | download / prune / export / goal-pool / daily / umap / descriptions / names |
| `npx expo-doctor` | Expo Go 互換の健康診断（apps/mobile で実行） |

## 絶対制約

- **Expo Go で動くこと。** Expo Go 非同梱のネイティブモジュールは追加しない。
  追加前に `npx expo install --check` と `npx expo-doctor` を通すこと
- **ゲームのルール判定はサーバー**（`apps/api/src/services/`）。クライアントの値は信用しない
- 定数は `packages/contracts/src/constants.ts` に一元化。マジックナンバー禁止
- word2vec はランタイムでロードしない（pgvector のテーブル）

## ライセンス・出典

- 語彙ベクトル: [WikiEntVec](https://github.com/singletongue/WikiEntVec)
  jawiki 20190520 — **CC BY-SA 3.0**（日本語 Wikipedia 由来）。派生データを公開する場合は継承する
- NG 語リスト: [MosasoM/inappropriate-words-ja](https://github.com/MosasoM/inappropriate-words-ja) (MIT) /
  [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) (CC BY 4.0)
  — 出典は `tools/pipeline/vendor/NOTICE.md`
- 制作: ChoTech / 長崎大学
