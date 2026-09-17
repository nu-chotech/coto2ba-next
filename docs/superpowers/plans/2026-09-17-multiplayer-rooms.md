# マルチプレイ（対戦ルーム） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブースで複数人が同じお題を同時に解き、**最初にゴールへ着いた人が勝つ**レースを成立させる。

**Architecture:** Vercel では永続 WebSocket が使えないので 1 秒ポーリングで同期する。ホストが部屋を作り、参加者は QR かコードで入る。全員が同じ `start` / `goal` を解き、進行中は各人の「現在ランク」だけが見える。ゲーム本体は既存の `games` をそのまま使い、`room_id` で紐づける。勝敗の判定はサーバー。

**Tech Stack:** Hono, Drizzle, Neon Postgres, Zod 4, TanStack Query, expo-router

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §9

## Global Constraints

- Expo Go で動くこと。新しいネイティブモジュールを追加しない
- **ルール判定はサーバー**（`apps/api/src/services/`）。クライアントの値を信用しない
- 定数は `packages/contracts/src/constants.ts` に一元化。マジックナンバー禁止
- 進行中に**他人が打った語を見せない**（真似で解かれると競技にならない）。
  見せるのは現在ランクと手数だけ
- ポーリングは**専用のレート制限バケツ**を使う。既存の `rateLimit`（5 req/s）を
  共有すると、レース中に手を打ったとき 429 が出る
- **落とせる形で作る**。間に合わない場合にこの機能だけ外して展示できること
  （既存の画面から独立させ、ロビーの入口 1 つで切り離せるようにする）
- TypeScript strict、Biome、`pnpm lint` / `pnpm typecheck` / `pnpm test` が緑であること

---

### Task 1: ルームのルールを純粋関数にする

DB を触る前に、状態遷移と順位付けをテストできる形で決める。

**Files:**
- Create: `apps/api/src/services/room-rules.ts`
- Test: `apps/api/tests/room-rules.test.ts`

