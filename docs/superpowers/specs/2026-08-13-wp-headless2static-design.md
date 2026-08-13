# wp-headless2static 設計書

作成日: 2026-08-13

## 概要

WordPress を Headless CMS、Astro をフロントエンドとして静的サイトをビルドするモノレポ・ボイラープレート。案件ごとに再利用する前提で、以下を要件とする。

- **デプロイ先**: Cloudflare Pages と日本国内レンタルサーバー(Xserver・さくら等)の両対応
- **記事プレビュー**: 編集者が WP 管理画面の「プレビュー」ボタンから本番同等デザインで即時確認できること。国内レンタルサーバーのみの構成でも外部サービスなしで成立すること
- **WP 稼働環境**: ローカル(wp-env)・レンタルサーバー・その他、環境変数で切替可能
- **コンテンツ範囲**: 投稿・固定ページ・カスタム投稿タイプ(CPT)・カスタムフィールド
- **ビルドトリガー**: WP からの自動トリガー(webhook)と手動デプロイの両方

## アーキテクチャ

### モード切替

Astro アプリは 1 つ。環境変数でプレビュー方式とデプロイ先を切り替える。

```
PREVIEW_MODE=shell   # 静的プレビューシェル(どこでも動く・デフォルト)
PREVIEW_MODE=ssr     # /preview/ ルートのみ Cloudflare Workers で SSR
DEPLOY_TARGET=cloudflare | rental
WP_API_URL=https://…  # WP の場所(ローカル/レンサバ/任意)
```

- **shell モード**: 完全静的ビルド。`/preview/` は静的シェルページで、ブラウザ JS が下書きを取得して描画。静的ホスティングだけで完結するため、レンタルサーバー単独でも動く。
- **ssr モード**: 全ページ prerender + `/preview/` のみ SSR の hybrid 構成で Cloudflare アダプタ付きビルド。プレビューがサーバー描画になるため、Astro コンポーネントの加工処理も本番と完全に同一コードで動く。Cloudflare が使える案件向けの上位オプション。

### データ層

どちらのモードも **WP 標準 REST API に一本化**(プラグイン追加不要)。`packages/wp-client` をインターフェース(`getPosts()` / `getPost()` / `getPages()` / `getPreview()` 等)で切り、REST 実装のみ同梱。WPGraphQL が必要な案件では実装を差し替えられる拡張ポイントとして設計する(GraphQL 実装は同梱しない)。

### モノレポ構成(pnpm workspaces)

```
apps/site/                   # Astro(静的 or hybrid、モードで切替)
wp/plugins/headless-bridge/  # プレビュートークン・webhook・CORS
wp/themes/headless-minimal/  # フロントを静的サイトへリダイレクトする極小テーマ
wp/.wp-env.json              # ローカル WP(wp-env)
packages/wp-client/          # WP データ取得層(REST 実装、差替可能 I/F)
packages/shared/             # 型・サイト設定・共有描画関数
tools/deploy/                # rsync / FTPS デプロイスクリプト
.github/workflows/           # ビルド&デプロイ(両ターゲット対応)
docs/                        # ドキュメント・スペック
```

## プレビューの仕組み(headless-bridge プラグイン)

自作 WP プラグイン `headless-bridge` が中核。役割は 3 つ。

### ① プレビューボタンの差し替え

`preview_post_link` フィルタで、プレビューボタンの遷移先を
`{FRONTEND_URL}/preview/?id={投稿ID}&token={短命トークン}` に書き換える。`FRONTEND_URL` はプラグイン設定画面で案件ごとに指定。

### ② 短命トークンの発行と検証

- トークンは投稿 ID + 有効期限を HMAC 署名したもの。秘密鍵は WP のソルト(`wp_salt( 'auth' )`、`AUTH_KEY` 由来)を利用し、有効期限は **10 分**。DB 保存不要のステートレス設計。
- 検証エンドポイント `GET /wp-json/headless-bridge/v1/preview/{id}?token=…` を追加。トークンが有効なら**下書き・未公開リビジョンを含む**投稿データ(タイトル・レンダリング済み本文 HTML・アイキャッチ・カテゴリ・カスタムフィールド等)を返す。無効なら 403。
- 通常の REST API は認証なしでは下書きを返さないため、このエンドポイントが下書きへの唯一の窓口。トークンは URL に載るが 10 分で失効するためリスクは限定的。

### ③ CORS ヘッダー

プレビューシェル(静的サイトのオリジン)から WP ドメインへの fetch を許可。許可オリジンはプラグイン設定の `FRONTEND_URL` のみに限定。配置パターンに関わらず常に設定する規約とする。

### カスタムフィールド対応

プレビューエンドポイントのレスポンスに `meta`(カスタムフィールド一式)を含める。

