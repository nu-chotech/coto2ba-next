# assets/sounds

効果音の出典をここに書く（CC0 のパック、または自作）。**素材はまだ未用意（SPEC §14 の TBD）。**

ファイルを置いたら `src/lib/sounds.ts` の `SOUND_MODULES` の該当行のコメントを外すだけで鳴る。
イベントと音の対応表は `src/lib/feedback.ts` にある（対応表はそこ 1 箇所だけ）。

| ファイル名 | 用途 | 出典 |
| --- | --- | --- |
| `detent.m4a` | スライダーの段階 | TBD |
| `mix.m4a` | 混合演出（600ms） | TBD |
| `closer.m4a` | ランクが縮んだ | TBD |
| `farther.m4a` | ランクが広がった | TBD |
| `tier_up.m4a` | tier 上昇のスティング | TBD |
| `clear.m4a` | クリア（ファンファーレ 2 秒） | TBD |
| `perfect.m4a` | 完全錬成の追加音 | TBD |
| `page.m4a` | ヒントを開く | TBD |
| `error.m4a` | 辞書に無い語 | TBD |
| `badge.m4a` | 実績解除 | TBD |