**Interfaces:**
- Consumes: なし（純粋な関数）
- Produces:
  - `type RoomStatus = 'waiting' | 'playing' | 'finished'`
  - `canJoin(room: { status: RoomStatus; playerCount: number }): boolean`
  - `canStart(room: { status: RoomStatus; playerCount: number }, actorId: string, hostId: string): boolean`
  - `rankPlayers(players: readonly RoomPlayerState[]): RoomPlayerState[]`
  - `type RoomPlayerState = { userId: string; displayName: string; moveCount: number; bestRank: number; finishedAt: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { ROOM_MAX_PLAYERS, ROOM_MIN_PLAYERS } from '@coto2ba/contracts'
import { canJoin, canStart, rankPlayers } from '../src/services/room-rules'

const player = (over: Partial<Parameters<typeof rankPlayers>[0][number]> = {}) => ({
  userId: 'u1',
  displayName: '静かな蚕',
  moveCount: 0,
  bestRank: 9999,
  finishedAt: null,
  ...over,
})

describe('canJoin', () => {
  it('待機中で満員でなければ入れる', () => {
    expect(canJoin({ status: 'waiting', playerCount: 1 })).toBe(true)
  })

  // 途中参加を許すと、後から入った人が短い時間で勝ててしまう。
  it('開始後は入れない', () => {
    expect(canJoin({ status: 'playing', playerCount: 1 })).toBe(false)
    expect(canJoin({ status: 'finished', playerCount: 1 })).toBe(false)
  })

  it('満員なら入れない', () => {
    expect(canJoin({ status: 'waiting', playerCount: ROOM_MAX_PLAYERS })).toBe(false)
  })
})

describe('canStart', () => {
  it('ホストだけが開始できる', () => {
    const room = { status: 'waiting' as const, playerCount: ROOM_MIN_PLAYERS }
    expect(canStart(room, 'host', 'host')).toBe(true)
    expect(canStart(room, 'someone', 'host')).toBe(false)
  })

  it('人数が足りなければ開始できない', () => {
    expect(canStart({ status: 'waiting', playerCount: ROOM_MIN_PLAYERS - 1 }, 'h', 'h')).toBe(false)
  })

  it('すでに開始していれば開始できない', () => {
    expect(canStart({ status: 'playing', playerCount: ROOM_MIN_PLAYERS }, 'h', 'h')).toBe(false)
  })
})

describe('rankPlayers', () => {
  it('クリアした人が未クリアより上', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: null, bestRank: 2 }),
      player({ userId: 'b', finishedAt: '2026-10-01T00:00:10.000Z', bestRank: 1 }),
    ])
    expect(ranked[0].userId).toBe('b')
  })

  it('クリア同士は早い順', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', finishedAt: '2026-10-01T00:00:20.000Z' }),
      player({ userId: 'b', finishedAt: '2026-10-01T00:00:10.000Z' }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'a'])
  })

  it('未クリア同士はランクが良い順、同率なら手数が少ない順', () => {
    const ranked = rankPlayers([
      player({ userId: 'a', bestRank: 5, moveCount: 3 }),
      player({ userId: 'b', bestRank: 5, moveCount: 2 }),
      player({ userId: 'c', bestRank: 2, moveCount: 9 }),
    ])
    expect(ranked.map((p) => p.userId)).toEqual(['c', 'b', 'a'])
  })

  it('完全に同値なら userId で決める（表示が毎秒入れ替わらないように）', () => {
    const ranked = rankPlayers([player({ userId: 'b' }), player({ userId: 'a' })])
    expect(ranked.map((p) => p.userId)).toEqual(['a', 'b'])
  })

  it('入力を破壊しない', () => {
    const input = [player({ userId: 'b' }), player({ userId: 'a' })]
    rankPlayers(input)
    expect(input.map((p) => p.userId)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: 定数を追加する**

`packages/contracts/src/constants.ts`:

```ts
/** 1 部屋の最大人数。ブースの回転を考えるとこれ以上は待ち時間が長い。 */
export const ROOM_MAX_PLAYERS = 8
/** 開始に必要な最小人数。 */
export const ROOM_MIN_PLAYERS = 2
/** 参加コードの長さ。読み上げと手入力ができる長さにする。 */
export const ROOM_CODE_LENGTH = 4
/** 部屋の状態をポーリングする間隔（ms）。 */
export const ROOM_POLL_INTERVAL_MS = 1_000
/** 部屋の寿命（分）。放置された部屋を掃除する基準。 */
export const ROOM_TTL_MINUTES = 60
/** 状態取得の専用レート制限（ユーザーごと・毎秒）。ポーリング 1/s に余裕を持たせる。 */
export const RATE_LIMIT_ROOM_POLL_PER_SECOND = 4
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/api test room-rules`
Expected: FAIL

- [ ] **Step 4: 実装する**

`rankPlayers` は**必ず新しい配列を返す**（`toSorted` か `[...players].sort()`）。
並びは (クリア済み優先, クリア時刻昇順, bestRank 昇順, moveCount 昇順, userId 昇順)。

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/api test room-rules`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/room-rules.ts apps/api/tests/room-rules.test.ts packages/contracts/src/constants.ts
git commit -m "feat(api): 対戦ルームの状態遷移と順位付けのルール"
```

---

### Task 2: テーブルを足す

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: マイグレーション（`apps/api/drizzle`）

**Interfaces:**
- Consumes: 既存の `user` / `games`
- Produces: `rooms` / `roomPlayers` の Drizzle テーブル

- [ ] **Step 1: スキーマを書く**

```ts
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 参加コード。大文字英数 4 桁。同時に生きている部屋の中で一意。 */
    code: text('code').notNull(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    difficulty: text('difficulty').notNull(),
    goal: text('goal').notNull(),
    start: text('start').notNull(),
    /** ゴールに近すぎる語。games と同じものを部屋で 1 度だけ計算して配る。 */
    forbiddenInputs: text('forbidden_inputs').array().notNull().default(sql`ARRAY[]::text[]`),
    status: text('status').notNull().default('waiting'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // 終わった部屋のコードは再利用できる。生きている部屋だけ一意にする。
    uniqueIndex('rooms_code_live_uq')
      .on(t.code)
      .where(sql`status <> 'finished'`),
    index('rooms_created_at_idx').on(t.createdAt),
  ],
)

