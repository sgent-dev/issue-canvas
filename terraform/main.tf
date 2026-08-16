data "aws_caller_identity" "current" {}

# ============================================================
# データ用 S3(1 ボード = boards/<id>/board.json)
#   - 完全非公開。Lambda 実行ロールとローカル MCP(利用者の IAM 認証)だけが読み書き
#   - バージョニング ON: 誤削除・誤上書きの保険(直近版に戻せる)
# ============================================================
resource "aws_s3_bucket" "data" {
  bucket = "${var.project_name}-data"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 旧バージョンは 90 日で掃除(容量は微小だが無限に増やさない)
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ============================================================
# 静的アセット用 S3(web/dist)。CloudFront OAC からのみ GetObject
#   中身は GitHub Actions の `aws s3 sync --delete` が管理する(deploy.yml)。Terraform はバケットまで
# ============================================================
resource "aws_s3_bucket" "assets" {
  bucket = "${var.project_name}-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = false # CloudFront OAC 用のバケットポリシーを付与するため
  ignore_public_acls      = true
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "assets_bucket_policy" {
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets_bucket_policy.json
}

# ============================================================
# Lambda(Hono API)
# ============================================================
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_data_access" {
  statement {
    sid       = "ListBoards"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.data.arn]
  }
  statement {
    sid       = "ReadWriteBoards"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.data.arn}/boards/*"]
  }
}

resource "aws_iam_role_policy" "lambda_data_access" {
  name   = "${var.project_name}-api-data-access"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_data_access.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = 14
}

# 実コードは GitHub Actions(update-function-code)がデプロイ。Terraform は器だけ(初回はプレースホルダ)
data "archive_file" "lambda_bootstrap" {
  type        = "zip"
  output_path = "${path.module}/.build/lambda-bootstrap.zip"

  source {
    content  = "export const handler = async () => ({ statusCode: 503, body: \"bootstrap placeholder: deploy real code via GitHub Actions\" });"
    filename = "index.mjs"
  }
}

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api"
  description   = "issue-canvas REST API (Hono)"

  filename         = data.archive_file.lambda_bootstrap.output_path
  source_code_hash = data.archive_file.lambda_bootstrap.output_base64sha256

  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]

  memory_size = var.lambda_memory_size
  timeout     = var.lambda_timeout

  role = aws_iam_role.lambda_exec.arn

  environment {
    variables = {
      ISSUE_CANVAS_STORE  = "s3"
      ISSUE_CANVAS_BUCKET = aws_s3_bucket.data.bucket
      ISSUE_CANVAS_PREFIX = "boards/"
      NODE_ENV            = "production"
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# Function URL は NONE 認証。保護は CloudFront Function の Basic 認証で担保
# (OAC + AWS_IAM が CloudFront-Lambda 間で機能しなかった既知の問題を踏襲)
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "allow_public_url" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "allow_public_invoke" {
  statement_id  = "FunctionURLInvokeAllowPublicAccess"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "*"
}
