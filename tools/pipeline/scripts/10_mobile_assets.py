"""モバイル同梱アセットを DB から生成する。

- `apps/mobile/assets/vocab/input.txt`
  入力語彙（`is_input`）を **1 行 1 語・UTF-8・コードポイント順にソート**して書く
  （`apps/mobile/src/lib/vocab.ts` が二分探索の前提にしている順序）。
  Postgres の `ORDER BY word` はロケール依存でコードポイント順と一致する保証が
  無いため、**必ず Python 側で `sorted()`（コードポイント順）にかけ直す**。
- `apps/mobile/assets/vocab/ghost.json`
  出力語彙の頻度上位 `SPACE_GHOST_COUNT`（2,000）語を `{ word, pos3 }` の JSON 配列で
  （`apps/mobile/src/features/collection/ghost.ts` が読む形）。

  `vocab.pos3`（`06_umap_coords.py` の出力）が 1 語でも欠けていたら **既定では
  SystemExit で止まる**。偽の座標をコミットさせないための安全弁で、06 を回す前に
  図鑑の画面を作りたいときだけ `--allow-fallback` で明示的に外す。

  `--allow-fallback` を付けたときは決定論的な疑似乱数で球面上に配置するが、
  **`word` は空文字にする**。`ghost.ts` の `generateFallbackGhosts`（端末側の
  フォールバック）と意味を揃えるためで、こうしておくと `parseGhostJson` が
  空語の行を落とし、`hasRealGhosts()` が false を返す。
  実在の語に疑似乱数座標を貼ると、図鑑が「まだ出会っていない 2,000 語」と称して
  偽の位置を本物として見せてしまう（`apps/mobile/src/app/(tabs)/space/index.tsx`）。

使い方:
    uv run python scripts/10_mobile_assets.py
    uv run python scripts/10_mobile_assets.py --ghost-count 100  # 動作確認
    uv run python scripts/10_mobile_assets.py --allow-fallback   # 06 の前に画面だけ作る
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from random import Random

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import database_url  # noqa: E402
from _constants import (  # noqa: E402
    GHOST_FALLBACK_RADIUS_MIN,
    GHOST_FALLBACK_SEED,
    GHOST_FALLBACK_WORD,
    GHOST_POS3_DECIMALS,
    SPACE_GHOST_COUNT,
)
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


def fetch_ghost_rows(
    conn: psycopg.Connection, count: int
) -> list[tuple[str, list[float] | None]]:
    rows = conn.execute(
        "SELECT word, pos3 FROM vocab WHERE is_output ORDER BY freq_rank LIMIT %s",
        (count,),
    ).fetchall()
    return [(r[0], list(r[1]) if r[1] is not None else None) for r in rows]


def fallback_sphere_pos3(index: int, total: int, rng: Random) -> list[float]:
    """決定論的な疑似乱数で球面上に配置する（フィボナッチ格子 + 半径のゆらぎ）。

    `apps/mobile/src/features/collection/ghost.ts` の `generateFallbackGhosts`
    （ghost.json が空のときの端末側フォールバック）と同じ考え方・同じ定数。
    **座標が偽物である以上、語も載せない**（`build_ghost_points` が `word` を
    空文字にする）。実語 + 偽座標は「本物の図鑑」として表示されてしまう。
    """
    golden_angle = math.pi * (3 - math.sqrt(5))
    y = 1 - (index / max(total - 1, 1)) * 2
    ring = math.sqrt(max(0.0, 1 - y * y))
    theta = golden_angle * index
    radius = GHOST_FALLBACK_RADIUS_MIN + (1 - GHOST_FALLBACK_RADIUS_MIN) * rng.random()
    return [
        round(math.cos(theta) * ring * radius, GHOST_POS3_DECIMALS),
        round(y * radius, GHOST_POS3_DECIMALS),
        round(math.sin(theta) * ring * radius, GHOST_POS3_DECIMALS),
    ]


def build_ghost_points(
    rows: list[tuple[str, list[float] | None]],
) -> tuple[list[dict[str, object]], bool]:
    """(ghost.json に書く配列, 実座標を使ったか) を返す。

    一部の語だけ pos3 が計算済みという状態は、本物と疑似乱数が混ざった図鑑に
    なってしまうので避ける。**全語に pos3 があるときだけ実座標を使う**。

    フォールバック側は座標だけでなく `word` も捨てて空文字にする。`ghost.ts` の
    `parseGhostJson` は空語の行を落とすので、端末では `generateFallbackGhosts`
    と同じ状態（`hasRealGhosts() === false`）になり、偽の座標が「本物の語の位置」
    として表示されることがなくなる。
    """
    has_all_real = len(rows) > 0 and all(pos3 is not None for _w, pos3 in rows)
    if has_all_real:
        points = [
            {"word": word, "pos3": [round(v, GHOST_POS3_DECIMALS) for v in pos3]}
            for word, pos3 in rows
            if pos3 is not None
        ]
        return points, True

    rng = Random(GHOST_FALLBACK_SEED)
    total = len(rows)
    points: list[dict[str, object]] = [
        {"word": GHOST_FALLBACK_WORD, "pos3": fallback_sphere_pos3(i, total, rng)}
        for i in range(total)
    ]
    return points, False


def write_ghost_json(points: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(points, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    size = path.stat().st_size
    print(
        f"{path}: {len(points)} 点 / {size / 1e3:.1f}KB を書き込みました",
        file=sys.stderr,
    )


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
    ap.add_argument(
        "--allow-fallback",
        action="store_true",
        help="pos3 が未計算でも疑似乱数の座標（語は空文字）で ghost.json を書く",
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
            rows = fetch_ghost_rows(conn, args.ghost_count)
            if not rows:
                raise SystemExit(
                    "vocab.is_output が 0 件です。02_prune.py / 03_export_pgvector.py を"
                    "先に実行してください。"
                )
            points, used_real = build_ghost_points(rows)
            if not used_real:
                missing = sum(1 for _w, pos3 in rows if pos3 is None)
                if not args.allow_fallback:
                    raise SystemExit(
                        f"vocab.pos3 が未計算の語が {missing}/{len(rows)} 語あります。"
                        "偽の座標をコミットしないため、ghost.json は書き換えません。"
                        "06_umap_coords.py（pnpm pipeline:umap）を実行してから"
                        "もう一度走らせてください。"
                        "06 の前に図鑑の画面だけ作りたい場合は --allow-fallback を付けます"
                        "（そのときは語を空文字にするので、端末側は "
                        "generateFallbackGhosts と同じ「偽物」の表示になります）。"
                    )
                print(
                    f"※ vocab.pos3 が未計算の語が {missing}/{len(rows)} 語あります。"
                    "--allow-fallback 付きなので、決定論的な疑似乱数で球面に配置し、"
                    "語は空文字にしました（端末側では hasRealGhosts() が false になります）。"
                    "06_umap_coords.py を実行後、このスクリプトを再実行して"
                    "本物の座標に差し替えてください。",
                    file=sys.stderr,
                )
            write_ghost_json(points, GHOST_JSON_PATH)

    print(f"完了（{time.time() - t0:.1f}s）", file=sys.stderr)


if __name__ == "__main__":
    main()
