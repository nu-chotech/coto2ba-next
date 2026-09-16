"""単語の説明文を事前に取ってきて `word_descriptions` に入れる（SPEC §6.5 / §7.6）。

対象: ゴールプール全語 + 出力語彙の頻度上位 `DESCRIPTIONS_FREQ_LIMIT` 語。
Wikipedia REST `https://ja.wikipedia.org/api/rest_v1/page/summary/{title}` を叩き、
`extract` の 1 文目を `word_descriptions(word, text, source, fetched_at)` に保存する。
ゴールプールの語は `goal_pool.description` にも **40 字以内（句点で切る）** で入れる。

- User-Agent に連絡先を入れる（Wikipedia の利用規約で必須）: `WIKIPEDIA_UA`
- 同時実行 `DESCRIPTIONS_CONCURRENCY`（既定 4）。429 は指数バックオフ（`Retry-After` 優先）
- 見つからなければ **行を作らない**（skip）
- **中断・再開可能**: 既に `word_descriptions` にある語、および前回 not-found だった語
  （`data/descriptions_progress.jsonl`）は既定で飛ばす。`--force` で無視する
- httpx の AsyncClient を使う

使い方:
    uv run python scripts/07_descriptions.py --limit 50        # 動作確認
    uv run python scripts/07_descriptions.py                   # 本番（数時間かかる想定）
    uv run python scripts/07_descriptions.py --force            # 既知の結果も取り直す
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

import httpx
import psycopg
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import DATA_DIR, database_url  # noqa: E402
from _constants import (  # noqa: E402
    DESCRIPTIONS_BASE_BACKOFF_SEC,
    DESCRIPTIONS_CONCURRENCY,
    DESCRIPTIONS_FREQ_LIMIT,
    DESCRIPTIONS_MAX_BACKOFF_SEC,
    DESCRIPTIONS_MAX_RETRIES,
    DESCRIPTIONS_TIMEOUT_SEC,
    GOAL_DESCRIPTION_MAX_LEN,
    WIKIPEDIA_SUMMARY_URL,
    WIKIPEDIA_UA,
)
from _db import connect, ensure_goal_pool, ensure_word_descriptions  # noqa: E402

PROGRESS_PATH = DATA_DIR / "descriptions_progress.jsonl"

HEADERS = {"User-Agent": WIKIPEDIA_UA, "Accept": "application/json"}

UPSERT_WORD_DESCRIPTION_SQL = """
INSERT INTO word_descriptions (word, text, source)
VALUES (%s, %s, 'wikipedia')
ON CONFLICT (word) DO UPDATE SET
  text = EXCLUDED.text, source = EXCLUDED.source, fetched_at = now()
