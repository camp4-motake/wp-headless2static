# wp-headless2static

WordPress をヘッドレス CMS として使い、Astro でビルドした静的サイト(または Cloudflare Workers 上の SSR)として配信するためのモノレポボイラープレートです。国内レンタルサーバーへの rsync/FTPS デプロイと、Cloudflare Pages / Workers へのデプロイの両方を、同じビルド・同じデプロイスクリプトから選べるように構成しています。

## 全体構成

大まかなデータの流れはこうなります。

```
WordPress (Headless CMS)
   │  REST API (wp-json)
   ▼
Astro ビルド (apps/site)
   │
   ▼
dist/ (静的 HTML / または SSR 用 server+client)
   │
   ├─▶ 国内レンタルサーバー (rsync / lftp)
   └─▶ Cloudflare Pages / Workers (wrangler)
```

WordPress は投稿・固定ページ・カスタム投稿タイプ(CPT)の管理と REST API 提供に専念し、公開画面のレンダリングは一切行いません。表側は Astro が担当し、ビルド時に WP の REST API から全コンテンツを取得して静的 HTML を生成します。

プレビュー(下書き確認)には 2 つのモードがあります。

- **shell モード**: 静的な HTML シェル + クライアント JS でプレビューを描画します。ホスティング先を選ばず、レンタルサーバーの静的配信だけで完結します。
- **ssr モード**: Cloudflare Workers 上で本番と同一の Astro コンポーネントをサーバーサイドレンダリングし、より本番に近いプレビューを提供します。

どちらを使うかは環境変数 `PREVIEW_MODE` で切り替えます(詳細は後述)。

## 必要環境

- Node.js 22.12 以上(`.nvmrc` は `22`)
- pnpm 9 以上
- Docker(ローカルの `wp-env` を動かすために必要)
- PHP 8.1 以上 と Composer(`wp/plugins/headless-bridge` の PHP テストを実行する場合のみ)

## クイックスタート

```bash
pnpm install
pnpm bootstrap   # wp-env を起動し、記事・固定ページ・works(CPT)のサンプルデータを投入
pnpm dev         # Astro の開発サーバーを起動
```

`pnpm bootstrap` は `wp-env start`(ローカル WordPress のコンテナ起動)と `wp/seed.sh` の実行をまとめて行うコマンドで、プラグイン・テーマの有効化やサンプル投稿・works の投入まで自動で済みます。pnpm には組み込みの `pnpm setup` コマンドがあるため名前が衝突しないよう `bootstrap` という名前にしています(後述の `site:deploy` も同様の理由で `deploy` ではなく `site:deploy` という名前です)。

起動後、WordPress 管理画面には次の URL・アカウントでアクセスできます。

- 管理画面: http://localhost:8888/wp-admin
- ユーザー名 / パスワード: `admin` / `password`

投稿一覧または編集画面の「プレビュー」ボタンを押すと、`pnpm dev` で起動している http://localhost:4321 に対して本番同等のプレビュー(下書き含む)が開きます。

## 環境変数と `.env`

`.env` ファイルは **リポジトリルート**(このファイルと同じ階層)に置きます。`.env.example` をコピーして使ってください。

```bash
cp .env.example .env
```

優先順位は「シェルの環境変数 > `.env` ファイルの値」です。`.env` はあくまでローカル開発時のデフォルト値であり、CI やターミナルで明示的に環境変数をエクスポートすればそちらが常に優先されます。

主な変数は次の 3 つです。

| 変数 | 説明 |
|---|---|
| `WP_API_URL` | WordPress REST API のベース URL(ローカル wp-env / レンタルサーバー / 任意の環境を指定) |
| `PREVIEW_MODE` | `shell`(静的シェル + JS。どこでも動く)または `ssr`(Cloudflare Workers)。デフォルトは `shell` |
| `NO_CACHE` | `1` を指定するとコンテンツ取得キャッシュを無効化し、常にフル取得を行う(Astro 側のビルドキャッシュには影響しない) |

