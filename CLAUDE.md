# coto2ba-next

word2vec の意味空間で言葉を混ぜてゴール語に近づけるワードパズル。Expo Go 配布、Hono on Vercel、Neon pgvector。
詳細仕様は @docs/SPEC.md。作業前に必ず読むこと。進捗は docs/PROGRESS.md、不明点は docs/QUESTIONS.md に書いて止まる。

## 絶対制約
- Expo Go で動くこと。Expo Go 非同梱のネイティブモジュールは追加しない（迷ったら止まって確認）
- ゲームのルール判定はサーバー（apps/api/src/services/game.ts）。クライアントの値を信用しない
- 定数は packages/contracts/src/constants.ts に一元化。マジックナンバー禁止
- word2vec はランタイムでロードしない（pgvector のテーブル）

## コマンド
- pnpm install / pnpm lint / pnpm typecheck / pnpm test
- pnpm --filter api dev / pnpm --filter mobile start
- pnpm pipeline:<step>（tools/pipeline、uv）

## 規約
- TypeScript strict、Biome、pnpm workspaces、Turborepo
- Python は uv + ruff
- コミットは Phase 単位より細かく、動く状態で
