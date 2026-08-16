# GitHub Actions → AWS は OIDC(長期キーを Secrets に置かない)。
# このロールはコードデプロイ専用の最小権限(Lambda コード更新・S3 同期・CloudFront 無効化のみ)。
# terraform apply はローカルから実行する運用。

# OIDC プロバイダはアカウントに 1 つ(他プロジェクトの Terraform が作成済み)なので参照のみ
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # 2026 年以降の新規リポジトリは owner@id/repo@id の新形式(tfvars で指定)。
      # 合わない場合は CloudTrail の AssumeRoleWithWebIdentity イベントで実測値を確認する
      values = var.github_repo_subs
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name               = "${var.project_name}-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
}

data "aws_iam_policy_document" "github_actions_deploy" {
  statement {
    sid       = "UpdateLambdaCode"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = [aws_lambda_function.api.arn]
  }
  statement {
    sid       = "SyncAssets"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.assets.arn, "${aws_s3_bucket.assets.arn}/*"]
  }
  statement {
    sid       = "InvalidateCloudFront"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.main.arn]
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name   = "${var.project_name}-github-actions-deploy"
  role   = aws_iam_role.github_actions_deploy.id
  policy = data.aws_iam_policy_document.github_actions_deploy.json
}