export const roomPlayers = pgTable(
  'room_players',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
)
```

`games` に `roomId` を足す（`uuid('room_id').references(() => rooms.id, { onDelete: 'set null' })`）。
**既存の `games_user_daily_uq` は `dailyDate` が null なら効かない**ので、
1 ユーザーが複数のルーム戦を持てる。これは意図どおり。

- [ ] **Step 2: マイグレーションを生成して中身を読む**

Run: `pnpm --filter @coto2ba/api exec drizzle-kit generate`
生成された SQL を**必ず目で読む**。既存テーブルを落とす文が入っていないこと。

- [ ] **Step 3: ローカルに適用する**

Run: `pnpm --filter @coto2ba/api exec drizzle-kit migrate`
Expected: 成功。`\d rooms` で確認できること

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "feat(api): 対戦ルームのテーブル"
```

---

### Task 3: エンドポイントを作る

**Files:**
- Create: `apps/api/src/routes/rooms.ts`
- Create: `apps/api/src/services/rooms.ts`
- Modify: `apps/api/src/app.ts`（ルート登録）
- Modify: `apps/api/src/middleware/rateLimit.ts`（ポーリング用バケツ）
- Modify: `packages/contracts/src/schemas.ts`
- Test: `apps/api/tests/rooms.test.ts`

**Interfaces:**
- Consumes: `room-rules`（Task 1）、`rooms` / `roomPlayers`（Task 2）、
  既存の `createGame` / `pickGoalAndStart` 相当（`services/game.ts` の作法に合わせる）
- Produces:
  - `POST /api/rooms` → `{ code, room }`
  - `POST /api/rooms/:code/join` → `{ room }`
  - `POST /api/rooms/:code/start` → `{ room }`
  - `GET  /api/rooms/:code` → `{ room }`（ポーリング先）
  - `roomResponseSchema` / `type RoomResponse`（contracts）

- [ ] **Step 1: 契約を決める**

`RoomResponse` は以下を含む。**他人が打った語は含めない。**

```ts
export const roomPlayerSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  move_count: z.number().int().nonnegative(),
  best_rank: z.number().int().nonnegative(),
  finished_at: z.string().nullable(),
  is_me: z.boolean(),
})

export const roomResponseSchema = z.object({
  code: z.string(),
  status: z.enum(['waiting', 'playing', 'finished']),
  host_user_id: z.string(),
  difficulty: difficultySchema,
  /** waiting のあいだは伏せる（先に考え始められないように）。 */
  goal: wordSchema.nullable(),
  start: wordSchema.nullable(),
  players: z.array(roomPlayerSchema),
  my_game_id: z.string().nullable(),
  join_url: z.string(),
})
```

- [ ] **Step 2: Write the failing test**

`apps/api/tests/rooms.test.ts`（DB が要るので既存のスキップ機構に乗せる）:

