# 合成効果音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 無音の `assets/sounds/` を埋め、「混ぜた瞬間」と「クリア」に手応えを与える。音色は 1 つの設計から生成して全イベントで統一する。

**Architecture:** Expo Go ではネイティブのシステムサウンド API を叩けないので、`expo-audio` で同梱ファイルを鳴らす。素材は外部パックに頼らず Python で生成する（ライセンス問題ゼロ、音色を完全に統一できる、会場で浮かない）。イベント対応表は既存の `feedback.ts` をそのまま使う。

**Tech Stack:** Python 3 (`wave` 標準ライブラリ + numpy), uv, expo-audio

**Spec:** `docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md` §8

## Global Constraints

- Expo Go で動くこと。**ネイティブモジュールを追加しない**
  （`AudioServicesPlaySystemSound` 相当は使えない。これは確認済みの制約）
- トーンは「**静かな土台＋演出で爆発**」。通常操作の音は極めて控えめ、クリアだけ厚く
- **ファイルが無くても落ちない**現行の設計（`SOUND_MODULES` が空でも無音で動く）を壊さない
- `SOUND_IDS` は既存の 10 種を変えない:
  `detent` / `mix` / `closer` / `farther` / `tier_up` / `clear` / `perfect` / `page` / `error` / `badge`
- 生成物は**リポジトリにコミットする**（パイプライン未実行の環境でも鳴るように）
- Python は uv + ruff
- ハプティクスの既存実装は良い評価を得ている。**対応表と呼び出しを壊さない**

---

### Task 1: 音源を生成するスクリプトを書く

**Files:**
- Create: `tools/pipeline/scripts/11_sounds.py`
- Modify: `package.json`（`pipeline:sounds`）
- Test: `tools/pipeline/tests/test_sounds.py`（テスト置き場が無ければ既存の作法に合わせて作る）

**Interfaces:**
- Consumes: なし
- Produces: `apps/mobile/assets/sounds/<id>.wav` を 10 個

- [ ] **Step 1: 音の設計を決める**

全音を**同じ倍音構成**（基音＋オクターブ上を控えめに）から作り、
エンベロープと音高だけを変える。耳に痛い帯域（3〜5kHz の強いピーク）を避ける。

| id | 性格 | 長さの目安 |
| --- | --- | --- |
| `detent` | ホイールの段。**極小**、クリック感だけ | 30ms 前後 |
| `page` | 画面遷移。ほぼ気配 | 60ms 前後 |
| `mix` | 混ぜる。短い立ち上がり | 120ms 前後 |
| `closer` | 近づいた。上行 | 200ms 前後 |
| `farther` | 遠ざかった。下行。**責める音にしない** | 200ms 前後 |
| `tier_up` | 帯が上がった。上行 2 音 | 300ms 前後 |
| `badge` | 実績。澄んだ 1 音 | 300ms 前後 |
| `error` | 弾かれた。低め、短い。**不快にしない** | 120ms 前後 |
| `clear` | クリア。**ここだけ厚く**。和音の分散 | 800ms 前後 |
| `perfect` | 完全錬成。`clear` の上位。さらに厚く | 1,000ms 前後 |

サンプリングレートは 44,100Hz モノラル 16bit。全部合わせても数百 KB に収まる。

- [ ] **Step 2: Write the failing test**

`tools/pipeline/tests/test_sounds.py`:

```python
import wave
from pathlib import Path

import pytest

from scripts import sounds_lib  # 11_sounds.py から切り出した純粋な生成関数

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
```

`SOUND_IDS` は `apps/mobile/src/lib/sounds.ts` の 10 個と**同一の並び**にする。
ズレると気づけないので、**Python 側にも同じ一覧を定数で持ち、Task 3 で突き合わせる**。

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tools/pipeline && uv run pytest tests/test_sounds.py`
Expected: FAIL（モジュールが無い）

- [ ] **Step 4: 実装する**

`11_sounds.py` に CLI を、生成の純粋関数は `sounds_lib.py` に置く（テストしやすくするため）。
既存スクリプトの作法（`_common.py` のログ、`--dry-run`）に合わせる。

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tools/pipeline && uv run pytest tests/test_sounds.py && uv run ruff check .`
Expected: PASS

- [ ] **Step 6: 生成して耳で聴く**

Run: `pnpm pipeline:sounds`
生成された 10 個を実際に再生して確認する。
**「静かな土台」に合っているか**が基準。うるさい／安っぽいと感じたら設計に戻る。

- [ ] **Step 7: Commit**

```bash
git add tools/pipeline package.json apps/mobile/assets/sounds
git commit -m "feat(pipeline): 効果音を合成して生成する"
```

---

### Task 2: モバイルで鳴らす

**Files:**
- Modify: `apps/mobile/src/lib/sounds.ts`
- Modify: `apps/mobile/assets/sounds/CREDITS.md`
- Test: `apps/mobile/tests/sounds.test.ts`

**Interfaces:**
- Consumes: 生成済みの `assets/sounds/*.wav`
- Produces: `SOUND_MODULES` が全 10 種を登録した状態になる

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { SOUND_IDS, SOUND_MODULES } from '../src/lib/sounds'

describe('効果音の登録', () => {
  // 登録漏れは「その操作だけ無音」という気づきにくい形で出る。
  it('すべての SoundId にアセットが登録されている', () => {
    for (const id of SOUND_IDS) {
      expect(SOUND_MODULES[id], `${id} が未登録`).toBeDefined()
    }
  })

  it('登録されているのは SoundId だけ', () => {
    for (const key of Object.keys(SOUND_MODULES)) {
      expect(SOUND_IDS).toContain(key)
    }
  })
})
```

`require()` は vitest では解決できないので、テストは Metro のモックを入れるか、
**`SOUND_MODULES` のキー集合だけを検証する形**にする（値の中身は見ない）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coto2ba/mobile test sounds`
Expected: FAIL（全部未登録）

- [ ] **Step 3: `sounds.ts` のコメントアウトを外す**

拡張子を `.m4a` から `.wav` に変える。

```ts
export const SOUND_MODULES: Partial<Record<SoundId, number>> = {
  detent: require('../../assets/sounds/detent.wav'),
  mix: require('../../assets/sounds/mix.wav'),
  closer: require('../../assets/sounds/closer.wav'),
  farther: require('../../assets/sounds/farther.wav'),
  tier_up: require('../../assets/sounds/tier_up.wav'),
  clear: require('../../assets/sounds/clear.wav'),
  perfect: require('../../assets/sounds/perfect.wav'),
  page: require('../../assets/sounds/page.wav'),
  error: require('../../assets/sounds/error.wav'),
  badge: require('../../assets/sounds/badge.wav'),
}
```

ファイル冒頭の「素材はまだ無い」というコメントを実態に合わせて書き換える。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coto2ba/mobile test sounds`
Expected: PASS

- [ ] **Step 5: `CREDITS.md` を書く**

自作である旨、生成スクリプトの場所、ライセンス上の制約が無いことを明記する。

- [ ] **Step 6: Web プレビューで鳴ることを確認する**

Run: `pnpm --filter @coto2ba/mobile exec expo start --web`
ホイールを回す / 混ぜる / クリアする。
Expected: 鳴ること、うるさくないこと、混ぜてからクリアまでの落差が付いていること

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/sounds.ts apps/mobile/assets/sounds apps/mobile/tests
git commit -m "feat(mobile): 合成した効果音を鳴らす"
```
