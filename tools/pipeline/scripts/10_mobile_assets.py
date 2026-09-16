"""モバイル同梱アセットを DB から生成する。

- `apps/mobile/assets/vocab/input.txt`
  入力語彙（`is_input`）を **1 行 1 語・UTF-8・コードポイント順にソート**して書く
  （`apps/mobile/src/lib/vocab.ts` が二分探索の前提にしている順序）。
  Postgres の `ORDER BY word` はロケール依存でコードポイント順と一致する保証が
  無いため、**必ず Python 側で `sorted()`（コードポイント順）にかけ直す**。
- `apps/mobile/assets/vocab/ghost.json`
  出力語彙の頻度上位 `SPACE_GHOST_COUNT`（2,000）語を `[{ word, pos3 }]` の JSON 配列で
  （`apps/mobile/src/features/collection/ghost.ts` が読む形）。

  **`pos3`（`06_umap_coords.py` の出力）が NULL の語は入れない。** 偽の座標を
  本物の語に貼ると、図鑑が「まだ出会っていない語の位置」として偽物を見せてしまう
  （`apps/mobile/src/app/(tabs)/space/index.tsx`）。座標のある語だけを頻度順に
  上から詰めるので、カバレッジが欠けても **出るのは必ず本物**になる。

  `pos3` が 1 語も無い（= 06 が未実行）ときは配列ではなく
  `{"generated": false, "points": []}` を書く。**配列ではないので `parseGhostJson`
  が空を返し**、端末は `generateFallbackGhosts` の疑似乱数に落ちて
  `hasRealGhosts()` が false になる。ファイルを開いた人間にも
  「これは生成されていない」と一目で分かる形にしてある。

使い方:
    uv run python scripts/10_mobile_assets.py
    uv run python scripts/10_mobile_assets.py --ghost-count 100  # 動作確認
    uv run python scripts/10_mobile_assets.py --skip-input       # ghost.json だけ
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url  # noqa: E402
from _constants import GHOST_POS3_DECIMALS, SPACE_GHOST_COUNT  # noqa: E402
from _db import connect, ensure_vocab  # noqa: E402

MOBILE_VOCAB_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "apps"
    / "mobile"
    / "assets"
    / "vocab"
)
INPUT_TXT_PATH = MOBILE_VOCAB_DIR / "input.txt"
GHOST_JSON_PATH = MOBILE_VOCAB_DIR / "ghost.json"

# pos3 が 1 語も無いときに書く「本物ではない」JSON。**配列にしないこと**
# （ghost.ts の parseGhostJson は配列以外を空として扱い、端末側のフォールバックに
# 落ちる = hasRealGhosts() が false になる）。
GHOST_NOT_GENERATED: dict[str, object] = {
    "generated": False,
    "points": [],
    "note": "vocab.pos3 が未計算です。pnpm pipeline:umap（06_umap_coords.py）の後に"
    "このスクリプトを再実行してください。",
}


def fetch_input_words(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute("SELECT word FROM vocab WHERE is_input").fetchall()
    words = [r[0] for r in rows]
    # DB の ORDER BY はロケール依存なので信用せず、Python の既定比較
    # （コードポイント順）でソートし直す。
    words.sort()
    return words


def write_input_txt(words: list[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(words) + "\n", encoding="utf-8")
    size = path.stat().st_size
    print(
        f"{path}: {len(words)} 語 / {size / 1e6:.2f}MB を書き込みました",
        file=sys.stderr,
    )


def fetch_pos3_coverage(conn: psycopg.Connection) -> tuple[int, int]:
    """(出力語彙の語数, そのうち pos3 が NULL の語数) を返す。"""
    row = conn.execute(
        "SELECT count(*), count(*) FILTER (WHERE pos3 IS NULL) FROM vocab WHERE is_output"
    ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1])


def fetch_ghost_rows(conn: psycopg.Connection, count: int) -> list[tuple[str, list[float]]]:
    """頻度上位から **pos3 のある出力語だけ** を count 語取る。

    `LIMIT` の前に `pos3 IS NOT NULL` で絞る。上位 N 語を取ってから NULL を落とす
    書き方だと、カバレッジが欠けたぶんだけ点が減る（本物の語で埋められるのに
    埋めない）。
    """
    rows = conn.execute(
        "SELECT word, pos3 FROM vocab "
        "WHERE is_output AND pos3 IS NOT NULL ORDER BY freq_rank LIMIT %s",
        (count,),
    ).fetchall()
    return [(r[0], [float(v) for v in r[1]]) for r in rows]


def build_ghost_points(rows: list[tuple[str, list[float]]]) -> list[dict[str, object]]:
    """ghost.json に書く配列。座標は桁を絞ってファイルサイズを抑える。"""
    return [
        {"word": word, "pos3": [round(v, GHOST_POS3_DECIMALS) for v in pos3]}
        for word, pos3 in rows
    ]


def write_json(payload: object, path: Path, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = path.stat().st_size
    print(f"{path}: {label} / {size / 1e3:.1f}KB を書き込みました", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="モバイル同梱の語彙アセットを DB から生成する")
    ap.add_argument(
        "--ghost-count",
        type=int,
        default=SPACE_GHOST_COUNT,
        help="動作確認用: ゴースト点の件数を減らす",
    )
    ap.add_argument(
        "--skip-input", action="store_true", help="input.txt の再生成をしない（確認用）"
    )
    ap.add_argument(
        "--skip-ghost", action="store_true", help="ghost.json の再生成をしない（確認用）"
    )
    args = ap.parse_args()

    t0 = time.time()
    with connect(database_url()) as conn:
        ensure_vocab(conn)

        if not args.skip_input:
            words = fetch_input_words(conn)
            if not words:
                raise SystemExit(
                    "vocab.is_input が 0 件です。02_prune.py / 03_export_pgvector.py を"
                    "先に実行してください。"
                )
            write_input_txt(words, INPUT_TXT_PATH)

        if not args.skip_ghost:
            n_output, n_missing = fetch_pos3_coverage(conn)
            if n_output == 0:
                raise SystemExit(
                    "vocab.is_output が 0 件です。02_prune.py / 03_export_pgvector.py を"
                    "先に実行してください。"
                )

            rows = fetch_ghost_rows(conn, args.ghost_count)
            if not rows:
                write_json(GHOST_NOT_GENERATED, GHOST_JSON_PATH, "未生成のプレースホルダ")
                print(
                    f"⚠ 出力語彙 {n_output} 語すべてで pos3 が未計算です。"
                    '偽の座標を本物として見せないため、ghost.json には {"generated": false} を'
                    "書きました（端末側は generateFallbackGhosts の疑似乱数に落ち、"
                    "hasRealGhosts() が false になります）。"
                    "pnpm pipeline:umap（06_umap_coords.py）の後に再実行してください。",
                    file=sys.stderr,
                )
            else:
                if n_missing:
                    print(
                        f"⚠ pos3 が未計算の出力語が {n_missing}/{n_output} 語あります"
                        "（その語はゴースト点に入れていません）。"
                        "pnpm pipeline:umap（06_umap_coords.py）を流し直すと揃います。",
                        file=sys.stderr,
                    )
                if len(rows) < args.ghost_count:
                    print(
                        f"⚠ ゴースト点が {len(rows)} 点しかありません"
                        f"（目標 {args.ghost_count} 点）。pos3 のある語が足りていません。",
                        file=sys.stderr,
                    )
                write_json(build_ghost_points(rows), GHOST_JSON_PATH, f"{len(rows)} 点")

    print(f"完了（{time.time() - t0:.1f}s）", file=sys.stderr)


if __name__ == "__main__":
    main()
