"""効果音生成（scripts/sounds_lib.py）のテスト。

設計意図（docs/superpowers/plans/2026-09-17-synth-sounds.md）を数値で固定する:
- 立ち上がり・終わりは必ず 0（クリックノイズ防止）
- 波形は -1..1 に収まる（16bit 変換前のクリップ防止）
- 生成は決定的（差分が読める）
- 通常操作は控えめ、clear だけ厚い（「静かな土台＋演出で爆発」）
"""

import wave
from pathlib import Path

import pytest

from scripts import sounds_lib

SAMPLE_RATE = 44_100


def test_envelope_starts_and_ends_at_zero():
    """立ち上がり・終わりが 0 でないと、再生のたびにプチッと鳴る。"""
    env = sounds_lib.envelope(n=1000, attack=0.1, release=0.5)
    assert env[0] == pytest.approx(0.0, abs=1e-6)
    assert env[-1] == pytest.approx(0.0, abs=1e-6)
    assert max(env) > 0.9


def test_tone_stays_in_range():
    """16bit に変換する前に -1..1 を超えていると歪む。"""
    tone = sounds_lib.tone(freq=440.0, seconds=0.2, sample_rate=SAMPLE_RATE)
    assert tone.max() <= 1.0
    assert tone.min() >= -1.0


def test_render_is_deterministic():
    """毎回違うファイルが出ると差分が読めない。"""
    a = sounds_lib.render("detent", SAMPLE_RATE)
    b = sounds_lib.render("detent", SAMPLE_RATE)
    assert (a == b).all()


def test_all_sound_ids_render(tmp_path: Path):
    for sound_id in sounds_lib.SOUND_IDS:
        path = tmp_path / f"{sound_id}.wav"
        sounds_lib.write_wav(path, sounds_lib.render(sound_id, SAMPLE_RATE), SAMPLE_RATE)
        with wave.open(str(path)) as w:
            assert w.getnchannels() == 1
            assert w.getsampwidth() == 2
            assert w.getframerate() == SAMPLE_RATE
            assert w.getnframes() > 0


def test_clear_is_longer_than_detent():
    """設計意図（通常は控えめ、クリアだけ厚く）をテストで固定する。"""
    detent = sounds_lib.render("detent", SAMPLE_RATE)
    clear = sounds_lib.render("clear", SAMPLE_RATE)
    assert len(clear) > len(detent) * 10


def test_render_stays_in_range():
    """複数ノートを重ねる clear/perfect も -1..1 に収まる（ピークリミットの確認）。"""
    for sound_id in sounds_lib.SOUND_IDS:
        rendered = sounds_lib.render(sound_id, SAMPLE_RATE)
        assert rendered.max() <= 1.0
        assert rendered.min() >= -1.0


def test_normal_sounds_are_much_quieter_than_clear_and_perfect():
    """「静かな土台＋演出で爆発」をピーク振幅で固定する。"""
    quiet_ids = ("detent", "page", "mix", "closer", "farther", "tier_up", "error", "badge")
    clear_peak = float(sounds_lib.render("clear", SAMPLE_RATE).__abs__().max())
    perfect_peak = float(sounds_lib.render("perfect", SAMPLE_RATE).__abs__().max())
    for sound_id in quiet_ids:
        peak = float(sounds_lib.render(sound_id, SAMPLE_RATE).__abs__().max())
        assert peak < clear_peak
    assert perfect_peak >= clear_peak
