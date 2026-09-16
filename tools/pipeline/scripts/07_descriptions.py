"""単語の説明文を事前に取ってきて `word_descriptions` に入れる（SPEC §6.5 / §7.6）。

対象: ゴールプール全語 + 出力語彙の頻度上位 `DESCRIPTIONS_FREQ_LIMIT` 語。
Wikipedia REST `https://ja.wikipedia.org/api/rest_v1/page/summary/{title}` を叩き、
`extract` の 1 文目を `word_descriptions(word, text, source, fetched_at)` に保存する。
ゴールプールの語は `goal_pool.description` にも **40 字以内（句点で切る）** で入れる。

- User-Agent に連絡先を入れる（Wikipedia の利用規約で必須）: `WIKIPEDIA_UA`
- 同時実行 `DESCRIPTIONS_CONCURRENCY`（既定 4）。429 は指数バックオフ（`Retry-After` 優先）
- 見つからなければ **行を作らない**（skip）
- **中断・再開可能**: 既に `word_descriptions` にある語、および前回 **本当に無かった**語
  （`data/descriptions_progress.jsonl` の `reason == "missing"`）は既定で飛ばす。
  一時的な失敗（`reason == "error"`）は次回に再試行する。`--force` で全部無視する
- 毎回まず **backfill**（Wikipedia を叩かない）を流す: `word_descriptions` に行はあるのに
  `goal_pool.description` が NULL の語を埋め直す。API 側（`/words/:word/description`）が
  実行時にキャッシュした語や、upsert 直後に落ちた語をここで拾う
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
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
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
# backfill 用: 説明文の行はあるのに goal_pool.description が NULL の語だけ拾う。
SELECT_GOAL_BACKFILL_SQL = """
SELECT gp.word, wd.text
FROM goal_pool gp
JOIN word_descriptions wd ON wd.word = gp.word
WHERE gp.description IS NULL
"""
# 競合（並行実行・API 側の書き込み）で埋まっていたら触らない。
BACKFILL_GOAL_DESCRIPTION_SQL = (
    "UPDATE goal_pool SET description = %s WHERE word = %s AND description IS NULL"
)

# 429 以外でリトライしても無駄なステータス。
RETRYABLE_STATUS = {429, 502, 503, 504}

# fetch_description() の結果の理由。
REASON_OK = "ok"  # 取れた
REASON_MISSING = "missing"  # 404 / 曖昧さ回避 / extract が空 = 恒久的に無い
REASON_ERROR = "error"  # 通信・パース・リトライ枯渇 = 一時的かもしれない
# 次回スキップしてよいのは「恒久的に無い」だけ。
SKIPPABLE_REASONS = frozenset({REASON_MISSING})


def read_progress(path: Path) -> dict[str, str]:
    """word → reason（前回の結果）。壊れた最終行（中断）は読み飛ばす。

    `reason` が無い旧形式の行は、`found: true` を `ok`、`found: false` を `error`
    として読む（旧形式は一時的な失敗と本当の not-found を区別していないので、
    取りこぼしを拾うために再試行側へ倒す）。
    """
    done: dict[str, str] = {}
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
            if not isinstance(rec, dict) or "word" not in rec:
                continue
            reason = rec.get("reason")
            if not isinstance(reason, str):
                if "found" not in rec:
                    continue
                reason = REASON_OK if rec["found"] else REASON_ERROR
            done[rec["word"]] = reason
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


def parse_retry_after(value: str | None, fallback: float) -> float:
    """`Retry-After` を秒に直す。秒数形式と HTTP-date 形式（RFC 9110）の両方に対応する。

    解釈できない値・過去の日時なら `fallback`（指数バックオフ）を返す。
    ここで例外を出すとレート制限に当たった瞬間にバッチ全体が死ぬので、必ず握り潰す。
    """
    if not value:
        return fallback
    value = value.strip()
    try:
        return max(float(value), 0.0)
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return fallback
    if when is None:
        return fallback
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    wait = (when - datetime.now(UTC)).total_seconds()
    return wait if wait > 0 else fallback


def backfill_goal_descriptions(conn: psycopg.Connection) -> int:
    """Wikipedia を叩かずに `goal_pool.description` の NULL を埋める。

    `word_descriptions` に行があるのに `goal_pool.description` が NULL の語が残ると、
    再開時のスキップ判定（行の有無）に引っかかって二度と埋まらない。
    API 側が実行時にキャッシュした語や、upsert 直後に落ちた語がこれに当たる。
    """
    rows = conn.execute(SELECT_GOAL_BACKFILL_SQL).fetchall()
    filled = 0
    for word, text in rows:
        if not text:
            continue
        conn.execute(
            BACKFILL_GOAL_DESCRIPTION_SQL,
            (truncate_description(text, GOAL_DESCRIPTION_MAX_LEN), word),
        )
        filled += 1
    return filled


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
) -> tuple[str, str | None, str]:
    """1 語分の説明を取る。

    戻り値は `(word, text | None, reason)`。`reason` は
    `ok`（取れた） / `missing`（恒久的に無い） / `error`（一時的かもしれない）。
    `missing` だけが次回スキップの対象になる（`error` は再試行する）。
    1 語の事故でバッチ全体を落とさないよう、**例外は全部ここで握り潰す**。
    """
    url = f"{WIKIPEDIA_SUMMARY_URL}/{quote(word, safe='')}"
    backoff = DESCRIPTIONS_BASE_BACKOFF_SEC
    try:
        async with sem:
            for _attempt in range(DESCRIPTIONS_MAX_RETRIES):
                try:
                    res = await client.get(url, headers=HEADERS)
                except httpx.HTTPError:
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, DESCRIPTIONS_MAX_BACKOFF_SEC)
                    continue

                if res.status_code == httpx.codes.NOT_FOUND:
                    return word, None, REASON_MISSING
                if res.status_code in RETRYABLE_STATUS:
                    wait = parse_retry_after(res.headers.get("retry-after"), backoff)
                    await asyncio.sleep(wait)
                    backoff = min(backoff * 2, DESCRIPTIONS_MAX_BACKOFF_SEC)
                    continue
                if res.status_code != httpx.codes.OK:
                    # 想定外のステータス。恒久的とは限らないので次回に回す。
                    return word, None, REASON_ERROR

                try:
                    data = res.json()
                except ValueError:
                    return word, None, REASON_ERROR
                if not isinstance(data, dict):
                    return word, None, REASON_ERROR

                extract = (data.get("extract") or "").strip()
                if not extract or data.get("type") == "disambiguation":
                    return word, None, REASON_MISSING
                return word, first_sentence(extract), REASON_OK
            return word, None, REASON_ERROR  # リトライを使い切った
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 — 1 語の事故で数時間のバッチを落とさない
        return word, None, REASON_ERROR


async def run(
    words: list[str],
    goal_set: set[str],
    conn: psycopg.Connection,
    progress_path: Path,
    concurrency: int,
) -> tuple[int, int, int]:
    """(found, missing, errors) を返す。"""
    found = 0
    missing = 0
    errors = 0
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=DESCRIPTIONS_TIMEOUT_SEC, follow_redirects=True) as client:
        tasks = [asyncio.ensure_future(fetch_description(client, sem, w)) for w in words]
        bar = tqdm(total=len(tasks), desc="descriptions", unit="語", file=sys.stderr)
        with progress_path.open("a", encoding="utf-8") as prog_fh:
            for coro in asyncio.as_completed(tasks):
                word, text, reason = await coro
                if text:
                    conn.execute(UPSERT_WORD_DESCRIPTION_SQL, (word, text))
                    if word in goal_set:
                        conn.execute(
                            UPDATE_GOAL_DESCRIPTION_SQL,
                            (truncate_description(text, GOAL_DESCRIPTION_MAX_LEN), word),
                        )
                    found += 1
                elif reason == REASON_MISSING:
                    missing += 1
                else:
                    errors += 1
                prog_fh.write(
                    json.dumps(
                        {"word": word, "found": bool(text), "reason": reason},
                        ensure_ascii=False,
                    )
                )
                prog_fh.write("\n")
                prog_fh.flush()
                bar.update(1)
        bar.close()
    return found, missing, errors


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

        # Wikipedia を叩かない復旧パス。フェッチ対象が 0 語でも必ず流す。
        backfilled = backfill_goal_descriptions(conn)
        print(f"backfill: goal_pool.description を {backfilled} 語ぶん埋めた", file=sys.stderr)

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
            missing_before = {w for w, reason in attempted.items() if reason in SKIPPABLE_REASONS}
            skip = existing | missing_before
            remaining = [w for w in words if w not in skip]
            print(
                f"再開: 既知 {len(existing)} 語 / 前回 not-found {len(missing_before)} 語を"
                f"スキップ → 残り {len(remaining)} 語（前回エラーの語は再試行する）",
                file=sys.stderr,
            )

        if args.limit:
            remaining = remaining[: args.limit]
            print(f"--limit 付き: 先頭 {len(remaining)} 語だけ処理します", file=sys.stderr)

        if not remaining:
            print("処理対象がありません（全て取得済み）", file=sys.stderr)
            return

        found, missing, errors = asyncio.run(
            run(remaining, goal_set, conn, PROGRESS_PATH, args.concurrency)
        )

    print(
        f"\n完了: found {found} / not_found {missing} / error {errors}"
        f"（合計 {time.time() - t0:.1f}s）",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
