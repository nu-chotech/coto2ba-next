"""効果音合成の純粋関数群（docs/superpowers/plans/2026-09-17-synth-sounds.md）。

**設計方針（「静かな土台＋演出で爆発」）**:

- 全音を**同じ倍音構成**（基音 + オクターブ上を控えめに）から作る。音色を統一するため、
  この比率は `HARMONICS` の 1 箇所だけで決める。個々の音を区別するのは音高・
  エンベロープ（アタック/リリース）・音の並び（単音か 2 音か和音か）・音量だけにする。
- 高い倍音を持たない（基音は最高でも C6 ≈ 1047Hz、2 倍音でも ≈ 2094Hz）ので、
  耳に痛い 3〜5kHz 帯の強いピークが原理的に出ない。
- エンベロープは常に 0 から始まり 0 で終わる（レイズドコサインで滑らかに）。
  ゲート的な矩形窓は使わない＝プチッというクリックノイズが出ない。
- `detent` / `page` はごく短く低ゲイン（気配レベル）。`clear` / `perfect` だけ
  複数ノートを重ねた分散和音で厚くする。
- `farther` / `error` は音階を C メジャーの協和音程（長 3 度）に収め、
  不協和音や急な音量で「責める音」にならないようにする。

`SOUND_IDS` は `apps/mobile/src/lib/sounds.ts` の並びと**手で同期**すること
（TS なので import できない。`_constants.py` の先頭コメントと同じ事情）。
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

# apps/mobile/src/lib/sounds.ts の SOUND_IDS と同一の並び。ズレたら両方直すこと。
SOUND_IDS: tuple[str, ...] = (
    "detent",
    "mix",
    "closer",
    "farther",
    "tier_up",
    "clear",
    "perfect",
    "page",
    "error",
    "badge",
)

# 基音 (倍音次数=1, 振幅=1.0) + オクターブ上 (次数=2) を控えめに足すだけ。
# 全音で共有する唯一の倍音構成（音色の統一）。
HARMONICS: tuple[tuple[int, float], ...] = ((1, 1.0), (2, 0.16))

# 音階（C メジャーの範囲に収め、常に協和させる）。
NOTE_HZ = {
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "G4": 392.00,
    "A4": 440.00,
    "C5": 523.25,
    "D5": 587.33,
    "E5": 659.25,
    "G5": 783.99,
    "A5": 880.00,
    "C6": 1046.50,
}

# 波形が最終的にこれを超えたときだけ縮める（ピークリミッタ）。
# 静かな音を無理に持ち上げない＝控えめな音は控えめなまま。
PEAK_LIMIT = 1.0


def envelope(n: int, attack: float, release: float) -> np.ndarray:
    """0 → 1 → 0 のレイズドコサイン包絡線。

    `attack` / `release` は全体の長さ `n` に対する比率（0..1）。
    立ち上がり・終わりは必ず厳密に 0 になる（クリックノイズ防止）。
    """
    env = np.ones(n, dtype=np.float64)
    attack = max(0.0, min(1.0, attack))
    release = max(0.0, min(1.0 - attack, release))
    a_n = min(round(n * attack), n)
    r_n = min(round(n * release), n - a_n)
    if a_n > 0:
        env[:a_n] = 0.5 * (1.0 - np.cos(np.linspace(0.0, np.pi, a_n)))
    if r_n > 0:
        env[n - r_n :] = 0.5 * (1.0 + np.cos(np.linspace(0.0, np.pi, r_n)))
    return env


def tone(
    freq: float,
    seconds: float,
    sample_rate: int,
    harmonics: tuple[tuple[int, float], ...] = HARMONICS,
) -> np.ndarray:
    """`harmonics` の重ね合わせでできる、正規化済み（-1..1）のサイン波。

    振幅の合計で割るので、三角不等式より結果は常に -1..1 に収まる
    （実際の波形の最大値を都度計算する必要が無く、決定的）。
    """
    n = max(1, round(seconds * sample_rate))
    t = np.arange(n, dtype=np.float64) / sample_rate
    wave_sum = np.zeros(n, dtype=np.float64)
    for multiple, amp in harmonics:
        wave_sum += amp * np.sin(2.0 * np.pi * freq * multiple * t)
    total_amp = sum(amp for _, amp in harmonics)
    return wave_sum / total_amp


def _note(
    freq: float,
    dur_ms: float,
    attack_ms: float,
    release_ms: float,
    sample_rate: int,
    gain: float,
) -> np.ndarray:
    """1 音ぶんの波形（包絡線込み・ゲイン適用済み）。"""
    seconds = dur_ms / 1000.0
    attack = attack_ms / dur_ms
    release = release_ms / dur_ms
    return tone(freq, seconds, sample_rate) * envelope(
        max(1, round(seconds * sample_rate)), attack, release
    ) * gain


def _mix(notes: list[tuple[np.ndarray, int]], total_samples: int) -> np.ndarray:
    """`(波形, 開始サンプル)` のリストを 1 本のバッファに重ねる。

    合計がピークを超えたときだけ縮める（ピークリミッタ）。静かな音を
    ゼロから持ち上げることはしない＝控えめな音は控えめなまま鳴る。
    """
    buf = np.zeros(total_samples, dtype=np.float64)
    for wave_arr, start in notes:
        end = min(total_samples, start + len(wave_arr))
        if end <= start:
            continue
        buf[start:end] += wave_arr[: end - start]
    peak = float(np.max(np.abs(buf))) if buf.size else 0.0
    if peak > PEAK_LIMIT:
        buf = buf * (PEAK_LIMIT / peak)
    return buf


def _ms_to_samples(ms: float, sample_rate: int) -> int:
    return round(ms / 1000.0 * sample_rate)


def render(sound_id: str, sample_rate: int) -> np.ndarray:
    """`sound_id` の波形を生成する（決定的、副作用なし）。"""
    if sound_id == "detent":
        # ホイールの段。極小・クリック感だけ（気配レベル）。
        return _note(NOTE_HZ["D5"], dur_ms=30, attack_ms=3, release_ms=20, sample_rate=sample_rate, gain=0.16)

    if sound_id == "page":
        # 画面遷移。ほぼ気配。detent よりさらに柔らかい包絡線。
        return _note(NOTE_HZ["A4"], dur_ms=60, attack_ms=12, release_ms=42, sample_rate=sample_rate, gain=0.13)

    if sound_id == "mix":
        # 混ぜる。短い立ち上がりで軽く弾む。
        return _note(NOTE_HZ["C5"], dur_ms=120, attack_ms=8, release_ms=95, sample_rate=sample_rate, gain=0.34)

    if sound_id == "closer":
        # 近づいた。上行（長 3 度）。2 音をわずかに重ねてレガート気味に。
        total_ms = 200
        total_samples = _ms_to_samples(total_ms, sample_rate)
        n1 = _note(NOTE_HZ["C5"], dur_ms=110, attack_ms=6, release_ms=90, sample_rate=sample_rate, gain=0.38)
        n2 = _note(NOTE_HZ["E5"], dur_ms=110, attack_ms=8, release_ms=95, sample_rate=sample_rate, gain=0.36)
        return _mix([(n1, 0), (n2, _ms_to_samples(90, sample_rate))], total_samples)

    if sound_id == "farther":
        # 遠ざかった。下行（長 3 度、closer の逆）。責めない協和音程・低めの音量。
        total_ms = 200
        total_samples = _ms_to_samples(total_ms, sample_rate)
        n1 = _note(NOTE_HZ["E5"], dur_ms=110, attack_ms=10, release_ms=95, sample_rate=sample_rate, gain=0.28)
        n2 = _note(NOTE_HZ["C5"], dur_ms=110, attack_ms=12, release_ms=95, sample_rate=sample_rate, gain=0.26)
        return _mix([(n1, 0), (n2, _ms_to_samples(90, sample_rate))], total_samples)

    if sound_id == "tier_up":
        # 帯が上がった。上行 2 音（完全 5 度）でしっかりめに。
        total_ms = 300
        total_samples = _ms_to_samples(total_ms, sample_rate)
        n1 = _note(NOTE_HZ["C5"], dur_ms=150, attack_ms=6, release_ms=130, sample_rate=sample_rate, gain=0.44)
        n2 = _note(NOTE_HZ["G5"], dur_ms=160, attack_ms=8, release_ms=140, sample_rate=sample_rate, gain=0.46)
        return _mix([(n1, 0), (n2, _ms_to_samples(130, sample_rate))], total_samples)

    if sound_id == "error":
        # 弾かれた。低め・短い。不快にしないため協和的な低音を柔らかい包絡線で。
        return _note(NOTE_HZ["C4"], dur_ms=120, attack_ms=10, release_ms=95, sample_rate=sample_rate, gain=0.3)

    if sound_id == "badge":
        # 実績。澄んだ 1 音。ゆったりしたリリースで余韻を残す。
        return _note(NOTE_HZ["G5"], dur_ms=300, attack_ms=15, release_ms=250, sample_rate=sample_rate, gain=0.42)

    if sound_id == "clear":
        # クリア。ここだけ厚い。C メジャーの分散和音（アルペジオ）。
        total_ms = 800
        total_samples = _ms_to_samples(total_ms, sample_rate)
        notes = [
            (_note(NOTE_HZ["C5"], 620, 6, 560, sample_rate, 0.7), 0),
            (_note(NOTE_HZ["E5"], 560, 8, 500, sample_rate, 0.66), _ms_to_samples(60, sample_rate)),
            (_note(NOTE_HZ["G5"], 500, 10, 440, sample_rate, 0.62), _ms_to_samples(120, sample_rate)),
        ]
        return _mix(notes, total_samples)

    if sound_id == "perfect":
        # 完全錬成。clear の上位。オクターブ上を足してさらに長く厚く。
        total_ms = 1000
        total_samples = _ms_to_samples(total_ms, sample_rate)
        notes = [
            (_note(NOTE_HZ["C5"], 780, 6, 700, sample_rate, 0.78), 0),
            (_note(NOTE_HZ["E5"], 720, 8, 640, sample_rate, 0.74), _ms_to_samples(70, sample_rate)),
            (_note(NOTE_HZ["G5"], 660, 10, 580, sample_rate, 0.7), _ms_to_samples(140, sample_rate)),
            (_note(NOTE_HZ["C6"], 560, 10, 500, sample_rate, 0.5), _ms_to_samples(210, sample_rate)),
        ]
        return _mix(notes, total_samples)

    msg = f"未知の sound_id: {sound_id!r}"
    raise ValueError(msg)


def write_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    """モノラル 16bit PCM WAV として書き出す。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(samples, -1.0, 1.0)
    ints = np.round(clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(ints.tobytes())
