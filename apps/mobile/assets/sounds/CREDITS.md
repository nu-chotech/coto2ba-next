# assets/sounds

すべて自作・合成音源（**外部素材ゼロ、ライセンス上の制約なし**）。

`tools/pipeline/scripts/sounds_lib.py`（純粋な生成関数）と `11_sounds.py`（CLI）で
サイン波から合成している。生成コマンド:

```
pnpm pipeline:sounds
```

設計方針（docs/superpowers/plans/2026-09-17-synth-sounds.md、
docs/superpowers/specs/2026-09-17-exhibition-ux-overhaul-design.md §8）:

- 全音を**同じ倍音構成**（基音 + オクターブ上を控えめに、`sounds_lib.HARMONICS`）から作り、
  エンベロープ（レイズドコサインで 0 → 1 → 0、クリックノイズ無し）と音高・音の並びだけを
  変えて音色を統一している。
- 耳に痛い 3〜5kHz の強いピークを避けている（基音は最高でも C6 ≈ 1047Hz）。
- 「静かな土台＋演出で爆発」: `detent` / `page` はほぼ気配レベル、`clear` / `perfect` だけ
  分散和音で厚くしている。
- `farther` / `error` は協和音程（長 3 度）に収め、責める音・不快な音にならないようにしている。

フォーマット: 44,100Hz モノラル 16bit PCM WAV。

`src/lib/sounds.ts` の `SOUND_MODULES` が読み込む。イベントと音の対応表は
`src/lib/feedback.ts` にある（対応表はそこ 1 箇所だけ）。

| ファイル名 | 用途 | 長さ |
| --- | --- | --- |
| `detent.wav` | スライダーの段階 | 30ms |
| `mix.wav` | 混合演出の立ち上がり | 120ms |
| `closer.wav` | ランクが縮んだ（上行） | 200ms |
| `farther.wav` | ランクが広がった（下行、責めない音） | 200ms |
| `tier_up.wav` | tier 上昇のスティング（上行 2 音） | 300ms |
| `clear.wav` | クリア（分散和音、ここだけ厚い） | 800ms |
| `perfect.wav` | 完全錬成（clear の上位、さらに厚い） | 1,000ms |
| `page.wav` | ヒントを開く／画面遷移（気配レベル） | 60ms |
| `error.wav` | 辞書に無い語（低め・不快にしない） | 120ms |
| `badge.wav` | 実績解除（澄んだ1音） | 300ms |
