# apps/landing

`index.html` 1 枚 + `vercel.json` だけの静的サイト。ビルド不要、外部 CDN 不使用（CSS/JS/画像はすべてインライン）。
`coto2ba-next.chotech.dev` に Vercel の別プロジェクトとして配置する（SPEC §11.2 / §11.4）。

## デプロイ

### 初回（プロジェクトのひも付け）

```sh
cd apps/landing
vercel link
# Root Directory: apps/landing
# Framework Preset: Other
```

`vercel link` で生成される `.vercel/project.json` の `orgId` / `projectId` を
GitHub Secrets の `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID_LANDING` に登録する
（`.github/workflows/deploy-landing.yml` が使う）。

### 手動デプロイ

```sh
cd apps/landing
vercel --prod
```

### CI からのデプロイ

`main` への push で `apps/landing/**` に変更があると `.github/workflows/deploy-landing.yml` が
自動デプロイする（`vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod`）。
`workflow_dispatch` からの手動実行もできる。

## ② 「コトコトバを開く」リンク

`index.html` の ②「コトコトバを開く」は、EAS Update で公開した `production` チャンネルを
Expo Go で直接開く `exp://` リンクを `href` に直書きした素の `<a>`（JS は使っていない）。
現在の値（実リンク・設定済み）:

```
exp://u.expo.dev/73c7cda9-727c-4b83-ba2e-674c38b951ae?channel-name=production&runtime-version=exposdk:57.0.0
```

（HTML 内では `&` を `&amp;` としてエスケープしてある。）

`projectId` は `apps/mobile/app.json` の `extra.eas.projectId`（owner: `ut42tech-hobby`、
EAS プロジェクト `@ut42tech-hobby/coto2ba-next`）。`apps/mobile/app.json` の
`updates.url` (`https://u.expo.dev/<projectId>`) と同じプロジェクトを指している。

**Phase 0 の完了条件（SPEC §13 Phase 0）**: この ② が **実リンク**になっていること。
ここが埋まっていないと QR を向ける先（このページ 1 枚、SPEC §11.2）が機能しない。

### リンクの正当性の確認・差し替え手順

1. 正は **expo.dev → プロジェクト → Updates → 対象チャンネル**の「Open in Expo Go」に
   表示される URL。同じものは Expo 公式の QR サービスからも取れる:

   ```sh
   curl "https://qr.expo.dev/eas-update?projectId=73c7cda9-727c-4b83-ba2e-674c38b951ae&channel=production&runtimeVersion=exposdk:57.0.0&format=url"
   # -> exp://u.expo.dev/73c7cda9-727c-4b83-ba2e-674c38b951ae?runtime-version=exposdk%3A57.0.0&channel-name=production
   ```

   `runtimeVersion` は `runtimeVersion: { policy: "sdkVersion" }` から決まる値で、
   `expo@~57.0.23`（SDK 57）なら `exposdk:57.0.0`
   （`cd apps/mobile && eas config --platform ios --profile production` の `sdkVersion` で確認できる）。
   ページにはこの `runtime-version` を付けた形を置いている。**SDK を上げたらこの値も更新すること**
   （SDK 58 へ追従したあとに ② が開かなくなったら、まずここを疑う。ARCHITECTURE §0 の SDK 58 期限リスク）。

2. 差し替えは `index.html` の ②「コトコトバを開く」の
   `<a id="open-in-expo-go" class="btn btn-indigo" href="...">` の `href` を書き換える
   （同じ手順を `<a>` の直前の HTML コメントにも書いてある）。
   `index.html` 内の `exp://` はもう 1 箇所、引き継ぎカード（`#transfer-open`）の
   `href` にもあるが、**そちらは JS が常に `#open-in-expo-go` の href から組み立て直す**ので、
   実際に使われるのは②の値だけ（引き継ぎカードの href は JS 無効時の体裁用）。
   ②のリンク自体に JS による差し替え機構は持たせていない（JS が動かない環境でも
   QR の着地点が機能するように、最初から実リンクを直書きする）。この方針は変えないこと。

   なお `?transfer=<code>` 付きで開かれたときだけ表示される引き継ぎカード（SPEC §7.4）は、
   JS で②のリンクに `&transfer=<code>` を足した `exp://` リンクを出す。カメラが
   アプリの引き継ぎ QR（`exp://…`）ではなく https のこのページを開いてしまった人の受け皿。

3. `production` チャンネルへの publish 前は、リンク自体は有効でもアプリはまだ配信されない。
   公開は `.github/workflows/eas-update.yml` の `workflow_dispatch`（手動実行）で行う
   （push では `preview` チャンネルのみ、SPEC §11.1 / §11.5）。

QR コードは、このランディングページの URL（`https://coto2ba-next.chotech.dev/`）に向けて生成する
（SPEC §11.2「QR はこのページ1枚に向ける」）。

## OGP 画像の差し替え

`index.html` の `<head>` 冒頭に、埋め込んだ `og:image` / `twitter:image` の SVG ソースを
HTML コメントとしてそのまま残してある。編集後は

```sh
base64 -i og-image.svg | tr -d '\n'
```

で base64 化し、`meta[property="og:image"]` と `meta[name="twitter:image"]` の
`data:image/svg+xml;base64,...` を丸ごと置き換える。

## Tier B（パスキー）を有効化する場合

`vercel.json` の `headers` は `/.well-known/apple-app-site-association` への
`Content-Type: application/json` 付与だけ先に用意してある（SPEC §12.2）。
契約後に同パスへ拡張子なしの AASA ファイルを追加すること（本サブエージェントの担当外）。
