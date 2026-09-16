"""WikiEntVec の 200d ベクトルを取ってきて展開する（SPEC §4.1）。

**冪等**。`data/jawiki.200d.txt` があれば何もしない。`.bz2` だけあるなら展開だけする。
途中で切れたダウンロードは `.part` から Range で再開する。

使い方:
    uv run python scripts/01_download.py
    uv run python scripts/01_download.py --force        # 全部やり直す
    uv run python scripts/01_download.py --keep-archive # .bz2 を残す
"""

from __future__ import annotations

import argparse
import bz2
import sys
import time
from pathlib import Path

import httpx
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import DATA_DIR, DIM, VECTORS_TXT  # noqa: E402
from _constants import (  # noqa: E402
    DOWNLOAD_CHUNK_BYTES,
    DOWNLOAD_TIMEOUT_SEC,
    WIKIENTVEC_TOTAL_WORDS,
    WIKIENTVEC_URL,
)

ARCHIVE_PATH = DATA_DIR / "jawiki.200d.txt.bz2"


def verify_header(path: Path) -> tuple[int, int]:
    """1 行目の `<語数> <次元>` を読んで検証する。"""
    with path.open(encoding="utf-8") as fh:
        parts = fh.readline().split()
    if len(parts) != 2:
        raise SystemExit(f"{path.name} のヘッダが読めません: {parts[:4]}")
    total, dim = int(parts[0]), int(parts[1])
    if dim != DIM:
        raise SystemExit(f"次元が想定外です: {dim}（期待 {DIM}）")
    if total != WIKIENTVEC_TOTAL_WORDS:
        print(
            f"※ 語数が想定と違います: {total}（期待 {WIKIENTVEC_TOTAL_WORDS}）。"
            "配布物が差し替わった可能性があります。",
            file=sys.stderr,
        )
    return total, dim


def download(url: str, dest: Path) -> None:
    """Range で再開できるストリーミングダウンロード。"""
    part = dest.with_suffix(dest.suffix + ".part")
    done = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={done}-"} if done else {}

    with (
        httpx.Client(follow_redirects=True, timeout=DOWNLOAD_TIMEOUT_SEC) as client,
        client.stream("GET", url, headers=headers) as res,
    ):
        res.raise_for_status()
        if done and res.status_code == httpx.codes.OK:
            # サーバーが Range を無視して先頭から返してきたので、最初から書き直す。
            done = 0
        length = int(res.headers.get("content-length", 0))
        bar = tqdm(
            total=length + done or None,
            initial=done,
            unit="B",
            unit_scale=True,
            desc="download",
            file=sys.stderr,
        )
        mode = "ab" if done else "wb"
        with part.open(mode) as fh:
            for chunk in res.iter_bytes(DOWNLOAD_CHUNK_BYTES):
                fh.write(chunk)
                bar.update(len(chunk))
        bar.close()
    part.replace(dest)


def decompress(src: Path, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    total = src.stat().st_size
    bar = tqdm(total=total, unit="B", unit_scale=True, desc="decompress", file=sys.stderr)
    with open(src, "rb") as raw, bz2.BZ2File(raw) as fh, tmp.open("wb") as out:
        while True:
            chunk = fh.read(DOWNLOAD_CHUNK_BYTES)
            if not chunk:
                break
            out.write(chunk)
            bar.n = raw.tell()
            bar.refresh()
    bar.close()
    tmp.replace(dest)


def main() -> None:
    ap = argparse.ArgumentParser(description="WikiEntVec の 200d ベクトルを取得する")
    ap.add_argument("--url", default=WIKIENTVEC_URL)
    ap.add_argument("--force", action="store_true", help="既にあっても取り直す")
    ap.add_argument("--keep-archive", action="store_true", help="展開後も .bz2 を残す")
    args = ap.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    if VECTORS_TXT.exists() and not args.force:
        total, dim = verify_header(VECTORS_TXT)
        size_gb = VECTORS_TXT.stat().st_size / 1e9
        print(
            f"skip: {VECTORS_TXT} は既にあります（{total} 語 × {dim} 次元 / {size_gb:.2f}GB）",
            file=sys.stderr,
        )
        return

    if not ARCHIVE_PATH.exists() or args.force:
        print(f"ダウンロード: {args.url}", file=sys.stderr)
        download(args.url, ARCHIVE_PATH)
    else:
        print(f"skip: {ARCHIVE_PATH.name} は既にあります", file=sys.stderr)

    print(f"展開: {ARCHIVE_PATH.name} → {VECTORS_TXT.name}", file=sys.stderr)
    decompress(ARCHIVE_PATH, VECTORS_TXT)
    total, dim = verify_header(VECTORS_TXT)

    if not args.keep_archive:
        ARCHIVE_PATH.unlink(missing_ok=True)
        print(f"{ARCHIVE_PATH.name} を削除しました（--keep-archive で残せます）", file=sys.stderr)

    print(
        f"完了: {VECTORS_TXT} （{total} 語 × {dim} 次元 / {time.time() - t0:.0f}s）",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
