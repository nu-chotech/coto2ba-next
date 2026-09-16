"""デイリーの日程を 120 日分作る（SPEC §6.4）。

- 今日（**JST**）から DAILY_SCHEDULE_DAYS 日分。
- 曜日ローテーション: 月〜金 normal / 土 hard / 日 easy。
- シードは日付文字列の sha256。同じ日付なら何度流しても同じ結果になる。
- 同じ goal は期間内に再登場しない（プールが足りないときだけ、警告を出して使い回す）。
- **review_needed（人手レビュー未済）の語は使わない。** サーバーのフリーモード
  （apps/api/src/services/game.ts の chooseGoal）と同じ `enabled AND NOT review_needed`。
  全員に同じ語が出るデイリーで、未レビューの語を混ぜないため。
  clean（レビュー不要）のプールを使い切ったときだけ flagged にフォールバックする。
- プールが空の難易度は、**実際に使ったゴールの難易度を記録する**（「表示は easy・
  中身は hard」を避ける）。
- start は SPEC §6.3 の規則で抽選（ゴールから見た rank が START_RANK_RANGE、
  freq_rank <= START_MAX_FREQ_RANK、一般名詞、NG 外、ゴールと漢字を共有しない）。

使い方:
    uv run python scripts/05_daily_schedule.py
    uv run python scripts/05_daily_schedule.py --days 30 --from 2026-10-01
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from random import Random
from zoneinfo import ZoneInfo

from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url, load_ng_words  # noqa: E402
from _constants import (  # noqa: E402
    DAILY_DIFFICULTY_BY_WEEKDAY,
    DAILY_SCHEDULE_DAYS,
    DAILY_TZ,
    DIFFICULTIES,
)
from _db import connect, ensure_daily_challenges  # noqa: E402
from _vectors import load_output_space, pick_starts  # noqa: E402

# プールが空の難易度で代用するときの擬似キー。
FALLBACK_KEY = "__fallback__"

UPSERT_SQL = """
INSERT INTO daily_challenges (date, goal, start, difficulty)
VALUES (%s, %s, %s, %s)
ON CONFLICT (date) DO UPDATE SET
  goal       = EXCLUDED.goal,
  start      = EXCLUDED.start,
  difficulty = EXCLUDED.difficulty
