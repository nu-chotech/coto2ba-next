"""data/vocab.parquet + data/vectors.npy を Postgres の `vocab` へ書き出す。

- ベクトルは **単位長に正規化**してから入れる（`1 - (w2v <=> goal)` がそのまま cos）。
- psycopg3 の **binary COPY**（テキストリテラルだと 438MB、binary なら 78MB）。
- 冪等: 一時テーブルへ COPY → `INSERT ... ON CONFLICT (word) DO UPDATE`。
- **今回の parquet に無い語は `is_input = is_output = false` に落とす**（`--limit` 無しのときだけ）。
  ng_words.txt に追記して `pnpm pipeline:prune && pnpm pipeline:export` を流したとき、
  新たに NG になった語が DB に残って混合結果・ヒント・rank 母集団に出続けるのを防ぐ
  （SPEC §4.2）。goal_pool / daily_challenges / word_encounters から FK で参照されて
  いるので**行は消さずフラグだけ落とす**。
- HNSW インデックスは**ロード後**に作る（CONCURRENTLY は使わない。トランザクション内で
  黙って死ぬ / drizzle のマイグレーションと衝突する）。

使い方:
    uv run python scripts/03_export_pgvector.py            # 全部
    uv run python scripts/03_export_pgvector.py --limit 5000
    uv run python scripts/03_export_pgvector.py --recreate-index
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pyarrow.parquet as pq
from pgvector import HalfVector
from pgvector.psycopg import register_vector
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    VECTORS_NPY,
    VOCAB_PARQUET,
    database_url,
    normalize_rows,
)
from _constants import (  # noqa: E402
    COPY_PROGRESS_EVERY,
    HALFVEC_MAX_ABS,
    MAINTENANCE_WORK_MEM,
    MAX_PARALLEL_MAINTENANCE_WORKERS,
    VECTOR_DIM,
)
from _db import connect, ensure_vocab  # noqa: E402

LOAD_TABLE = "vocab_load"
COLUMNS = (
    "word",
    "freq_rank",
    "is_input",
    "is_output",
    "is_common_noun",
    "is_concrete",
    "pos",
    "w2v",
)
# COPY (FORMAT BINARY) には列の型を明示する必要がある（COLUMNS と同じ順）。
COPY_TYPES = [
    "text",
    "integer",
    "boolean",
    "boolean",
    "boolean",
    "boolean",
    "text",
    "halfvec",
]

INDEX_HNSW = "vocab_output_hnsw"
INDEX_FREQ = "vocab_output_freq"
SQL_CREATE_HNSW = (
    f"CREATE INDEX IF NOT EXISTS {INDEX_HNSW} "
    "ON vocab USING hnsw (w2v halfvec_cosine_ops) WHERE is_output"
)
SQL_CREATE_FREQ = (
    f"CREATE INDEX IF NOT EXISTS {INDEX_FREQ} ON vocab (freq_rank) WHERE is_output"
)

# 今回の parquet に無い語を無効化する（行は消さない。FK があるため）。
SQL_DEACTIVATE_MISSING = f"""
UPDATE vocab SET is_input = false, is_output = false
WHERE (is_input OR is_output) AND word NOT IN (SELECT word FROM {LOAD_TABLE})
"""
SQL_SAMPLE_MISSING = f"""
SELECT word FROM vocab
WHERE (is_input OR is_output) AND word NOT IN (SELECT word FROM {LOAD_TABLE})
ORDER BY freq_rank LIMIT 10
"""


class Rows(NamedTuple):
    words: list[str]
    freq: np.ndarray
    is_input: np.ndarray
    is_output: np.ndarray
    is_common: np.ndarray
    is_concrete: np.ndarray
    pos: list[str | None]
    vecs: np.ndarray


def load_rows(limit: int) -> Rows:
    table = pq.read_table(VOCAB_PARQUET)
    n = table.num_rows
    if limit:
        n = min(n, limit)
        table = table.slice(0, n)

    words = table["word"].to_pylist()
    if len(set(words)) != len(words):
        raise SystemExit("vocab.parquet に word の重複があります（02_prune をやり直してください）")
    freq = np.asarray(table["freq_rank"].to_numpy(zero_copy_only=False), dtype=np.int32)
    is_input = np.asarray(table["is_input"].to_numpy(zero_copy_only=False), dtype=bool)
    is_output = np.asarray(table["is_output"].to_numpy(zero_copy_only=False), dtype=bool)
    is_common = np.asarray(
        table["is_common_noun"].to_numpy(zero_copy_only=False), dtype=bool
    )
    is_concrete = np.asarray(
        table["is_concrete"].to_numpy(zero_copy_only=False), dtype=bool
    )
    pos = table["pos"].to_pylist()

    mat = np.load(VECTORS_NPY, mmap_mode="r")
    if mat.shape[1] != VECTOR_DIM:
        raise SystemExit(f"vectors.npy の次元が想定外: {mat.shape}")
    vecs = np.ascontiguousarray(mat[:n], dtype=np.float32)

    # halfvec は float16。NaN/Inf が 1 個あると COPY 全体が死ぬので先に検証する。
    if not np.isfinite(vecs).all():
        raise SystemExit("vectors.npy に NaN / Inf があります")
    vecs = normalize_rows(vecs).astype(np.float32, copy=False)
    if not np.isfinite(vecs).all():
        raise SystemExit("正規化後に NaN / Inf が出ました（ゼロベクトルの疑い）")
    if float(np.abs(vecs).max()) > HALFVEC_MAX_ABS:
        raise SystemExit("float16 の範囲を超える値があります（halfvec で inf になります）")

    return Rows(words, freq, is_input, is_output, is_common, is_concrete, pos, vecs)


def main() -> None:
    ap = argparse.ArgumentParser(description="vocab を pgvector に書き出す")
    ap.add_argument("--limit", type=int, default=0, help="動作確認用: 先頭 N 行だけ入れる")
    ap.add_argument(
        "--recreate-index",
        action="store_true",
        help="HNSW を作り直す（--limit で小さく試した後の本番ロード時に使う）",
    )
    ap.add_argument("--skip-index", action="store_true", help="インデックスを作らない")
    args = ap.parse_args()

    t0 = time.time()
    print(f"読み込み: {VOCAB_PARQUET.name} / {VECTORS_NPY.name}", file=sys.stderr)
    rows = load_rows(args.limit)
    words, freq, is_input, is_output = rows.words, rows.freq, rows.is_input, rows.is_output
    is_common, is_concrete = rows.is_common, rows.is_concrete
    pos, vecs = rows.pos, rows.vecs
    n = len(words)
    print(
        f"  {n} 行 / 出力語彙 {int(is_output.sum())} 語 ({time.time() - t0:.1f}s)",
        file=sys.stderr,
    )

    url = database_url()
    with connect(url) as conn:
        ensure_vocab(conn)
        # register_vector は halfvec の OID を DB から引くので CREATE EXTENSION の後。
        register_vector(conn)

        conn.execute(f"DROP TABLE IF EXISTS {LOAD_TABLE}")
        # INCLUDING なし = 制約とインデックスを引き継がない（COPY が速い）。
        conn.execute(f"CREATE TEMP TABLE {LOAD_TABLE} (LIKE vocab)")

        t1 = time.time()
        cols = ", ".join(COLUMNS)
        sql = f"COPY {LOAD_TABLE} ({cols}) FROM STDIN WITH (FORMAT BINARY)"
        with conn.cursor().copy(sql) as copy:
            copy.set_types(COPY_TYPES)
            bar = tqdm(
                total=n, unit="語", desc="COPY", file=sys.stderr, miniters=COPY_PROGRESS_EVERY
            )
            for i in range(n):
                copy.write_row(
                    (
                        words[i],
                        int(freq[i]),
                        bool(is_input[i]),
                        bool(is_output[i]),
                        bool(is_common[i]),
                        bool(is_concrete[i]),
                        pos[i],
                        HalfVector(vecs[i]),
                    )
                )
                bar.update(1)
            bar.close()
        print(f"COPY 完了: {time.time() - t1:.1f}s", file=sys.stderr)

        t2 = time.time()
        conn.execute(
            f"""
            INSERT INTO vocab ({cols})
            SELECT {cols} FROM {LOAD_TABLE}
            ON CONFLICT (word) DO UPDATE SET
              freq_rank      = EXCLUDED.freq_rank,
              is_input       = EXCLUDED.is_input,
              is_output      = EXCLUDED.is_output,
              is_common_noun = EXCLUDED.is_common_noun,
              is_concrete    = EXCLUDED.is_concrete,
              pos            = EXCLUDED.pos,
              w2v            = EXCLUDED.w2v
            """
        )
        print(f"upsert 完了: {time.time() - t2:.1f}s", file=sys.stderr)

        # parquet から消えた語（NG 追加・prune のしきい値変更など）を無効化する。
        # --limit 付きは「先頭 N 行だけ」なので、残り全部を無効化してはいけない。
        if args.limit:
            deactivated = -1
            print(
                "--limit 付きなので、今回の parquet に無い語の無効化はしません",
                file=sys.stderr,
            )
        else:
            sample = [r[0] for r in conn.execute(SQL_SAMPLE_MISSING).fetchall()]
            with conn.cursor() as cur:
                cur.execute(SQL_DEACTIVATE_MISSING)
                deactivated = cur.rowcount
            if deactivated:
                print(
                    f"parquet に無い {deactivated} 語を is_input/is_output = false に"
                    f"落としました（行は残す。FK があるため）: {sample[:5]}",
                    file=sys.stderr,
                )
            else:
                print("parquet に無い有効語はありませんでした", file=sys.stderr)

        conn.execute(f"DROP TABLE {LOAD_TABLE}")

        if not args.skip_index:
            t3 = time.time()
            # Neon Free の既定 64MB では pgvector が遅い 2 パス経路に落ちる。
            conn.execute(f"SET maintenance_work_mem = '{MAINTENANCE_WORK_MEM}'")
            conn.execute(
                f"SET max_parallel_maintenance_workers = {MAX_PARALLEL_MAINTENANCE_WORKERS}"
            )
            if args.recreate_index:
                conn.execute(f"DROP INDEX IF EXISTS {INDEX_HNSW}")
            print("HNSW を構築中（CONCURRENTLY は使わない）…", file=sys.stderr)
            conn.execute(SQL_CREATE_HNSW)
            conn.execute(SQL_CREATE_FREQ)
            conn.execute("ANALYZE vocab")
            print(f"インデックス完了: {time.time() - t3:.1f}s", file=sys.stderr)

        total = conn.execute("SELECT count(*) FROM vocab").fetchone()
        outputs = conn.execute("SELECT count(*) FROM vocab WHERE is_output").fetchone()

    assert total is not None and outputs is not None
    print(
        f"\nvocab: {total[0]} 行 / is_output {outputs[0]} 語  (合計 {time.time() - t0:.1f}s)",
        file=sys.stderr,
    )
    if args.limit:
        print(
            "※ --limit 付きで走らせました。本番ロードは --recreate-index を付けて "
            "全件で走らせ直してください（小さいデータで作った HNSW が残るため）。",
            file=sys.stderr,
        )
    if deactivated > 0:
        print(
            "※ 無効化した語がゴールプールに残っている可能性があります。続けて "
            "`04_goal_pool.py --upsert-only --prune-stale` と `05_daily_schedule.py` を"
            "流してください。",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
