"""ゴールプールを作る（SPEC §6.1〜6.3）。

候補（出力語彙・freq_rank 500〜30,000・一般名詞・2 文字以上・数字なし・NG 外）ごとに
ヒント追従ボットを 5 スタート分まわし、平均手数で Easy / Normal / Hard に振り分けて
`goal_pool` に upsert する。健全性チェックに引っかかった語は `review_needed = true`。

**中断・再開できる。** 1 語終えるごとに `data/goal_pool_progress.jsonl` に追記し、
再実行時は済んだ語を読み飛ばす。`--fresh` で最初からやり直す。

**`goal_pool` の中身は「進捗ファイル + ng_words.txt + vocab.is_output」から毎回導出する。**

- `difficulty` は保存値ではなく upsert のたびに `classify(bot_moves)` で計算し直す
  （`DIFFICULTY_BOT_MOVES` を変えたら既評価語にも反映される）。
- 採用集合に無い goal_pool の行（古い分類・手入れで足した未検証語など）は警告し、
  `--prune-stale` を付けると `enabled = false` に落とす（daily_challenges から FK で
  参照されているので DELETE はしない）。
- ng_words.txt に入った語・`is_output` を外れた語は書かない（＝ stale 扱いになる）。
  よって **goal_pool を人手で無効化したいときは ng_words.txt に足すこと**。
  直接 `enabled = false` にしても、次の upsert で採用語なら true に戻る。

使い方:
    uv run python scripts/04_goal_pool.py --max-goals 20 --jobs 1   # 動作確認
    uv run python scripts/04_goal_pool.py                           # 本番（数十分）
    uv run python scripts/04_goal_pool.py --no-stop-on-quota        # 目標数で止めない
    uv run python scripts/04_goal_pool.py --upsert-only --prune-stale  # DB だけ作り直す
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path
from random import Random

from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import DATA_DIR, database_url, load_ng_words  # noqa: E402
from _constants import (  # noqa: E402
    DIFFICULTIES,
    GOAL_POOL_TARGETS,
    START_RANK_RANGE,
)
from _db import connect, ensure_goal_pool  # noqa: E402
from _goalbot import (  # noqa: E402
    GoalRecord,
    evaluate_goal,
    goal_candidates,
    init_worker,
    worker_evaluate,
)
from _vectors import load_output_space  # noqa: E402

PROGRESS_PATH = DATA_DIR / "goal_pool_progress.jsonl"
# 候補を混ぜる順序のシード。頻度順のまま切ると高頻度語ばかりになるので、
# --max-goals で打ち切っても偏らないよう決定的にシャッフルする。
SHUFFLE_SEED = 20260917
# これだけ評価しても easy が 0 なら構造的な問題なので、その旨を出す。
EASY_WARN_SAMPLE = 100
# BLAS を 1 スレッドに固定する環境変数（プロセス並列と食い合わせない）。
BLAS_ENV_VARS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS",
)

UPSERT_SQL = """
INSERT INTO goal_pool (word, difficulty, bot_moves, review_needed, enabled)
VALUES (%s, %s, %s, %s, true)
ON CONFLICT (word) DO UPDATE SET
  difficulty    = EXCLUDED.difficulty,
  bot_moves     = EXCLUDED.bot_moves,
  review_needed = EXCLUDED.review_needed
