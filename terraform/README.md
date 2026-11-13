# terraform — issue-canvas の AWS 構成

```
ブラウザ ── CloudFront(Basic 認証: CloudFront Function) ── S3 assets(SPA)
ローカル MCP ── S3 data (boards/<id>/board.json, versioning ON。利用者の AWS 認証で直接)
GitHub Actions ── OIDC ロール(S3 sync / CloudFront invalidation のみ)
```

> **Web API(Lambda)は撤去済み。** Function URL が NONE 認証で、CloudFront の Basic 認証を通らずに直接呼べたため。
> 公開中の SPA は `/api/*` の先が無いのでボードを読めない。ボードの読み書きはローカル MCP(S3 直結)か、
> ローカルの `npm run serve` で行う。API を再公開する場合は Function URL を公開のままにしないこと。

責務分離: Terraform は「箱」だけ。SPA の中身は `.github/workflows/deploy.yml` が入れる
(assets バケットのオブジェクトは管理しない)。

## 初回構築

```bash
# 0. state バケット(Terraform 管理外、1 回だけ)
aws s3api create-bucket --bucket issue-canvas-tfstate --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1
aws s3api put-bucket-versioning --bucket issue-canvas-tfstate --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket issue-canvas-tfstate \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 1. 変数
cp terraform.tfvars.example terraform.tfvars   # 編集(gitignore 済み)

# 2. 証明書だけ先に作り、DNS 検証レコードを取得
terraform init
terraform apply -target=aws_acm_certificate.main
terraform output acm_validation_records        # → DNS(ConoHa)に CNAME を追加

# 3. 全体
terraform apply                                # 検証完了を待って続行(最大 45 分)
terraform output cloudfront_domain_name        # → DNS に <domain> CNAME を追加

# 4. GitHub Actions 用の変数
gh variable set AWS_GITHUB_ACTIONS_ROLE_ARN --body "$(terraform output -raw github_actions_role_arn)"
gh variable set AWS_REGION --body ap-northeast-1
gh variable set ASSETS_BUCKET --body "$(terraform output -raw assets_bucket_name)"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "$(terraform output -raw cloudfront_distribution_id)"
# → main に push すると deploy.yml が走る(手動: gh workflow run deploy)

# 5. ローカル MCP を S3 に向ける
claude mcp remove --scope user issue-canvas
claude mcp add --scope user -e ISSUE_CANVAS_STORE=s3 -e ISSUE_CANVAS_BUCKET=issue-canvas-data -e AWS_REGION=ap-northeast-1 \
  issue-canvas -- node /absolute/path/to/issue-canvas/dist/mcp/server.js
# 既存のローカルボードを移す: ISSUE_CANVAS_BUCKET=issue-canvas-data npm run copy-boards
```

## 注意
- OIDC の sub は新形式(`repo:owner@id/repo@id:ref:refs/heads/main`)。AssumeRole が拒否されたら CloudTrail の実測値で tfvars を直す
- 削除: `terraform destroy` の前に assets/data バケットを空にする(data はバージョニング ON なので全バージョン削除が必要)
