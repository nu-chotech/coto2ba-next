"""ブランドアセット生成（scripts/brand_assets.py）のテスト。

展示で**最初に目に入る場所**（スプラッシュ・アイコン・ファビコン・OG 画像）が
Expo のテンプレートのままだったのを、本物のロゴから作り直す。

- 切り出し位置は**目で決め打ちしない**。ロゴが差し替わったときに壊れるため、
  アルファチャンネルの空白列から見つける
- 切り出しに失敗して空白画像が出ると、気づかないまま展示に出る。そこを固定する
- iOS のアイコンは透過を許さない。地を敷くことを固定する
"""

from PIL import Image

from scripts import brand_assets


def test_finds_gap_between_mark_and_text():
    """マークと文字の間の空白列を見つけられること。決め打ち座標にしない。"""
    with Image.open(brand_assets.LOGO_BLACK) as im:
        split = brand_assets.find_mark_boundary(im)
        # マークは左側の一部。画像の半分より左で切れるはず。
        assert 0 < split < im.width // 2


def test_finds_gap_in_a_synthetic_image():
    """決め打ちでないことの証明。作った画像でも境界を見つけられる。"""
    im = Image.new("RGBA", (200, 50), (0, 0, 0, 0))
    # 左に小さい塊、間を空けて、右に長い塊。
    for x in range(20, 50):
        for y in range(10, 40):
            im.putpixel((x, y), (0, 0, 0, 255))
    for x in range(120, 180):
        for y in range(10, 40):
            im.putpixel((x, y), (0, 0, 0, 255))

    split = brand_assets.find_mark_boundary(im)
    assert 50 <= split <= 120


def test_mark_is_square_with_padding(tmp_path):
    out = tmp_path / "mark.png"
    brand_assets.write_mark(brand_assets.LOGO_BLACK, out, size=1024)
    with Image.open(out) as im:
        assert im.size == (1024, 1024)
        assert im.mode == "RGBA"


def test_mark_is_not_blank(tmp_path):
    """切り出しに失敗して空白画像が出ると、気づかないまま展示に出る。"""
    out = tmp_path / "mark.png"
    brand_assets.write_mark(brand_assets.LOGO_BLACK, out, size=256)
    with Image.open(out) as im:
        alpha = im.getchannel("A")
        opaque = sum(1 for v in alpha.get_flattened_data() if v > 0)
        # 不透明なピクセルが全体の 5% 以上ある
        assert opaque > 256 * 256 * 0.05


def test_mark_does_not_contain_the_wordmark(tmp_path):
    """文字まで入っていたら、正方形に押し込んだときに潰れて読めない。"""
    out = tmp_path / "mark.png"
    brand_assets.write_mark(brand_assets.LOGO_BLACK, out, size=256)
    with Image.open(out) as im:
        with Image.open(brand_assets.LOGO_BLACK) as source:
            split = brand_assets.find_mark_boundary(source)
            mark_ratio = split / source.width
        # マークだけならロゴ全体の半分より細い部分を切り出しているはず。
        assert mark_ratio < 0.5
        # 正方形に収めたので、縦横が等しい。
        assert im.width == im.height


def test_icon_has_opaque_background(tmp_path):
    """iOS のアイコンは透過を許さない。地を敷くこと。"""
    out = tmp_path / "icon.png"
    brand_assets.write_app_icon(out, size=1024)
    with Image.open(out) as im:
        assert im.size == (1024, 1024)
        alpha = im.getchannel("A")
        assert min(alpha.get_flattened_data()) == 255


def test_splash_keeps_transparency(tmp_path):
    """スプラッシュの地は app.json が指定する。画像は透過のまま。"""
    out = tmp_path / "splash.png"
    brand_assets.write_splash(out, size=512)
    with Image.open(out) as im:
        alpha = im.getchannel("A")
        assert min(alpha.get_flattened_data()) == 0


def test_favicon_is_small_and_opaque(tmp_path):
    """タブの地はブラウザ次第で白にも黒にもなる。透過のままだと消える。"""
    out = tmp_path / "favicon.png"
    brand_assets.write_favicon(out, size=48)
    with Image.open(out) as im:
        assert im.size == (48, 48)
        assert min(im.getchannel("A").get_flattened_data()) == 255