"""


def read_progress(path: Path) -> dict[str, GoalRecord]:
    done: dict[str, GoalRecord] = {}
    if not path.exists():
        return done
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue  # 中断で切れた最終行
            if isinstance(rec, dict) and "word" in rec:
                done[rec["word"]] = rec
    return done


def accepted(records: dict[str, GoalRecord]) -> list[GoalRecord]:
    return [r for r in records.values() if r.get("difficulty") and not r.get("rejected")]


def quota_met(counts: Counter[str], targets: dict[str, int]) -> bool:
    return all(counts[d] >= targets[d] for d in DIFFICULTIES)


def upsert(records: list[GoalRecord]) -> tuple[int, list[str]]:
    """goal_pool へ upsert。vocab に無い語は FK で弾かれるので先に除く。"""
    with connect(database_url()) as conn:
        ensure_goal_pool(conn)
        words = [r["word"] for r in records]
        rows = conn.execute(
            "SELECT word FROM vocab WHERE word = ANY(%s::text[])", (words,)
        ).fetchall()
        known = {r[0] for r in rows}
        missing = [w for w in words if w not in known]
        payload = [
            (r["word"], r["difficulty"], r["bot_moves"], r["review_needed"])
            for r in records
            if r["word"] in known
        ]
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, payload)
    return len(payload), missing


def main() -> None:
    ap = argparse.ArgumentParser(description="ゴールプールを作る")
    ap.add_argument("--max-goals", type=int, default=0, help="評価する候補数の上限（0 = 全部）")
    ap.add_argument(
        "--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1), help="並列プロセス数"
    )
    ap.add_argument("--fresh", action="store_true", help="進捗ファイルを捨ててやり直す")
    ap.add_argument(
        "--no-stop-on-quota",
        action="store_true",
        help="Easy/Normal/Hard の目標数に達しても止めない",
    )
    ap.add_argument("--skip-db", action="store_true", help="DB に書かない（進捗ファイルだけ）")
    for d in DIFFICULTIES:
        ap.add_argument(
            f"--target-{d}",
            type=int,
            default=GOAL_POOL_TARGETS[d],
            help=f"{d} の目標数（既定 {GOAL_POOL_TARGETS[d]}、0 で打ち切り条件から外す）",
        )
    ap.add_argument(
        "--allow-revisit",
        action="store_true",
        help="SPEC の擬似コード通りにする（既に通った語も result に選ぶ。ループして到達不能が増える）",
    )
    args = ap.parse_args()
    avoid_revisit = not args.allow_revisit
    targets = {d: int(getattr(args, f"target_{d}")) for d in DIFFICULTIES}

    if args.fresh and PROGRESS_PATH.exists():
        PROGRESS_PATH.unlink()

    ng = load_ng_words()
    space = load_output_space()
    candidates = goal_candidates(space, ng)
    Random(SHUFFLE_SEED).shuffle(candidates)
    print(
        f"出力語彙 {space.size} 語 / ゴール候補 {len(candidates)} 語", file=sys.stderr
    )

    done = read_progress(PROGRESS_PATH)
    counts = Counter(r["difficulty"] for r in accepted(done) if r["difficulty"])
    if done:
        print(
            f"再開: 評価済み {len(done)} 語（採用 {sum(counts.values())}）", file=sys.stderr
        )

    pending = [i for i in candidates if space.words[i] not in done]
    if args.max_goals:
        pending = pending[: args.max_goals]
    if not pending:
        print("評価する候補がありません（すべて済み）", file=sys.stderr)

    stop_on_quota = not args.no_stop_on_quota
    t0 = time.time()
    processed = 0

    if pending:
        bar = tqdm(total=len(pending), unit="語", desc="ボット", file=sys.stderr)
        with PROGRESS_PATH.open("a", encoding="utf-8") as fh:

            def consume(record: GoalRecord) -> bool:
                """1 件処理。打ち切るなら True。"""
                nonlocal processed
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
                fh.flush()
                done[record["word"]] = record
                if record["difficulty"] and not record["rejected"]:
                    counts[record["difficulty"]] += 1
                processed += 1
                bar.update(1)
                bar.set_postfix(
                    easy=counts["easy"], normal=counts["normal"], hard=counts["hard"]
                )
                return stop_on_quota and quota_met(counts, targets)

            if args.jobs <= 1:
                for idx in pending:
                    if consume(evaluate_goal(space, idx, ng, avoid_revisit=avoid_revisit)):
                        break
            else:
                # ワーカーの BLAS を 1 スレッドに固定する。spawn は親の os.environ を
                # 引き継ぐので、Executor を作る前に設定する必要がある。
                for name in BLAS_ENV_VARS:
                    os.environ[name] = "1"
                executor = ProcessPoolExecutor(
                    max_workers=args.jobs,
                    mp_context=get_context("spawn"),
                    initializer=init_worker,
                    initargs=(avoid_revisit,),
                )
                try:
                    for record in executor.map(worker_evaluate, pending, chunksize=1):
                        if consume(record):
                            break
                finally:
                    executor.shutdown(wait=False, cancel_futures=True)
        bar.close()

    ok = accepted(done)
    counts = Counter(r["difficulty"] for r in ok if r["difficulty"])
    rejects = Counter(r["rejected"] for r in done.values() if r.get("rejected"))
    review = sum(1 for r in ok if r["review_needed"])

    print(
        f"\n評価 {processed} 語 / {time.time() - t0:.0f}s  （累計 {len(done)} 語）",
        file=sys.stderr,
    )
    print("=== 採用 ===", file=sys.stderr)
    for d in DIFFICULTIES:
        print(
            f"  {d:<7} {counts[d]:>4} / 目標 {targets[d]}",
            file=sys.stderr,
        )
    print(f"  review_needed {review}", file=sys.stderr)
    print("=== 除外 ===", file=sys.stderr)
    for k, v in rejects.most_common():
        print(f"  {k:<12} {v:>5}", file=sys.stderr)

    short = [d for d in DIFFICULTIES if counts[d] < targets[d]]
    remaining = len(candidates) - len(done)
    if short and remaining <= 0:
        print(
            f"\n※ {', '.join(short)} が目標数に届きませんでした。候補（{len(candidates)} 語）を"
            f"使い切っています。`_constants.py` の GOAL_MIN_FREQ_RANK / GOAL_MAX_FREQ_RANK を"
            f"広げて再実行してください。",
            file=sys.stderr,
        )
    elif short:
        print(
            f"\n※ {', '.join(short)} が目標数に未達です（未評価 {remaining} 語）。"
            f"--max-goals を増やすか、引数なしで続きを流してください。",
            file=sys.stderr,
        )
    if "easy" in short and processed >= EASY_WARN_SAMPLE:
        print(
            "※ easy（平均 4 手以下）は START_RANK_RANGE = "
            f"{START_RANK_RANGE} のスタートからはほぼ出ません。"
            "埋まらない場合は packages/contracts の START_RANK_RANGE を下げるか、"
            "DIFFICULTY_BOT_MOVES の easy 上限を上げる判断が要ります（どちらも親の管轄）。",
            file=sys.stderr,
        )

    if args.skip_db:
        print("--skip-db なので DB には書きません", file=sys.stderr)
        return
    if not ok:
        print("採用 0 件なので DB には書きません", file=sys.stderr)
        return
    written, missing = upsert(ok)
    print(f"\ngoal_pool に {written} 行 upsert しました", file=sys.stderr)
    if missing:
        print(
            f"※ vocab に無いため書けなかった語が {len(missing)} 件あります"
            f"（03_export_pgvector.py を全件で流してください）: {missing[:5]}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
