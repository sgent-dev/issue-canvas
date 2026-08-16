# インフラ計画(検討メモ)

状態: **案 B で構築中(2026-08-16)**。手順・運用は `terraform/README.md`。ドメインは `issue.<親ドメイン>`、認証は Basic。
S3 のキーは `boards/<id>/board.json`(ボード単位のプレフィックス。将来 `history/` 等を同居させるため)。

## 前提

- 個人利用(単一ユーザー)。公開リポジトリだがデータ(`data/*.json`)は非公開
- **MCP がメイン経路**。Web UI は「眺めて手直しする」用途
- サーバー側で LLM は呼ばない(判定は Claude 側) → API は薄く、CPU もほぼ使わない
- 同じ親ドメイン配下のサブドメインで、他プロジェクトと同じ Terraform + GitHub OIDC の型に揃える

## 一番の論点: データの置き場所

MCP(ローカル PC)と Web(AWS)が**同じボード**を見なければ意味がない。

| 案 | MCP からの経路 | Web からの経路 | 評価 |
|---|---|---|---|
| A. ローカルのみ(AWS なし) | ローカル JSON | `npm run serve` をローカル起動 | 最安・最速。ただし PC 外から見えない |
| **B. S3 に 1 ボード = 1 JSON**(推奨) | `S3Store`(IAM 認証で直接) | Lambda(API)→ S3 | `Store` インターフェースそのまま(load/save/list/exists)。DB 不要。条件付き書き込み(ETag / If-Match)で MCP と Web の同時更新を防げる |
| C. DynamoDB | SDK 直接 | Lambda → DynamoDB | ボードを分割保存すると更新粒度は細かくできるが、現状の「ボード丸ごと読み書き」設計とは合わない。将来ボードが巨大化したら検討 |
| D. Neon(Postgres) | 直接接続 | Lambda → Neon | 既存プロジェクトと同型だが、この用途に RDB は過剰(JOIN 不要・単一ユーザー) |

→ **B**。`JsonFileStore` と同じ形の `S3Store` を足すだけで、コマンド層・API・MCP は無変更。

## 推奨構成(案 B)

```
[ローカル]                        [AWS]
Claude Code ── MCP(stdio) ── S3Store ──┐
                                        ├── S3 (boards/<id>.json)
ブラウザ ── CloudFront ── S3(SPA 静的)  │
              └── /api/* ── Lambda(Hono, arm64, Function URL) ── S3Store ┘
Route53: <sub>.<親ドメイン>  /  ACM(us-east-1)
```

- **静的 SPA**: `web/dist` を S3 に `sync`、CloudFront で配信(OpenNext 不要。Next.js を使っていないため軽い)
- **API**: `createApp(new S3Store(...))` を `hono/aws-lambda` で包む。Function URL を CloudFront のオリジンに(`/api/*` ビヘイビア)
- **認証**: 既存プロジェクトと同じ **CloudFront Function の Basic 認証**(UI と `/api/*` の両方に掛ける)。将来複数人なら Cognito
- **MCP(ローカル)**: `ISSUE_CANVAS_STORE=s3 ISSUE_CANVAS_BUCKET=...` で `S3Store` を選択。認証は最小権限の IAM ユーザー(そのバケットの Get/Put/List のみ)または SSO プロファイル
- **同時更新**: `S3Store.save` は読み込み時の ETag を `If-Match` に付けて Put。衝突したら再読込→再適用(コマンドは冪等に近いので UI 側で「最新を取り直しました」トースト)
- **Terraform**: 既存プロジェクトの型(責務分離: Terraform は箱だけ、成果物は Actions が `s3 sync` / `update-function-code`)。GitHub OIDC ロールも同型
- **コスト**: S3 数 MB + Lambda 呼び出し数百/日 + CloudFront → 実質 0〜数十円/月。ドメインの Hosted Zone は既存

## やらないこと(今は)

- リアルタイム同期(WebSocket)。4 秒ポーリングで十分
- マルチユーザー / 権限
- サーバー側 LLM 判定(内蔵モードは将来のオプション。コマンド層に書き戻し口があるだけ)

## 手順(着手時)

1. `src/core/store-s3.ts`(`S3Store`)+ 環境変数でストア選択(`src/core/store-select.ts`)。単体テストは MemoryStore ベース + S3 はモック
2. `src/api/lambda.ts`(`hono/aws-lambda` ハンドラ)
3. `terraform/`(S3×2, CloudFront, Lambda, IAM, ACM, Route53, OIDC ロール)
4. `.github/workflows/deploy.yml`(build → s3 sync → lambda update)
5. MCP 登録コマンドを S3 モードに切り替え