重要な注意点として、`PREVIEW_MODE` は単なる実行時フラグではなく **Astro のアダプタ切替そのもの** に効きます。`apps/site/astro.config.mjs` はビルド設定を評価する時点(Vite の環境変数注入より前)でリポジトリルートの `.env` を先読みし、`PREVIEW_MODE=ssr` なら `@astrojs/cloudflare` アダプタを、それ以外なら静的出力を選択します。つまり `PREVIEW_MODE` を変えて `pnpm build` をやり直すと、生成される `dist/` の構造自体が変わります(後述)。

## プレビューの仕組み

WordPress の編集画面から「プレビュー」を押すと、`headless-bridge` プラグインが HMAC 署名付きトークン(有効期限 10 分)を発行し、次の形式の URL にリダイレクトします。

```
{Frontend URL}/preview/?id={投稿ID}&token={トークン}
```

ここで重要なのが、`headless-bridge` の管理画面設定にある **「Frontend URL」は必ずオリジンのみ**(`https://example.com` のようにスキーム+ホスト+ポートだけ)を指定するということです。パスを含めてはいけませんし、末尾のスラッシュも不要です。これは CORS の許可判定が REST API 側でオリジン単位(`scheme://host[:port]`)で行われているためで、パスを含めて設定すると意図通りに動かない可能性があります。

2 つのプレビューモードの違いは次の通りです。

- **shell モード**: 静的ホスティングだけで動作します。ページ側は JS でプレビュー用データを取得して描画しますが、カスタムフィールド駆動のブロック(work の `client_name` / `project_url` など)を安全に両モードで同じ見た目にするため、レンダリングロジックは `packages/shared` の純関数として実装する規約になっています(`packages/shared/src/render/work-meta.ts` の `renderWorkMeta` を参照してください)。
- **ssr モード**: Cloudflare Workers 上で本番と同一の Astro コンポーネントを使ってサーバーサイドレンダリングします。このモードを使う場合、**Workers 側にも `WP_API_URL` と `PREVIEW_MODE` の環境変数を設定する必要があります**(ローカルの `.env` はビルド時にしか読まれず、デプロイ後の Workers 実行環境には自動で伝わりません)。設定方法は後述の「Cloudflare SSR の手動検証チェックリスト」を参照してください。

## コンテンツモデル規約

新しいカスタム投稿タイプ(CPT)やカスタムフィールド(メタ)を追加する際は `wp/plugins/site-config` を参考にしてください。`work` CPT とその meta(`client_name` / `project_url`)がサンプル実装として入っています。

メタフィールドを登録する際は、必ず次のように `revisions_enabled: true` を付けて `register_post_meta()` を呼び出してください(WordPress 6.4 以降が必要です)。

```php
register_post_meta( 'work', 'client_name', [
    'type'              => 'string',
    'single'            => true,
    'show_in_rest'      => true,
    'revisions_enabled' => true,
] );
```

この規約を守らないと、下書きや自動保存(オートセーブ)のプレビュー時に、そのメタだけが「最後に公開・保存された値」のまま表示されてしまいます(タイトルや本文はリビジョンとして正しくプレビューされるのに、メタだけ古い値が出るという不整合が起きます)。プレビューで確認したいカスタムフィールドは必ず `revisions_enabled: true` を付けて登録してください。

## ビルドと 2 層キャッシュ

`pnpm build` は実行するたびに **フルの HTML を生成し直します**(差分ビルドではありません)。その代わりビルドを速くするために、2 つのキャッシュをリポジトリルートの `.cache/` に永続化しています。

1. WordPress からのコンテンツ取得キャッシュ(`modified` 日時での差分取得)
2. Astro 自体のビルドキャッシュ

挙動が怪しいとき・コンテンツ取得キャッシュが原因かもしれないと疑ったときは、`NO_CACHE=1` を付けてフル取得させてください。

```bash
NO_CACHE=1 pnpm build
```

`NO_CACHE=1` が無効化するのはコンテンツ取得キャッシュのみで、Astro 側のビルドキャッシュ(`.cache/astro`)には影響しません。Astro 側も含めて完全にリセットしたい場合は、`.cache/` ディレクトリごと削除してください。

```bash
rm -rf .cache
```

なお、キャッシュの内部形式を変更するようなアップデートを取り込んだ場合は `CACHE_VERSION` の値がコード側で更新され、古い形式のキャッシュは自動的に全破棄される仕組みになっています。手動でキャッシュ形式の互換性を気にする必要はありません。