"""
UPDATE_GOAL_DESCRIPTION_SQL = "UPDATE goal_pool SET description = %s WHERE word = %s"

# 429 以外でリトライしても無駄なステータス。
RETRYABLE_STATUS = {429, 502, 503, 504}


def read_progress(path: Path) -> dict[str, bool]:
    """word → found（前回の結果）。壊れた最終行（中断）は読み飛ばす。"""
    done: dict[str, bool] = {}
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
                continue
            if isinstance(rec, dict) and "word" in rec and "found" in rec:
                done[rec["word"]] = bool(rec["found"])
    return done


def truncate_description(text: str, max_len: int) -> str:
    """SPEC §6.5: 40 字以内、句点で切る。収まる句点が無ければ単純に切り詰める。"""
    if len(text) <= max_len:
        return text
    cut = text.rfind("。", 0, max_len)
    if cut != -1:
        return text[: cut + 1]
    return text[:max_len]


def first_sentence(extract: str) -> str:
    """1 文目を取り出す。句点が無ければ全文に句点を付けて返す（apps/api の実装と同じ）。"""
    return f"{extract.split('。')[0]}。"


def fetch_target_words(
    conn: psycopg.Connection, freq_limit: int
) -> tuple[list[str], set[str]]:
    """(処理対象語の一覧, ゴールプールの語集合) を返す。"""
    ensure_goal_pool(conn)
    goal_words = [r[0] for r in conn.execute("SELECT word FROM goal_pool ORDER BY word").fetchall()]
    freq_words = [
        r[0]
        for r in conn.execute(
            "SELECT word FROM vocab WHERE is_output ORDER BY freq_rank LIMIT %s",
            (freq_limit,),
        ).fetchall()
    ]
    goal_set = set(goal_words)
    seen: set[str] = set()
    ordered: list[str] = []
    for w in [*goal_words, *freq_words]:
        if w in seen:
            continue
        seen.add(w)
        ordered.append(w)
    return ordered, goal_set


async def fetch_description(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, word: str
) -> tuple[str, str | None]:
    """1 語分の説明を取る。見つからなければ None（呼び出し側は行を作らない）。"""
    url = f"{WIKIPEDIA_SUMMARY_URL}/{quote(word, safe='')}"
    backoff = DESCRIPTIONS_BASE_BACKOFF_SEC
    async with sem:
        for _attempt in range(DESCRIPTIONS_MAX_RETRIES):
            try:
                res = await client.get(url, headers=HEADERS)
            except httpx.HTTPError:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, DESCRIPTIONS_MAX_BACKOFF_SEC)
                continue

            if res.status_code == httpx.codes.NOT_FOUND:
                return word, None
            if res.status_code in RETRYABLE_STATUS:
                retry_after = res.headers.get("retry-after")
                wait = float(retry_after) if retry_after else backoff
                await asyncio.sleep(wait)
                backoff = min(backoff * 2, DESCRIPTIONS_MAX_BACKOFF_SEC)
                continue
            if res.status_code != httpx.codes.OK:
                return word, None  # 想定外のステータスは諦める（skip）

            data = res.json()
            extract = (data.get("extract") or "").strip()
            if not extract or data.get("type") == "disambiguation":
                return word, None
            return word, first_sentence(extract)
        return word, None  # リトライを使い切った


async def run(
    words: list[str],
    goal_set: set[str],
    conn: psycopg.Connection,
    progress_path: Path,
    concurrency: int,
) -> tuple[int, int]:
    found = 0
    not_found = 0
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=DESCRIPTIONS_TIMEOUT_SEC, follow_redirects=True) as client:
        tasks = [asyncio.ensure_future(fetch_description(client, sem, w)) for w in words]
        bar = tqdm(total=len(tasks), desc="descriptions", unit="語", file=sys.stderr)
        with progress_path.open("a", encoding="utf-8") as prog_fh:
            for coro in asyncio.as_completed(tasks):
                word, text = await coro
                if text:
                    conn.execute(UPSERT_WORD_DESCRIPTION_SQL, (word, text))
                    if word in goal_set:
                        conn.execute(
                            UPDATE_GOAL_DESCRIPTION_SQL,
                            (truncate_description(text, GOAL_DESCRIPTION_MAX_LEN), word),
                        )
                    found += 1
                else:
                    not_found += 1
                prog_fh.write(json.dumps({"word": word, "found": bool(text)}, ensure_ascii=False))
                prog_fh.write("\n")
                prog_fh.flush()
                bar.update(1)
        bar.close()
    return found, not_found


def main() -> None:
    ap = argparse.ArgumentParser(description="語の説明文を Wikipedia から取って保存する")
    ap.add_argument("--limit", type=int, default=0, help="動作確認用: 先頭 N 語だけ処理する")
    ap.add_argument(
        "--concurrency", type=int, default=DESCRIPTIONS_CONCURRENCY, help="同時実行数"
    )
    ap.add_argument(
        "--force", action="store_true", help="既知の結果（DB / 進捗ファイル）も無視して取り直す"
    )
    args = ap.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    url = database_url()

    with connect(url) as conn:
        ensure_word_descriptions(conn)
        words, goal_set = fetch_target_words(conn, DESCRIPTIONS_FREQ_LIMIT)
        print(
            f"対象: {len(words)} 語（ゴールプール {len(goal_set)} 語を含む）",
            file=sys.stderr,
        )

        if args.force:
            remaining = words
        else:
            existing = {
                r[0]
                for r in conn.execute(
                    "SELECT word FROM word_descriptions WHERE word = ANY(%s::text[])",
                    (words,),
                ).fetchall()
            }
            attempted = read_progress(PROGRESS_PATH)
            not_found_before = {w for w, ok in attempted.items() if not ok}
            skip = existing | not_found_before
            remaining = [w for w in words if w not in skip]
            print(
                f"再開: 既知 {len(existing)} 語 / 前回 not-found {len(not_found_before)} 語を"
                f"スキップ → 残り {len(remaining)} 語",
                file=sys.stderr,
            )

        if args.limit:
            remaining = remaining[: args.limit]
            print(f"--limit 付き: 先頭 {len(remaining)} 語だけ処理します", file=sys.stderr)

        if not remaining:
            print("処理対象がありません（全て取得済み）", file=sys.stderr)
            return

        found, not_found = asyncio.run(
            run(remaining, goal_set, conn, PROGRESS_PATH, args.concurrency)
        )

    print(
        f"\n完了: found {found} / not_found {not_found}"
        f"（合計 {time.time() - t0:.1f}s）",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