```ts
describe('対戦ルーム', () => {
  it('作って、参加して、開始できる', async () => {
    const host = await createTestUser(db)
    const guest = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    await joinRoom(db, guest.id, created.code)
    const started = await startRoom(db, host.id, created.code)
    expect(started.status).toBe('playing')
    expect(started.players).toHaveLength(2)
  })

  it('ホスト以外は開始できない', async () => {
    const host = await createTestUser(db)
    const guest = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    await joinRoom(db, guest.id, created.code)
    await expect(startRoom(db, guest.id, created.code)).rejects.toThrow()
  })

  it('開始後は参加できない', async () => {
    const host = await createTestUser(db)
    const guest = await createTestUser(db)
    const late = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    await joinRoom(db, guest.id, created.code)
    await startRoom(db, host.id, created.code)
    await expect(joinRoom(db, late.id, created.code)).rejects.toThrow()
  })

  it('全員が同じお題を解く', async () => {
    const host = await createTestUser(db)
    const guest = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    await joinRoom(db, guest.id, created.code)
    await startRoom(db, host.id, created.code)
    const a = await roomState(db, host.id, created.code)
    const b = await roomState(db, guest.id, created.code)
    expect(a.goal).toBe(b.goal)
    expect(a.start).toBe(b.start)
  })

  // 進行中に他人の語が見えると、真似されて競技にならない。
  it('他人が打った語は返さない', async () => {
    const host = await createTestUser(db)
    const guest = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    await joinRoom(db, guest.id, created.code)
    await startRoom(db, host.id, created.code)
    const state = await roomState(db, guest.id, created.code)
    const serialized = JSON.stringify(state)
    // 他人の現在語が漏れていないこと
    const hostGame = await myRoomGame(db, host.id, created.code)
    expect(serialized).not.toContain(hostGame.current)
  })

  it('待機中はお題を伏せる', async () => {
    const host = await createTestUser(db)
    const created = await createRoom(db, host.id, 'normal')
    const state = await roomState(db, host.id, created.code)
    expect(state.goal).toBeNull()
    expect(state.start).toBeNull()
  })

  it('先にクリアした人が 1 位', async () => {
    // 2 人ぶんのゲームを作り、片方だけ cleared にしてから順位を見る
    const ranked = await rankedRoom(db, /* … */)
    expect(ranked.players[0].finished_at).not.toBeNull()
  })
})
```