- **ACF 使用時**: ACF はリビジョン/オートセーブにフィールド値を保存するため、プレビュー時のオートセーブを解決してその ID で `get_fields()` を呼ぶ。保存前の編集中の値もプレビューに反映される。
- **素の post meta**: WP 6.4+ の `register_post_meta( …, ['revisions_enabled' => true] )` で登録されたメタはリビジョンから取得。リビジョン非対応のメタは最後に保存された値へフォールバックする(制約として README に明記)。CPT 追加時の規約として「メタは `revisions_enabled` 付きで登録する」をルール化する。

### 描画フロー

**shell モード**:
1. 編集者が WP でプレビューボタンを押す → `/preview/?id=123&token=…` へ遷移
2. 静的シェルページの JS がトークン付きでエンドポイントを fetch
3. 取得した本文 HTML を、本番記事ページと同じレイアウト(ヘッダー・フッター・記事スタイル)に流し込んで表示。シェルページは Astro の記事レイアウトでビルドするため CSS は本番と完全共通

**ssr モード**: 手順 1 は同じ(プレビュー URL はモードに依らず `/preview/?id=…&token=…` で統一し、プラグイン側はモードを意識しない)。`/preview/` ルートが Workers 上でクエリパラメータを読み、トークン検証エンドポイントを叩いて本番と同一の Astro コンポーネントでサーバー描画。

### 共有描画関数の規約

本文 HTML 以外の加工(目次生成等)やカスタムフィールド駆動の表示ブロック(製品スペック表・実績カード等)は、「**データ → HTML 文字列の純粋関数**」として `packages/shared` に実装し、Astro(ビルド時)とプレビュー JS(実行時)の両方から呼ぶ。

- **ssr モード**: この規約に依存せず、無条件で完全再現される
- **shell モード**: 規約に従った実装が必要。カスタムフィールドが重い案件ほど ssr モードを選ぶ動機になる

## ビルド&デプロイパイプライン

### ビルド

ビルド時に `wp-client` が WP REST API から全コンテンツを取得して静的生成。HTML は毎回全ページ再生成するが(Astro に per-page の差分ビルド機構はない)、時間の大半を占めるコンテンツ取得と画像最適化は後述の 2 層キャッシュで高速化する。

### ビルド高速化(2 層キャッシュ)

**① コンテンツ取得キャッシュ(`wp-client` 内蔵)**

- 取得した投稿データを `.cache/content/` に JSON で永続化
- ビルド時はまず軽量クエリ(`_fields=id,modified` の一覧のみ)で全投稿の更新日時を取得してキャッシュと比較し、**変更・追加された投稿のみ**本体を再取得。削除された投稿はキャッシュから破棄
- サイト設定・カテゴリ・タグ等のグローバルデータは軽量なので毎回取得(不整合リスク回避)

**② 画像最適化キャッシュ**

- Astro 標準の最適化済み画像キャッシュ(`cacheDir`)を永続化するだけ。追加実装はほぼなし。画像の多いサイトでは最大の時間短縮

**永続化**: CI では GitHub Actions の `actions/cache` で `.cache/` と Astro の `cacheDir` を保存・復元。ローカルはディレクトリが残るので自然に効く。

**安全弁**:

- `pnpm build --no-cache`(CI の手動実行フラグも同様)でフルビルドを強制可能
- キャッシュ形式にバージョン番号を持たせ、`wp-client` の取得ロジック変更時は自動で全破棄
- webhook 経由のビルドはキャッシュ有効、疑わしいときはフルビルド、という運用を README に記載

**実装フェーズ**: まずキャッシュなしで全体を動かし、最後に①を後付けする段階構成(①は `wp-client` 内部に閉じるため後付けが容易)。

### 自動トリガー(基本ルート)

1. 記事の公開・更新・削除時に `headless-bridge` が GitHub の `repository_dispatch` API を叩く(`repository_dispatch` のみ許可の fine-grained PAT をプラグイン設定に保存)
2. GitHub Actions が起動し、`DEPLOY_TARGET` で分岐:
   - **cloudflare**: `wrangler` で Cloudflare Pages へデプロイ(ssr モード時は Workers 込み)
   - **rental**: SSH 可のレンサバは **rsync** で差分同期。SSH 不可のサーバー向けに **lftp(FTPS)** フォールバックを用意
3. Actions の `concurrency` グループで同時ビルドを 1 本化(実行中があれば後続をキャンセルして最新のみ実行)

### 手動デプロイ(併設ルート)

CI と同じスクリプトをローカルから実行: `pnpm build && pnpm deploy`。接続情報はローカルでは `.env`(gitignore)、CI では GitHub Secrets から注入。**デプロイロジックは `tools/deploy/` に一本化**し、CI もローカルもそれを呼ぶだけにする。

### WP と静的サイトの配置パターン

WP の場所と静的サイトのデプロイ先は完全に独立。つながりは「ビルド時とプレビュー時に `WP_API_URL` へ HTTP アクセスできること」のみ。

