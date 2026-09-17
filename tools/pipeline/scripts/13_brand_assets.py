"""ブランドアセットをロゴから生成する。

展示で**最初に目に入る場所**が Expo のテンプレートのままだったので、
`apps/mobile/assets/images/logo-{black,white}.png` から作り直す。

書き出すもの:

| ファイル | 中身 |
| --- | --- |
| `logo-mark-black.png` / `logo-mark-white.png` | 鍋のマークだけを切り出した正方形（1024） |
| `splash-icon.png` / `splash-icon-dark.png` | スプラッシュのマーク（透過。地は app.json が塗る） |
| `icon.png` | アプリアイコン（1024、**透過なし**） |
| `favicon.png` | Web のタブ（48） |
| `android-icon-{foreground,background,monochrome}.png` | Android のアダプティブアイコン |
| `apps/landing/favicon.png` / `apple-touch-icon.png` / `og.png` | ランディング |

切り出しの理屈と関数は `scripts/brand_assets.py`。**座標は目で決め打ちしない**
（ロゴが差し替わったときに黙って壊れるため）。

使い方:
    uv run python scripts/13_brand_assets.py
    uv run python scripts/13_brand_assets.py --check   # 書かずに差分だけ見る
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brand_assets as ba  # noqa: E402

MOBILE_IMAGES = ba.IMAGES_DIR
LANDING_DIR = ba.REPO_ROOT / "apps" / "landing"

#: アプリアイコン。ストアもホーム画面もこの 1 枚から作られる。
ICON_SIZE = 1024
#: スプラッシュ。app.json の imageWidth より大きく書き出しておく（縮小されるだけ）。
SPLASH_SIZE = 1024
#: 切り出したマークの保存サイズ。他のアセットの元になる。
MARK_SIZE = 1024
FAVICON_SIZE = 48
APPLE_TOUCH_SIZE = 180
#: OG 画像。X / Slack が 1.91:1 で切るので、その比率で作る。
OG_WIDTH = 1200
OG_HEIGHT = 630
#: OG 画像の中のロゴの幅（画像の幅に対する比）。
OG_LOGO_WIDTH_RATIO = 0.62


def write_og_image(out: Path) -> Path:
    """ランディングの OG 画像。暗い地に白のワードマークを 1 つ置くだけ。

    文字を描き足さない（フォントの同梱が要るうえ、ロゴ自体が作品名を持っている）。
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (OG_WIDTH, OG_HEIGHT), ba.DARK_BASE)

    with Image.open(ba.LOGO_WHITE) as opened:
        logo = opened.convert("RGBA")
        width = round(OG_WIDTH * OG_LOGO_WIDTH_RATIO)
        height = round(width * logo.height / logo.width)
        resized = logo.resize((width, height), Image.LANCZOS)

    canvas.alpha_composite(resized, ((OG_WIDTH - width) // 2, (OG_HEIGHT - height) // 2))
    canvas.convert("RGB").save(out, format="PNG")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="書かずに出力先だけ表示する")
    args = parser.parse_args()

    targets = [
        (MOBILE_IMAGES / "logo-mark-black.png", "マーク（黒）"),
        (MOBILE_IMAGES / "logo-mark-white.png", "マーク（白）"),
        (MOBILE_IMAGES / "splash-icon.png", "スプラッシュ（ライト）"),
        (MOBILE_IMAGES / "splash-icon-dark.png", "スプラッシュ（ダーク）"),
        (MOBILE_IMAGES / "icon.png", "アプリアイコン"),
        (MOBILE_IMAGES / "favicon.png", "Web のタブ"),
        (MOBILE_IMAGES / "android-icon-foreground.png", "Android の前景"),
        (MOBILE_IMAGES / "android-icon-background.png", "Android の地"),
        (MOBILE_IMAGES / "android-icon-monochrome.png", "Android のモノクロ"),
        (LANDING_DIR / "favicon.png", "ランディングのタブ"),
        (LANDING_DIR / "apple-touch-icon.png", "ランディングのホーム画面"),
        (LANDING_DIR / "og.png", "ランディングの OG 画像"),
    ]

    if args.check:
        for path, label in targets:
            print(f"{'あり' if path.exists() else 'なし'}  {label}: {path}")
        return

    ba.write_mark(ba.LOGO_BLACK, MOBILE_IMAGES / "logo-mark-black.png", MARK_SIZE)
    ba.write_mark(ba.LOGO_WHITE, MOBILE_IMAGES / "logo-mark-white.png", MARK_SIZE)
    # スプラッシュは地がライト / ダークで変わるので 2 枚。白い地に白マークは見えない。
    ba.write_splash(MOBILE_IMAGES / "splash-icon.png", SPLASH_SIZE, source=ba.LOGO_BLACK)
    ba.write_splash(MOBILE_IMAGES / "splash-icon-dark.png", SPLASH_SIZE, source=ba.LOGO_WHITE)
    ba.write_app_icon(MOBILE_IMAGES / "icon.png", ICON_SIZE)
    ba.write_favicon(MOBILE_IMAGES / "favicon.png", FAVICON_SIZE)
    # Android は前景・地・モノクロの 3 枚。前景は中央 66% の安全域に収まっている。
    ba.write_adaptive_foreground(MOBILE_IMAGES / "android-icon-foreground.png", ICON_SIZE)
    ba.write_adaptive_background(MOBILE_IMAGES / "android-icon-background.png", ICON_SIZE)
    ba.write_adaptive_foreground(MOBILE_IMAGES / "android-icon-monochrome.png", ICON_SIZE)
    ba.write_favicon(LANDING_DIR / "favicon.png", FAVICON_SIZE)
    ba.write_favicon(LANDING_DIR / "apple-touch-icon.png", APPLE_TOUCH_SIZE)
    write_og_image(LANDING_DIR / "og.png")

    for path, label in targets:
        size = path.stat().st_size if path.exists() else 0
        print(f"書いた  {label}: {path.relative_to(ba.REPO_ROOT)}  ({size:,} バイト)")


if __name__ == "__main__":
    main()