`createTestUser` などのヘルパは既存テストの作法に合わせる。無ければテスト側に作る。

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/api test rooms`
Expected: FAIL

- [ ] **Step 4: サービスを実装する**

- `createRoom`: ゴールとスタートを**既存の抽選ロジックで 1 度だけ選ぶ**
  （`services/game.ts` のフリーモードの抽選を再利用する。**複製しないこと**）。
  `forbiddenInputs` も部屋で 1 度だけ計算する。コードは重複したら引き直す（数回まで）
- `joinRoom`: `canJoin` を見てから追加する。**同じユーザーの二重参加は冪等**にする
- `startRoom`: `canStart` を見てから、**参加者全員ぶんの `games` を作る**。
  全員同じ `start` / `goal` / `forbiddenInputs`。`mode` は `'room'`
- `roomState`: `rankPlayers` で並べて返す。`status` が `waiting` のあいだは
  `goal` / `start` を `null` にする。**`is_me` 以外の player の現在語は絶対に含めない**
- 誰かがクリアしたら `room_players.finished_at` を埋め、
  **全員が終了 or 最初のクリアから一定時間で** `status = 'finished'` にする

`mode = 'room'` を既存の `mode` の型に足す。`packages/contracts` の型も更新する。

- [ ] **Step 5: ポーリング用のレート制限を足す**

`rateLimit.ts` に追加する。**既存の `rateLimit` と別のバケツ**にすること
（同じバケツだと 1 秒ポーリングがゲーム操作の枠を食う）。

```ts
/** 部屋の状態取得: ユーザーごと 4 req/s。ポーリング 1/s に余裕を持たせる。 */
export const rateLimitRoomPoll = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const id = c.get('authUser')?.id ?? 'anon'
    if (
      !take(
        `rp:${id}`,
        RATE_LIMIT_ROOM_POLL_PER_SECOND,
        RATE_LIMIT_ROOM_POLL_PER_SECOND / 1000,
      )
    ) {
      throw appError('RATE_LIMITED')
    }
    await next()
  },
)
```

`GET /api/rooms/:code` にはこれを、他のルームのエンドポイントには既存の `rateLimit` を使う。

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/api test`
Expected: PASS（既存のテストも緑）

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat(api): 対戦ルームのエンドポイント"
```

---

### Task 4: モバイルの対戦画面

**Files:**
- Create: `apps/mobile/src/features/rooms/`（`queries.ts` / `RoomLobby.tsx` / `RoomRace.tsx` / `RoomResult.tsx` / `index.ts`）
- Create: `apps/mobile/src/app/(tabs)/play/room/_layout.tsx`, `index.tsx`, `[code].tsx`
- Modify: `apps/mobile/src/app/(tabs)/play/index.tsx`（入口）
- Modify: `apps/mobile/src/lib/api.ts`

**Interfaces:**
- Consumes: `roomResponseSchema`（Task 3）、既存の `QrCode`（`features/profile/QrCode.tsx`）
- Produces: なし

- [ ] **Step 1: API クライアントを足す**

`lib/api.ts` に `createRoom` / `joinRoom` / `startRoom` / `getRoom` を、
既存の `request` の作法どおりに足す。

- [ ] **Step 2: ポーリングするクエリを作る**

```ts
export function useRoomQuery(code: string | null) {
  return useQuery({
    queryKey: queryKeys.room(code),
    queryFn: ({ signal }) => getRoom(code as string, signal),
    enabled: code !== null,
    // 部屋が終わったら止める。展示中に無駄な通信を残さない。
    refetchInterval: (query) =>
      query.state.data?.status === 'finished' ? false : ROOM_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}
```

`queryKeys.room` を `lib/queryClient.ts` に足す。

- [ ] **Step 3: 待機画面を作る**

- **コードを大きく表示**し、QR も出す（既存の `QrCode` を再利用。**自作の QR 実装が
  `features/profile/qr.ts` にあるのでそれを使う**）
- 参加者が増えるのがリアルタイムで見える
- ホストにだけ「開始」ボタンを出す。人数が足りないあいだは無効

- [ ] **Step 4: レース画面を作る**

- 既存のゲーム画面をそのまま使い、**上に順位バーを重ねる**
- 順位バーには各人の現在ランクだけを出す。**他人の語は出さない**
- 誰かがクリアしたら即座に分かるようにする

既存のゲーム画面（`play/game/[id].tsx`）を**複製しない**。
ルーム用のオーバーレイを足す形にすること。

- [ ] **Step 5: 結果画面を作る**

順位一覧を出す。勝者を大きく見せる。
**「もう一度」で同じ面子のまま新しい部屋を作れる**ようにする（ブースの回転のため）。

- [ ] **Step 6: ロビーに入口を置く**

`play/index.tsx` に「みんなで対戦」を置く。
**この入口を消すだけで機能ごと切り離せる**構造にすること（落とせる形で作る、の要件）。

- [ ] **Step 7: 通しで確認する**

Web プレビューを 2 つのブラウザプロファイルで開き、
部屋作成 → 参加 → 開始 → 両方で数手打つ → 片方がクリア → 結果、を通す。

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
Expected: 1 秒で相手の進捗が反映されること、429 が出ないこと

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): 対戦ルームの画面とポーリング同期"
```

---

### Task 5: ブース運用に耐えるようにする

**Files:**
- Modify: `apps/api/src/services/rooms.ts`
- Modify: `apps/mobile/src/features/rooms/`

**Interfaces:**
- Consumes: Task 3 / Task 4 の成果
- Produces: なし

- [ ] **Step 1: 放置された部屋を掃除する**

`ROOM_TTL_MINUTES` を過ぎた `waiting` / `playing` の部屋を `finished` にする。
**cron は使わない**（Vercel Hobby の制約と運用の複雑さを増やさない）。
部屋を作るときと状態を取るときに、ついでに古い部屋を畳む。

- [ ] **Step 2: 部屋の作り直しを 1 タップにする**

結果画面の「もう一度」で、同じ参加者に新しい部屋のコードが伝わる形にする。
行列ができている前提で、**ホストが何度も同じ操作を繰り返せること**が要件。

- [ ] **Step 3: 通信が切れても復帰できるようにする**

会場 Wi-Fi は不安定な前提。ポーリングが数回失敗しても画面を壊さず、
復帰したら追いつくこと（TanStack Query の既定の再試行に任せてよいが、
**エラー表示で画面を覆わない**こと）。

- [ ] **Step 4: 負荷を実測する**

`apps/api/tests/load.py` の作法に合わせて、
**8 人が 1 秒ポーリングしながら手を打つ**状況を模した負荷試験を追加する。

Run: `python3 apps/api/tests/load.py --scenario room`
Expected: エラー 0、p95 が実用域。429 が出ないこと

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/mobile
git commit -m "feat: 対戦ルームをブース運用に耐える形にする"
```
