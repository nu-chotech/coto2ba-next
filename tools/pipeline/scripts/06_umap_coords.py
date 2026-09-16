"""出力語彙の w2v を 3D に落として `vocab.pos3` に書く（SPEC §9.1）。

UMAP(n_components=3, n_neighbors=15, min_dist=0.1, metric="cosine") を一度だけかけ、
各軸を独立に [-1, 1] へ正規化する。全ユーザー共通の「世界地図」になる値なので、
一度計算したら DB の `pos3` 列がそのまま保存先になる（再計算しない限り座標は
安定する。座標を変えたくないなら、このスクリプトを再実行しないこと）。

**`random_state` を指定しない。** 指定すると UMAP が内部で n_jobs=1 に落ちて
実測で 2 倍以上遅くなる（21s → 46s、99,805 語）。座標の再現性より速度を優先する。
座標を安定させたい場合は、一度走らせて DB に保存された値をそのまま使い続ける
という運用でカバーする（このスクリプトは「world map」を作り直す用途のときだけ
再実行する）。

書き込み後に **DB 側のカバレッジ**（`is_output` の行数と `pos3` NULL の数）を
必ず検証する。語リストは `data/vocab.parquet` 由来なので、02/03 を後から回すと
DB とドリフトして `pos3` が欠けた語が無言で残る（実際に起きた）。

`umap-learn` は optional dependency（`uv sync --extra umap` が要る）。
未インストールならここで親切なメッセージを出して終了する。

使い方:
    uv run python scripts/06_umap_coords.py             # 出力語彙 全語（実測 102,520 語 / 約 4 分）
    uv run python scripts/06_umap_coords.py --limit 2000 # 動作確認
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url  # noqa: E402
from _constants import (  # noqa: E402
    POS3_LOAD_TABLE,
    POS3_RANGE,
    UMAP_METRIC,
    UMAP_MIN_DIST,
    UMAP_N_COMPONENTS,
    UMAP_N_NEIGHBORS,
)
from _db import connect, ensure_vocab  # noqa: E402
from _vectors import load_output_space  # noqa: E402


def import_umap() -> object:
    try:
        import umap
    except ImportError as exc:
        raise SystemExit(
            "umap-learn が入っていません。`uv sync --extra umap` を実行してから"
            "もう一度走らせてください（SPEC §9.1: umap-learn は optional dependency）。\n"
            f"詳細: {exc}"
        ) from None
    return umap


def normalize_axis(values: np.ndarray) -> np.ndarray:
    """1 軸を [-1, 1] に線形正規化する。値が全部同じ場合は 0 に落とす。"""
    lo, hi = float(values.min()), float(values.max())
    if hi - lo < 1e-12:
        return np.zeros_like(values)
    target_lo, target_hi = POS3_RANGE
    scaled = (values - lo) / (hi - lo)
    return (scaled * (target_hi - target_lo) + target_lo).astype(np.float32)


def verify_coverage(conn: psycopg.Connection, written: int, strict: bool) -> None:
    """書き込み後に DB 側のカバレッジを検証する。

    語リストは `data/vocab.parquet` から取っているので、02_prune / 03_export を
    後から回すと DB の `is_output` とドリフトする（実際に起きた: parquet 99,805 語
    に対し DB 102,520 行で、差分の 2,715 行が `pos3` NULL のまま残った）。
    `GET /api/words/ghosts` は `pos3 IS NOT NULL` で絞るので、黙って点が減る。
    **無言のドリフトを許さないため、ここで必ず数を突き合わせる。**

    `strict`（= `--limit` 無しの本番実行）なら不一致で非ゼロ終了する。
    """
    row = conn.execute(
        "SELECT count(*), count(*) FILTER (WHERE pos3 IS NULL) FROM vocab WHERE is_output"
    ).fetchone()
    assert row is not None
    db_output, db_missing = int(row[0]), int(row[1])

    problems: list[str] = []
    if db_output != written:
        problems.append(
            f"parquet の出力語数({written}) と DB の is_output 行数({db_output}) が一致しません"
            f"（差 {db_output - written}）。02_prune.py / 03_export_pgvector.py を回した後なら "
            "data/output_vectors.npy のキャッシュも含めて作り直してから 06 を再実行してください。"
        )
    if db_missing:
        problems.append(
            f"pos3 が NULL の出力語が {db_missing} 語残っています"
            "（GET /api/words/ghosts は pos3 IS NOT NULL で絞るので、その分だけ点が減ります）。"
        )

    if not problems:
        print(
            f"カバレッジ検証 OK: is_output {db_output} 行すべてに pos3 が入っています",
            file=sys.stderr,
        )
        return

    for p in problems:
        print(f"⚠ {p}", file=sys.stderr)
    if strict:
        raise SystemExit(
            "カバレッジ検証に失敗しました（--limit 無しの本番実行なので中断します）。"
        )
    print(
        "※ --limit 付きの実行なので警告だけにとどめます（本番は --limit 無しで実行）。",
        file=sys.stderr,
    )


def write_pos3(url: str, words: list[str], coords: np.ndarray, strict: bool = True) -> None:
    """`vocab.pos3` を一時テーブル経由でまとめて更新し、カバレッジを検証する。"""
    with connect(url) as conn:
        ensure_vocab(conn)
        conn.execute(f"DROP TABLE IF EXISTS {POS3_LOAD_TABLE}")
        conn.execute(
            f"CREATE TEMP TABLE {POS3_LOAD_TABLE} (word text PRIMARY KEY, x real, y real, z real)"
        )
        with conn.cursor().copy(
            f"COPY {POS3_LOAD_TABLE} (word, x, y, z) FROM STDIN"
        ) as copy:
            for word, (x, y, z) in zip(words, coords, strict=True):
                copy.write_row((word, float(x), float(y), float(z)))
        conn.execute(
            f"""
            UPDATE vocab v SET pos3 = ARRAY[l.x, l.y, l.z]
            FROM {POS3_LOAD_TABLE} l
            WHERE v.word = l.word
            """
        )
        conn.execute(f"DROP TABLE {POS3_LOAD_TABLE}")
        verify_coverage(conn, len(words), strict)


def main() -> None:
    ap = argparse.ArgumentParser(description="出力語彙の 3D 座標（UMAP）を vocab.pos3 に書く")
    ap.add_argument("--limit", type=int, default=0, help="動作確認用: 先頭 N 語だけ計算する")
    args = ap.parse_args()

    umap = import_umap()

    t0 = time.time()
    print("出力語彙のベクトルを読み込み中…", file=sys.stderr)
    space = load_output_space(mmap=False)
    words = space.words
    mat = np.asarray(space.mat, dtype=np.float32)
    if args.limit:
        words = words[: args.limit]
        mat = mat[: args.limit]
    print(f"  {len(words)} 語 ({time.time() - t0:.1f}s)", file=sys.stderr)

    t1 = time.time()
    print(
        f"UMAP 実行中（n_components={UMAP_N_COMPONENTS}, n_neighbors={UMAP_N_NEIGHBORS}, "
        f"min_dist={UMAP_MIN_DIST}, metric={UMAP_METRIC}, random_state 未指定）…",
        file=sys.stderr,
    )
    # random_state を渡すと n_jobs=1 に落ちて遅くなる（モジュール docstring 参照）。
    reducer = umap.UMAP(
        n_components=UMAP_N_COMPONENTS,
        n_neighbors=UMAP_N_NEIGHBORS,
        min_dist=UMAP_MIN_DIST,
        metric=UMAP_METRIC,
    )
    raw_coords = reducer.fit_transform(mat)
    print(f"UMAP 完了: {time.time() - t1:.1f}s", file=sys.stderr)

    coords = np.stack([normalize_axis(raw_coords[:, i]) for i in range(UMAP_N_COMPONENTS)], axis=1)
    lo, hi = POS3_RANGE
    assert coords.shape == (len(words), UMAP_N_COMPONENTS)
    assert float(coords.min()) >= lo - 1e-6 and float(coords.max()) <= hi + 1e-6

    t2 = time.time()
    print(f"vocab.pos3 を書き込み中（{len(words)} 語）…", file=sys.stderr)
    write_pos3(database_url(), words, coords, strict=not args.limit)
    print(f"書き込み完了: {time.time() - t2:.1f}s", file=sys.stderr)

    print(
        f"\n完了: {len(words)} 語の pos3 を更新しました（合計 {time.time() - t0:.1f}s）",
        file=sys.stderr,
    )
    if args.limit:
        print(
            "※ --limit 付きで走らせました。本番は --limit 無しで全出力語彙に対して"
            "実行してください。",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
