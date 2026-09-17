"""効果音を合成して `apps/mobile/assets/sounds/` に書き出す。

- 生成の純粋関数は `sounds_lib.py`（テストしやすくするため分離）。
- 音源はサイン波の合成のみ（外部素材ゼロ＝ライセンス問題ゼロ）。
- サンプリングレート 44,100Hz・モノラル・16bit PCM WAV。
- 生成物はリポジトリにコミットする（パイプライン未実行の環境でも鳴るように）。

使い方:
    uv run python scripts/11_sounds.py
    uv run python scripts/11_sounds.py --dry-run   # 書き込まず一覧とサイズ目安を出す
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sounds_lib import SOUND_IDS, render, write_wav  # noqa: E402

SAMPLE_RATE = 44_100

MOBILE_SOUNDS_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "apps"
    / "mobile"
    / "assets"
    / "sounds"
)


def main() -> None:
    ap = argparse.ArgumentParser(description="効果音を合成して apps/mobile/assets/sounds/ に書き出す")
    ap.add_argument(
        "--dry-run", action="store_true", help="ファイルに書かず、生成される音の一覧だけ出す"
    )
    ap.add_argument(
        "--sample-rate", type=int, default=SAMPLE_RATE, help="サンプリングレート（既定 44100Hz）"
    )
    args = ap.parse_args()

    t0 = time.time()
    total_bytes = 0
    for sound_id in SOUND_IDS:
        samples = render(sound_id, args.sample_rate)
        duration_ms = len(samples) / args.sample_rate * 1000
        size_bytes = len(samples) * 2  # 16bit = 2 bytes/sample
        total_bytes += size_bytes

        if args.dry_run:
            print(
                f"[dry-run] {sound_id}.wav: {duration_ms:.0f}ms / {size_bytes / 1e3:.1f}KB",
                file=sys.stderr,
            )
            continue

        path = MOBILE_SOUNDS_DIR / f"{sound_id}.wav"
        write_wav(path, samples, args.sample_rate)
        print(f"{path}: {duration_ms:.0f}ms / {size_bytes / 1e3:.1f}KB を書き込みました", file=sys.stderr)

    label = "(--dry-run なので書き込みません)" if args.dry_run else ""
    print(
        f"完了（{time.time() - t0:.2f}s、計 {total_bytes / 1e3:.1f}KB）{label}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
