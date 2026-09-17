"""ブランドアセットをロゴ 1 枚から作る純粋関数群。

展示で**最初に目に入る場所**（QR を読んだ瞬間のスプラッシュ、持ち帰った人の
ホーム画面のアイコン、共有したときの OG 画像）が Expo のテンプレートのままだったので、
本物のロゴから作り直す。

ロゴは「蓋の開いた鍋＋キラキラ」のマーク（左）と「コトコトバ」の文字（右）が
横に並んだワードマーク。**マークだけを切り出すと正方形に近いアイコンが作れる。**

**切り出し位置を目で決め打ちしない。** ロゴは将来 "Next" を足したものに
差し替わる予定で、決め打ちの座標はそのとき黙って壊れる。アルファチャンネルの
「縦にまるごと空いている列」を探して、マークと文字の間の谷を自分で見つける。

色は `apps/mobile/src/theme/palettes.ts` と手で同期すること（TS なので import できない）。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

# ── 入力 ────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[3]
IMAGES_DIR = REPO_ROOT / "apps" / "mobile" / "assets" / "images"
LOGO_BLACK = IMAGES_DIR / "logo-black.png"
LOGO_WHITE = IMAGES_DIR / "logo-white.png"

# ── 色（apps/mobile/src/theme/palettes.ts と手で同期）────────
#: ダークの地。app.json のスプラッシュ（dark）と一致させる。
DARK_BASE = "#0B0B10"
#: ライトの地。app.json のスプラッシュ（既定）と一致させる。
LIGHT_BASE = "#F5F4F1"

# ── 切り出しのパラメータ ────────────────────────────────────
#: 「空いている列」と見なすアルファ合計のしきい値（最大列に対する比）。
#: ちょうど 0 だけを空白にすると、アンチエイリアスの薄い画素で谷が埋まる。
BLANK_COLUMN_RATIO = 0.005
#: 谷と見なす最小の幅（画像の幅に対する比）。字の間の細い隙間を谷と誤らないため。
MIN_GAP_RATIO = 0.02
#: 正方形に収めるときの余白（一辺に対する比）。アイコンは四隅が丸められるので広めに取る。
MARK_PADDING_RATIO = 0.12
#: アプリアイコンのマークの余白。iOS はさらに角を丸めるのでもう少し内側に置く。
ICON_PADDING_RATIO = 0.18
#: ファビコンの余白。16〜48px しかないので詰める。
FAVICON_PADDING_RATIO = 0.08
#: Android のアダプティブアイコンの余白。
#: システムが任意の形（丸・角丸・雫）で切り抜くので、**中央 66% の安全域**に収める。
ADAPTIVE_PADDING_RATIO = 0.27


def _column_alpha(image: Image.Image) -> list[int]:
    """列ごとのアルファの合計。"""
    alpha = image.convert("RGBA").getchannel("A")
    width, height = alpha.size
    return [sum(alpha.crop((x, 0, x + 1, height)).get_flattened_data()) for x in range(width)]


def _blank_runs(columns: list[int], threshold: float) -> list[tuple[int, int]]:
    """空いている列の連続した帯を `(始まり, 終わり)` で返す（終わりを含む）。"""
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x, value in enumerate(columns):
        if value <= threshold:
            if start is None:
                start = x
        elif start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, len(columns) - 1))
    return runs


def find_mark_boundary(image: Image.Image) -> int:
    """マークと文字の間の谷の中央の x 座標。

    左端の余白を飛ばし、**中身が始まったあとで最初に現れる十分な幅の谷**を返す。
    谷が見つからなければ、マークだけを切り出せないということなので `ValueError`。
    黙って真ん中で切ると、文字が半分入った変なアイコンが静かに出来上がる。
    """
    columns = _column_alpha(image)
    if not columns:
        raise ValueError("画像に列がない")

    threshold = max(columns) * BLANK_COLUMN_RATIO
    min_gap = max(1, int(len(columns) * MIN_GAP_RATIO))

    first_content = next((x for x, v in enumerate(columns) if v > threshold), None)
    if first_content is None:
        raise ValueError("ロゴが空白だった（アルファが全部 0）")

    for start, end in _blank_runs(columns, threshold):
        if start <= first_content:
            continue  # 左端の余白
        if end - start + 1 >= min_gap:
            return (start + end) // 2

    raise ValueError("マークと文字の間の空白が見つからなかった（ロゴの形が変わった？）")


def _trimmed_mark(source: Path) -> Image.Image:
    """境界より左を切り出し、まわりの余白を落としたマーク。"""
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
        split = find_mark_boundary(image)
        mark = image.crop((0, 0, split, image.height))

    box = mark.getchannel("A").getbbox()
    if box is None:
        raise ValueError("切り出したマークが空白だった")
    return mark.crop(box)


def _square(mark: Image.Image, size: int, padding_ratio: float) -> Image.Image:
    """正方形の中央にマークを置く（比率は保つ）。"""
    inner = max(1, int(size * (1 - padding_ratio * 2)))
    scale = min(inner / mark.width, inner / mark.height)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
        resized,
    )
    return canvas


def write_mark(source: Path, out: Path, size: int) -> Path:
    """マークだけを正方形の透過 PNG に書き出す。"""
    out.parent.mkdir(parents=True, exist_ok=True)
    _square(_trimmed_mark(source), size, MARK_PADDING_RATIO).save(out)
    return out


def write_app_icon(
    out: Path,
    size: int = 1024,
    background: str = DARK_BASE,
    padding_ratio: float = ICON_PADDING_RATIO,
) -> Path:
    """アプリアイコン。**アルファを残さない**（iOS のアイコンは透過を許さない）。

    暗い地に白のマークを置く。ホーム画面で他のアイコンに埋もれないよう、
    地は tier の mono と同じ `#0B0B10`。
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    mark = _square(_trimmed_mark(LOGO_WHITE), size, padding_ratio)
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(mark)
    canvas.save(out)
    return out


def write_splash(out: Path, size: int = 1024, source: Path = LOGO_WHITE) -> Path:
    """スプラッシュのマーク。**地は app.json が指定する**ので透過のまま書く。

    スプラッシュはライトとダークで別の地が来るので、**画像も 2 枚要る**
    （白い地に白マークを置いたら何も見えない）。`source` で選ぶこと。
    """
    return write_mark(source, out, size)


def write_adaptive_foreground(out: Path, size: int = 1024, source: Path = LOGO_WHITE) -> Path:
    """Android のアダプティブアイコンの前景。

    システムが任意の形で切り抜くので、**中央 66% の安全域**に収める。
    地は別レイヤー（`write_adaptive_background`）なので透過のまま。
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    _square(_trimmed_mark(source), size, ADAPTIVE_PADDING_RATIO).save(out)
    return out


def write_adaptive_background(out: Path, size: int = 1024, background: str = DARK_BASE) -> Path:
    """Android のアダプティブアイコンの地。単色で塗るだけ。"""
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (size, size), background).save(out)
    return out


def write_favicon(out: Path, size: int = 48) -> Path:
    """ブラウザのタブのアイコン。

    タブの地はブラウザのテーマ次第で白にも黒にもなるので、**透過にしない**。
    アプリアイコンと同じ「暗い地に白のマーク」を小さく敷く
    （小さいので余白は詰める）。
    """
    return write_app_icon(out, size, padding_ratio=FAVICON_PADDING_RATIO)
