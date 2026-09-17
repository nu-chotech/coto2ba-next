"""ローカル DB で計算済みの `vocab.pos3` を、別の DB（本番想定）にバックフィルする（SPEC §3.2）。

本番 Neon の `vocab.pos3` は 102,520 語すべて NULL（`06_umap_coords.py` は容量に
余裕のあるローカルでしか回していない）。図鑑（`GET /api/collection` /
`GET /api/words/ghosts`）は `pos3 IS NOT NULL` で絞るため、NULL のままだと
クリアしても「まだ語に出会っていません」から進まない（実際に起きた）。

Neon Free は 512MB 中 318MB 使用済みで、102,520 行の一括 UPDATE は死んだタプルで
容量を食い切る危険がある。**`--batch-size` ごとに UPDATE → VACUUM** を回し、
バッチの後に `pg_database_size` を確認して `--max-bytes` を超えたら中断する。

冪等: 常に `WHERE v.pos3 IS NULL` で絞るので、`--max-bytes` で中断しても
再実行すれば続きから進む。

**`--target` に既定値は無い（本番を既定にしない）。** 本番に流すときは呼び出し側が
明示的に本番の接続文字列（Neon の `DATABASE_URL_DIRECT`）を渡すこと。

**このスクリプトは vocab を新規作成しない。** `--target` が空の DB / 別プロジェクトを
誤って指していた場合に「対象 0 件 = 完了」と誤報告してサイレントに成功したように
見えてしまう事故（レビュー指摘）を防ぐため、書き込み前に `vocab` の存在と行数を
検証し、おかしければ非ゼロ終了でエラーを出す（`ensure_target_sane`）。

**`--dry-run` は target に一切書き込まない。** 一時テーブルの作成・COPY も行わず、
渡されたソースの語リストを `word = ANY(...)` で直接読むだけにしてある。

**pooled 接続（ホスト名に `-pooler` を含む）は既定で拒否する。** 一時テーブルは
セッションに紐づくため、コネクションプーラ越しだと接続の使い回しで意図せず
消える恐れがある。本番で一度しか打たない操作なので機械的に弾く
（どうしても使うなら `--allow-pooled`）。

一時テーブル経由でまとめて読み込み、バッチの切り出しは DB 側の
`WHERE pos3 IS NULL LIMIT --batch-size` に任せる（1 行ずつの UPDATE は遅すぎる。
`06_umap_coords.py` と同様に一時テーブルは autocommit 前提で手動 DROP する）。

使い方:
    # 対象件数だけ確認する（target には一切書き込まない）
    uv run python scripts/12_backfill_pos3.py --target postgresql://... --dry-run

    # 本番に流す（呼び出し側が明示的に接続文字列を渡す。pooled は既定で拒否）
    uv run python scripts/12_backfill_pos3.py --target postgresql://...
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url  # noqa: E402
from _db import connect  # noqa: E402

DEFAULT_BATCH_SIZE = 5_000
DEFAULT_MAX_BYTES = 480 * 1024 * 1024
# ソース（ローカル DB の pos3）を丸ごと読み込む一時テーブル名。
SOURCE_LOAD_TABLE = "pos3_backfill_source"


def is_pooled_host(url: str) -> bool:
    """Neon の pooled 接続（ホスト名に `-pooler` を含む）かどうか。

    pooled 接続はコネクションの使い回しがあるため、セッションに紐づく一時テーブルが
    意図せず失われる恐れがある。本番で一度しか打たない操作なので機械的に弾く
    （どうしても使うなら `--allow-pooled`）。
    """
    return "-pooler" in url.lower()


def fetch_source_rows(source_url: str) -> list[tuple[str, list[float]]]:
    """ローカル DB から (word, pos3) を `pos3 IS NOT NULL` に絞って読む。"""
    with connect(source_url) as conn:
        rows = conn.execute("SELECT word, pos3 FROM vocab WHERE pos3 IS NOT NULL").fetchall()
    return [(word, list(pos3)) for word, pos3 in rows]


def ensure_target_sane(conn: psycopg.Connection, min_rows: int) -> None:
    """target の vocab が「それらしい」ことを、書き込み・一時テーブル作成の前に確認する。

    以前の実装は `ensure_vocab()`（`CREATE EXTENSION` + `CREATE TABLE IF NOT EXISTS`）を
    dry-run 含む全経路で無条件に呼んでいたため、`--target` の入力ミスで空の DB /
    別プロジェクトを指した場合に **その場に空の vocab を新規作成した上で**
    「対象 0 件 = 完了」と誤報告する事故があり得た（レビュー指摘）。
    ここで vocab の存在と行数を先に検証し、おかしければ非ゼロ終了で止める。
    """
    exists = conn.execute("SELECT to_regclass('public.vocab')").fetchone()
    assert exists is not None
    if exists[0] is None:
        raise SystemExit(
            "target に vocab テーブルがありません。--target が正しいか確認してください"
            "（誤って空の DB や別プロジェクトを指していないか）。"
            " このスクリプトは vocab を新規作成しません。"
        )
    total_row = conn.execute("SELECT count(*) FROM vocab").fetchone()
    assert total_row is not None
    total = int(total_row[0])
    if total < min_rows:
        raise SystemExit(
            f"target の vocab は {total} 行しかありません"
            f"（ソース側の pos3 あり語数 {min_rows} より少ない）。"
            " --target が間違っている可能性があります"
            "（誤って空の DB や別プロジェクトを指していないか確認してください）。"
        )


def count_missing_readonly(conn: psycopg.Connection, words: list[str]) -> int:
    """dry-run 用。target に一切書き込まず、渡した語のうち pos3 が NULL な数を数える。"""
    row = conn.execute(
        "SELECT count(*) FROM vocab WHERE pos3 IS NULL AND word = ANY(%s)",
        (words,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def load_source_into_temp(conn: psycopg.Connection, rows: list[tuple[str, list[float]]]) -> None:
    """ソースの (word, pos3) を対象 DB の一時テーブルにまとめて COPY する。

    書き込み（実行）経路でのみ呼ぶこと。dry-run では呼ばない。
    """
    conn.execute(f"DROP TABLE IF EXISTS {SOURCE_LOAD_TABLE}")
    conn.execute(f"CREATE TEMP TABLE {SOURCE_LOAD_TABLE} (word text PRIMARY KEY, pos3 real[])")
    with conn.cursor().copy(f"COPY {SOURCE_LOAD_TABLE} (word, pos3) FROM STDIN") as copy:
        for word, pos3 in rows:
            copy.write_row((word, pos3))


def count_missing(conn: psycopg.Connection) -> int:
    """対象 DB で pos3 が NULL、かつソースに値がある語の数（一時テーブル読み込み後専用）。"""
    row = conn.execute(
        f"""
        SELECT count(*)
        FROM vocab v
        JOIN {SOURCE_LOAD_TABLE} s ON s.word = v.word
        WHERE v.pos3 IS NULL
        """
    ).fetchone()
    assert row is not None
    return int(row[0])


def db_size_bytes(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT pg_database_size(current_database())").fetchone()
    assert row is not None
    return int(row[0])


def apply_batch(conn: psycopg.Connection, batch_size: int) -> int:
    """`pos3 IS NULL` な語を最大 batch_size 件選び、ソースの値で UPDATE する。

    戻り値は実際に更新した行数（0 なら対象が尽きたということ）。
    """
    candidates = conn.execute(
        f"""
        SELECT v.word
        FROM vocab v
        JOIN {SOURCE_LOAD_TABLE} s ON s.word = v.word
        WHERE v.pos3 IS NULL
        LIMIT %s
        """,
        (batch_size,),
    ).fetchall()
    words = [r[0] for r in candidates]
    if not words:
        return 0
    cur = conn.execute(
        f"""
        UPDATE vocab v
        SET pos3 = s.pos3
        FROM {SOURCE_LOAD_TABLE} s
        WHERE v.word = s.word AND v.word = ANY(%s) AND v.pos3 IS NULL
        """,
        (words,),
    )
    return cur.rowcount


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        description="ローカル DB で計算済みの vocab.pos3 を対象 DB にバッチでバックフィルする"
    )
    ap.add_argument(
        "--target",
        required=True,
        help=(
            "書き込み先の接続文字列。既定値は無い（本番を既定にしない）。"
            "本番に流す場合は呼び出し側が Neon の DATABASE_URL_DIRECT を明示的に渡すこと。"
        ),
    )
    ap.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"1 バッチあたりの更新行数（既定 {DEFAULT_BATCH_SIZE}）",
    )
    ap.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help=f"このバイト数を超えたら中断する（既定 {DEFAULT_MAX_BYTES}）",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="対象件数だけ出して終了する（target には一切書き込まない）",
    )
    ap.add_argument(
        "--allow-pooled",
        action="store_true",
        help="pooled 接続（ホスト名に -pooler を含む）でも実行する（既定では拒否）",
    )
    args = ap.parse_args(argv)

    if is_pooled_host(args.target) and not args.allow_pooled:
        raise SystemExit(
            "--target が pooled 接続（ホスト名に -pooler を含む）です。"
            " 一時テーブルが接続の使い回しで失われる恐れがあるため既定では拒否します。"
            " Neon の DATABASE_URL_DIRECT（unpooled）を使うか、"
            " 分かった上で --allow-pooled を付けて再実行してください。"
        )

    print("ソース: ローカル DB から pos3 を読み込み中…", file=sys.stderr)
    rows = fetch_source_rows(database_url())
    print(f"  ソース側 pos3 あり: {len(rows)} 語", file=sys.stderr)
    if not rows:
        raise SystemExit("ソースに pos3 が 1 件もありません。中断します。")
    words = [word for word, _ in rows]

    with connect(args.target) as conn:
        ensure_target_sane(conn, len(rows))

        if args.dry_run:
            missing = count_missing_readonly(conn, words)
            print(f"対象（target の pos3 が NULL かつソースに値あり）: {missing} 語", file=sys.stderr)
            print(
                "dry-run のため書き込みは行いません（一時テーブルも作成していません）。",
                file=sys.stderr,
            )
            return

        load_source_into_temp(conn, rows)
        try:
            missing = count_missing(conn)
            print(f"対象（target の pos3 が NULL かつソースに値あり）: {missing} 語", file=sys.stderr)

            if missing == 0:
                print("対象がありません。すでに完了しています。", file=sys.stderr)
                return

            processed = 0
            batch_no = 0
            while True:
                batch_no += 1
                updated = apply_batch(conn, args.batch_size)
                if updated == 0:
                    break
                processed += updated
                conn.execute("VACUUM vocab")
                size = db_size_bytes(conn)
                print(
                    f"バッチ {batch_no}: {updated} 行更新（累計 {processed}）"
                    f" / DB サイズ {size / (1024 * 1024):.1f}MB",
                    file=sys.stderr,
                )
                if size > args.max_bytes:
                    remaining = count_missing(conn)
                    print(
                        f"⚠ DB サイズが --max-bytes"
                        f"（{args.max_bytes / (1024 * 1024):.0f}MB）を超えたため中断します。"
                        f" 残り {remaining} 語は未処理です。"
                        " WHERE pos3 IS NULL で絞っているので、あとで再実行すれば続きから進みます。",
                        file=sys.stderr,
                    )
                    sys.exit(1)

            remaining = count_missing(conn)
            print(
                f"\n完了: {processed} 行更新しました。pos3 IS NULL の残り: {remaining} 件。",
                file=sys.stderr,
            )
        finally:
            conn.execute(f"DROP TABLE IF EXISTS {SOURCE_LOAD_TABLE}")


if __name__ == "__main__":
    main()