| パターン | 静的サイト | WordPress | 備考 |
|---|---|---|---|
| ① 同居・サブディレクトリ | `example.com/` | `example.com/wp/` | rsync exclude 規約が必要 |
| ② 同居・サブドメイン | `example.com` | `wp.example.com` | DocumentRoot 分離。exclude 不要で事故リスク最小 |
| ③ 完全分離 | レンサバ A or Cloudflare | レンサバ B(既存 WP 可) | 既存 WP の表側だけ静的化する移行案件に有効 |

設定は `WP_API_URL` と `tools/deploy/deploy.config`(ホスト・パス・rsync/FTPS の別・exclude ルール)の 2 箇所のみ。パターン別の分岐コードは持たない。

- ①の同居時は rsync の `--delete` から `/wp/` と `.htaccess` を exclude して WP を巻き込まない
- ②③はクロスオリジンになるため、shell モードのプレビューは CORS 設定が前提(①でも常に設定)
- ③で WP 側を非公開にする場合、「管理画面(`/wp-admin`)のみ Basic 認証、REST API は素通し + `headless-bridge` の窓口制御」の `.htaccess` 雛形を同梱

### セキュリティ(README 記載)

- レンサバ同居時は WP 管理画面に Basic 認証か IP 制限を推奨
- PAT は `repository_dispatch` のみ許可の fine-grained PAT に限定

## ローカル開発環境と開発フロー

ローカル WP は `wp-env`(WordPress 公式 Docker ラッパー)。`wp/.wp-env.json` に定義し、`headless-bridge` と `headless-minimal` をマウント(コード編集が即反映)。

```jsonc
// wp/.wp-env.json(概要)
{
  "plugins": ["./plugins/headless-bridge"],
  "themes": ["./themes/headless-minimal"],
  "port": 8888
}
```

- **headless-minimal テーマ**: WP のフロント側アクセスを `FRONTEND_URL` へリダイレクトするだけの極小テーマ。ヘッドレス運用時に WP の生フロントが検索エンジンに拾われる事故を防ぐ。本番にも導入する想定
- **シードデータ**: wp-env 起動後に wp-cli でサンプル記事・固定ページ・CPT(実績)・カスタムフィールドを投入するスクリプトを同梱。プラグイン設定のデフォルト `FRONTEND_URL` は dev 向け(`localhost:4321`)にシードし、クローン直後からプレビューが動く状態にする

### 日常フロー

```bash
pnpm bootstrap  # 初回のみ: wp-env 起動 + シード投入
pnpm dev        # Astro dev サーバー起動(WP_API_URL=http://localhost:8888)
pnpm build      # 本番ビルド(WP_API_URL は .env に従う)
pnpm deploy     # tools/deploy 経由でデプロイ(手動ルート)
```

- `WP_API_URL` を本番 WP に向ければ実データでのデザイン確認も可能(読み取りのみで安全)
- Node / pnpm バージョンは `package.json` の `engines` と `.nvmrc` で固定

## エラーハンドリング

**ビルド時**: 原則「不完全なサイトをデプロイするくらいなら失敗させる」。

- `wp-client` は fetch 失敗時に指数バックオフで 3 回リトライ。失敗時は明確なメッセージと共に exit 1 で CI を失敗させる
- `headless-bridge` 未導入・API 形式不一致はビルド冒頭のヘルスチェック(`/wp-json/headless-bridge/v1/health`)で早期検出し、日本語メッセージで原因を表示

**プレビュー時**: シェルページは編集者(非エンジニア)向けにエラーを表示。

- トークン期限切れ(403)→「プレビューの有効期限が切れました。WP 管理画面からプレビューを開き直してください」
- CORS/接続失敗 →「WP に接続できません」+ 制作者向け確認ポイント(CORS 設定・URL)を折りたたみ表示

**webhook / デプロイ時**:

- GitHub API 呼び出し失敗は WP 管理画面に admin notice で表示(「公開したのに反映されない」の迷子防止)
- デプロイ失敗は CI の失敗通知に委ねる。rsync は差分同期のため中断時も「古いファイルが残る」のみで破壊はされない(README に明記)

## テスト

| 対象 | 手法 |
|---|---|
| `packages/wp-client`(取得・リトライ) | Vitest + fetch モック |
| `packages/shared`(共有描画関数) | Vitest(純粋関数) |
| `headless-bridge` トークン発行・検証 | PHPUnit(wp-env の tests 環境)。セキュリティ境界のため厚めに: 期限切れ・改竄・別投稿 ID 流用を検証 |
| 全体スモーク | CI で wp-env 起動 → シード投入 → `pnpm build` が通り主要ページが生成されることを確認 |
| E2E | Playwright でプレビューシェルの fetch フロー 1 シナリオのみ |

## スコープ外(YAGNI)

- WPGraphQL 実装(拡張ポイントのみ用意)
- per-page の差分 HTML ビルド(Astro 非対応のため。コンテンツ取得・画像のキャッシュは対応済み)
- 多言語対応
- 検索機能・コメント機能
