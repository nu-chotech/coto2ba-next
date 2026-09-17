/**
 * デイリーランキングの並び順（SPEC §5.8）の統合テスト。
 *
 * 並び順は **SQL の ORDER BY が権威**で、`compareLeaderboard` は同じ規則の JS 版。
 * 2 つが食い違うと「テストは通るのに実際の順位が違う」が起きるので、
 * ここでは実際に DB から引いた順序を検証し、`compareLeaderboard` と一致することも見る。
 *
 * DB が無ければスキップする（CI で落ちないように）。
 */
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/client'
import { games, user } from '../src/db/schema'
import { leaderboard } from '../src/services/game'
import { compareLeaderboard } from '../src/services/rules'

let hasDb = false
const createdUserIds: string[] = []
/** 実データとぶつからないよう、遠い未来の日付を使う。 */
const DATE = '2099-12-31'

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1 FROM "user" LIMIT 1`)
    hasDb = true
  } catch {
    hasDb = false
    console.warn('DB が無いのでランキングの統合テストをスキップします')
  }
})

afterAll(async () => {
  for (const id of createdUserIds) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {})
  }
  await pool.end().catch(() => {})
})

interface Entry {
  name: string
  moveCount: number
  hintCount: number
  clearedAt: string
}

async function seed(entries: readonly Entry[]): Promise<void> {
  for (const e of entries) {
    const id = crypto.randomUUID()
    await db.insert(user).values({
      id,
      name: e.name,
      email: `${id}@test.coto2ba.invalid`,
      emailVerified: false,
      isAnonymous: true,
      displayName: e.name,
      bestFreeMoves: {},
      booth: false,
    })
    createdUserIds.push(id)
    await db.insert(games).values({
      userId: id,
      mode: 'daily',
      dailyDate: DATE,
      difficulty: 'normal',
      goal: 'テストゴール',
      start: 'テストスタート',
      current: 'テストゴール',
      currentRank: 0,
      moveCount: e.moveCount,
      hintCount: e.hintCount,
      status: 'cleared',
      perfect: false,
      clearedAt: new Date(e.clearedAt),
    })
  }
}

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('デイリーランキングの並び順', () => {
  it('ヒント数 → 手数 → クリア時刻 の順に並ぶ', async () => {
    if (!hasDb) return
    // 投入順は期待と無関係にしておく（挿入順で通ってしまわないように）。
    const entries: Entry[] = [
      { name: 'ヒント1回3手', moveCount: 3, hintCount: 1, clearedAt: '2099-12-31T01:00:00Z' },
      {
        name: 'ノーヒント5手おそい',
        moveCount: 5,
        hintCount: 0,
        clearedAt: '2099-12-31T03:00:00Z',
      },
      { name: 'ノーヒント15手', moveCount: 15, hintCount: 0, clearedAt: '2099-12-31T09:00:00Z' },
      {
        name: 'ノーヒント5手はやい',
        moveCount: 5,
        hintCount: 0,
        clearedAt: '2099-12-31T01:00:00Z',
      },
      { name: 'ヒント2回1手', moveCount: 1, hintCount: 2, clearedAt: '2099-12-31T00:30:00Z' },
    ]
    await seed(entries)

    const board = await leaderboard(db, 'だれでもない', DATE)
    expect(board.entries.map((e) => e.display_name)).toEqual([
      'ノーヒント5手はやい',
      'ノーヒント5手おそい',
      // ヒントを使っていないので、15 手かかってもヒント勢より上。
      'ノーヒント15手',
      'ヒント1回3手',
      'ヒント2回1手',
    ])
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it('SQL の並び順と compareLeaderboard が一致する', async () => {
    if (!hasDb) return
    const board = await leaderboard(db, 'だれでもない', DATE)
    const fromSql = board.entries.map((e) => e.display_name)
    const sorted = [...board.entries]
      .sort((a, b) =>
        compareLeaderboard(
          { moveCount: a.move_count, hintCount: a.hint_count, clearedAt: a.cleared_at },
          { moveCount: b.move_count, hintCount: b.hint_count, clearedAt: b.cleared_at },
        ),
      )
      .map((e) => e.display_name)
    expect(fromSql).toEqual(sorted)
  })
})