## 自動ビルド(webhook)

WordPress で投稿を公開・更新・削除すると、自動的に GitHub Actions のビルド・デプロイが起動するようにできます。

設定手順:

1. WordPress 管理画面の「設定」→「Headless Bridge」を開く
2. **GitHub Repository** に `owner/repo` 形式でリポジトリを指定
3. **GitHub Token** に fine-grained PAT(パーソナルアクセストークン)を設定。このトークンは **対象リポジトリの `repository_dispatch` イベント送信のみ** を許可したスコープの狭いものにしてください(それ以上の権限は不要です)

投稿の公開・更新・削除をトリガーに GitHub へ `repository_dispatch` が送られ、`.github/workflows/build-deploy.yml` のワークフローが起動してビルド・デプロイが実行されます。GitHub Repository / GitHub Token のどちらかが未設定の場合は webhook 送信自体がスキップされます。設定の有無にかかわらず、Actions の `workflow_dispatch` からの手動起動はいつでも利用できます。

ビルド起動(GitHub API へのリクエスト)が失敗した場合は、WordPress 管理画面に「ビルドの起動に失敗しました」という通知が表示されます。公開したはずの内容がサイトに反映されていないと感じたら、まずこの通知の有無を確認してください。

## デプロイ

静的サイトのデプロイ先は WordPress の設置場所と完全に独立しています。両者を結びつけるのは「ビルド時・プレビュー時に `WP_API_URL` へ HTTP アクセスできること」だけです。代表的な配置パターンは次の 3 つです。

| パターン | 静的サイト | WordPress | 備考 |
|---|---|---|---|
| ① 同居・サブディレクトリ | `example.com/` | `example.com/wp/` | rsync の exclude 規約が必要 |
| ② 同居・サブドメイン | `example.com` | `wp.example.com` | DocumentRoot が分離しているため exclude 不要。事故リスクが最小 |
| ③ 完全分離 | レンタルサーバー A または Cloudflare | レンタルサーバー B(既存の WordPress サイトでも可) | 既存 WordPress サイトの表側だけを静的化する移行案件に有効 |

### デプロイ設定

`tools/deploy/deploy.config.example` をコピーして `tools/deploy/deploy.config`(gitignore 済み)を作成し、デプロイ先の情報を記入します。

```bash
cp tools/deploy/deploy.config.example tools/deploy/deploy.config
```

デプロイの実行はどのパターンでも共通のコマンドです。

```bash
pnpm build
pnpm site:preview               # 任意: デプロイ前にローカルでビルド結果を確認(astro preview)
pnpm site:deploy                # 実際にデプロイ
pnpm site:deploy -- --dry-run   # 実行内容を確認するだけ(何も送信しない)
```

pnpm には組み込みの `pnpm deploy` コマンドがあるため、名前の衝突を避けて `site:deploy` という名前にしています。

### rsync の特性と exclude

レンタルサーバー(SSH 接続可)へは `rsync -az --delete` による差分同期でデプロイします。差分同期のため、通信が途中で中断してもリモート側が壊れることはなく、単に一部の古いファイルが更新されずに残るだけです(再実行すれば追いつきます)。

パターン①(同居・サブディレクトリ)のように WordPress 本体と静的サイトが同じドキュメントルートに同居する場合は、`deploy.config` の `RSYNC_EXCLUDES` から `wp/` と `.htaccess` を **絶対に外さないでください**。外してしまうと `--delete` オプションによって WordPress 本体や `.htaccess` ごと消えてしまいます。

SSH が使えないレンタルサーバー向けには `lftp` を使った FTPS(`DEPLOY_METHOD=lftp`)のフォールバックも用意しています。

### WordPress 管理画面の保護