"""


def jst_today() -> date:
    return datetime.now(ZoneInfo(DAILY_TZ)).date()


def seed_of(text: str) -> int:
    """文字列 → 決定的なシード（sha256 の先頭 8 バイト）。"""
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")


def day_seed(day: date) -> int:
    """日付文字列（YYYY-MM-DD）の sha256 から決定的なシードを作る。"""
    return seed_of(day.isoformat())


def difficulty_for(day: date) -> str:
    """曜日 → 難易度。DAILY_DIFFICULTY_BY_WEEKDAY は index 0 = 日曜。"""
    return DAILY_DIFFICULTY_BY_WEEKDAY[day.isoweekday() % 7]


def load_pool(conn) -> dict[str, list[str]]:
    """難易度 → ゴール語（有効・要レビューでないもの優先）。"""
    pool: dict[str, list[str]] = {d: [] for d in DIFFICULTIES}
    rows = conn.execute(
        "SELECT word, difficulty, review_needed FROM goal_pool "
        "WHERE enabled ORDER BY review_needed, word"
    ).fetchall()
    for word, difficulty, _review in rows:
        if difficulty in pool:
            pool[difficulty].append(word)
    return pool


def main() -> None:
    ap = argparse.ArgumentParser(description="デイリー日程を作る")
    ap.add_argument("--days", type=int, default=DAILY_SCHEDULE_DAYS)
    ap.add_argument("--from", dest="start_date", default="", help="開始日（YYYY-MM-DD、既定は JST の今日）")
    ap.add_argument("--dry-run", action="store_true", help="DB に書かず一覧を出すだけ")
    args = ap.parse_args()

    first = date.fromisoformat(args.start_date) if args.start_date else jst_today()
    days = [first + timedelta(days=i) for i in range(args.days)]
    demand = Counter(difficulty_for(d) for d in days)

    ng = load_ng_words()
    space = load_output_space()

    with connect(database_url()) as conn:
        ensure_daily_challenges(conn)
        pool = load_pool(conn)

    print(f"開始日 {first}（JST） / {args.days} 日分", file=sys.stderr)
    for d in DIFFICULTIES:
        print(f"  {d:<7} 必要 {demand[d]:>3} 日 / プール {len(pool[d]):>4} 語", file=sys.stderr)

    shortage = [d for d in DIFFICULTIES if len(pool[d]) < demand[d]]
    if shortage:
        print(
            f"※ {', '.join(shortage)} のプールが足りません。"
            "「同じ goal は 120 日内で再登場しない」を守れないので使い回します。"
            "04_goal_pool.py を続きから流してください。",
            file=sys.stderr,
        )
    empty = [d for d in DIFFICULTIES if not pool[d]]
    if empty:
        print(
            f"※ {', '.join(empty)} のプールが空です。他の難易度のゴールで代用します"
            "（表示上の難易度は曜日ローテーションのまま）。",
            file=sys.stderr,
        )

    # 難易度ごとに、日付順で消費していくキュー（決定的にシャッフル）。
    queues: dict[str, list[str]] = {}
    for d in DIFFICULTIES:
        words = list(pool[d])
        # hash() はプロセスごとに変わるので使わない（毎回同じ日程になる必要がある）。
        Random(seed_of(f"{first.isoformat()}:{d}")).shuffle(words)
        queues[d] = words
    fallback = [w for d in DIFFICULTIES for w in queues[d]]
    if not fallback:
        raise SystemExit("goal_pool が空です。先に 04_goal_pool.py を流してください。")

    cursors: dict[str, int] = dict.fromkeys(DIFFICULTIES, 0)
    cursors[FALLBACK_KEY] = 0
    used: set[str] = set()
    rows: list[tuple[date, str, str, str]] = []
    no_start: list[str] = []
    reused = 0

    def take(key: str, queue: list[str]) -> str:
        """未使用を優先して 1 語取る。尽きたら使い回す（期間内の重複になる）。"""
        nonlocal reused
        for _ in range(len(queue)):
            candidate = queue[cursors[key] % len(queue)]
            cursors[key] += 1
            if candidate not in used:
                return candidate
        picked = queue[cursors[key] % len(queue)]
        cursors[key] += 1
        reused += 1
        return picked

    for day in tqdm(days, unit="日", desc="日程", file=sys.stderr):
        difficulty = difficulty_for(day)
        queue = queues[difficulty]
        goal = take(difficulty, queue) if queue else take(FALLBACK_KEY, fallback)
        used.add(goal)

        goal_idx = space.index.get(goal)
        if goal_idx is None:
            raise SystemExit(f"goal_pool の '{goal}' が出力語彙にありません（02/03 を流し直してください）")
        rng = Random(day_seed(day))
        starts = pick_starts(space, goal_idx, 1, rng, ng)
        if not starts:
            no_start.append(goal)
            continue
        start = space.words[starts[0]]
        rows.append((day, goal, start, difficulty))

    if reused:
        print(f"※ goal を使い回した日が {reused} 件あります（プール不足）", file=sys.stderr)
    if no_start:
        print(f"※ スタート語が見つからず飛ばした日が {len(no_start)} 件: {no_start[:5]}", file=sys.stderr)

    if args.dry_run:
        for day, goal, start, difficulty in rows[:20]:
            print(f"{day} {difficulty:<7} {start} → {goal}")
        print(f"... 計 {len(rows)} 日（--dry-run なので DB には書きません）", file=sys.stderr)
        return

    with connect(database_url()) as conn:
        ensure_daily_challenges(conn)
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)

    print(f"\ndaily_challenges に {len(rows)} 日分 upsert しました", file=sys.stderr)
    print(f"  {rows[0][0]} 〜 {rows[-1][0]} / ユニークな goal {len({r[1] for r in rows})} 語", file=sys.stderr)


if __name__ == "__main__":
    main()