WordPress を静的サイトと同居させる構成では、`wp-login.php` / `wp-admin` を外部からの不要なアクセスから守ることを強く推奨します。`tools/deploy/htaccess-wp-admin.example` に雛形を用意していますが、これは **`wp-login.php` への Basic 認証を追加するだけの、保護の出発点となる雛形** です。`/wp-admin` 配下のすべてのパスを保護するものではなく、また REST API(`/wp-json/`)を素通しにするための分岐ロジックも含まれていません(雛形内の `SetEnvIf` 行は現状どこからも参照されておらず実際には効いていません)。本番運用では、この雛形をそのまま使うのではなく、レンタルサーバーのコントロールパネルが提供する IP アドレス制限やアクセス制限機能と組み合わせて、より確実な保護を行ってください。

## CI(GitHub Actions)

`.github/workflows/build-deploy.yml` は `repository_dispatch`(webhook 経由)と `workflow_dispatch`(手動実行)の両方をトリガーにでき、ビルド後に設定に応じたデプロイ先へ配信します。手動実行時は「キャッシュを使わずフルビルド」するオプション(`NO_CACHE` 相当)も選べます。

事前にリポジトリの Settings → Secrets and variables → Actions で、以下を登録してください。

**Variables**

- `DEPLOY_TARGET`(`rental` または `cloudflare`)
- `DEPLOY_METHOD`(`rsync` または `lftp`。rental のみ)
- `WP_API_URL`
- `PREVIEW_MODE`(`shell` または `ssr`)
- `CF_PAGES_PROJECT`(Cloudflare Pages のプロジェクト名)

**Secrets**

- `RENTAL_SSH_KEY` / `RENTAL_HOST` / `RENTAL_USER` / `RENTAL_PATH` / `RENTAL_PORT`
- `FTP_HOST` / `FTP_USER` / `FTP_PASSWORD`
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`

ワークフローは `concurrency` グループで実行を 1 本化しており、ビルド中に新しい `repository_dispatch` が届くと実行中のジョブをキャンセルして最新の内容だけをビルド・デプロイします。連続して投稿を公開・更新しても、古いビルドが後から上書きしてしまう心配はありません。

## Cloudflare SSR の手動検証チェックリスト(初回デプロイ時)

`PREVIEW_MODE=ssr` で Cloudflare Workers にデプロイする場合、初回は次の手順を手動で確認してください。

1. `wrangler` にログインする(`pnpm --filter site exec wrangler login` など)
2. `PREVIEW_MODE=ssr pnpm build` を実行し、SSR 用のビルド(`dist/server/` + `dist/client/`)を生成する
3. `pnpm site:deploy` を実行し、`wrangler deploy` で Workers へデプロイする
4. Cloudflare の Workers 側に環境変数 `WP_API_URL` と `PREVIEW_MODE=ssr` を設定する(ダッシュボードまたは `wrangler.jsonc` 等の設定ファイル経由。ローカルの `.env` は自動では伝わりません)
5. WordPress の編集画面からプレビューを開き、Workers 上で正しく描画されることを確認する
6. `headless-bridge` の設定にある **Frontend URL** を、本番の Cloudflare オリジン(例: `https://example.com`)に更新し、CORS 設定を本番向けに合わせる

なお `PREVIEW_MODE=shell`(静的モード)の場合、ビルド出力は `dist/` 配下がそのまま静的ファイル一式になり、`wrangler pages deploy dist --project-name <CF_PAGES_PROJECT>` で Cloudflare Pages にデプロイされます。`dist/server/` が存在するかどうかで `tools/deploy/deploy.sh` が Workers 用/Pages 用のどちらのデプロイコマンドを使うか自動判別します。

## テスト

```bash
pnpm test                                          # Vitest(リポジトリ全体)
cd wp/plugins/headless-bridge && vendor/bin/phpunit # headless-bridge プラグインの PHP ユニットテスト
bash tools/smoke/preview-endpoint.sh                # プレビューエンドポイントのスモークテスト
pnpm e2e                                            # Playwright による E2E テスト
```

E2E テストを初めて実行する前に、ブラウザバイナリのインストールが必要です。

```bash
npx playwright install --with-deps chromium
```

## スケール上の注意

このボイラープレートは数百〜数千記事程度のサイトを想定した構成です。それを超える規模になる場合は、現状の「毎回フル HTML 生成」というビルド方式のままではビルド時間が課題になり得るため、キャッシュ戦略の強化(差分ビルドの導入)やコンテンツ取得の分割・並列化といった対応を検討してください。
