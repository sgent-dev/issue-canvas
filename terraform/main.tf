data "aws_caller_identity" "current" {}

# ============================================================
# データ用 S3(1 ボード = boards/<id>/board.json)
#   - 完全非公開。ローカル MCP(利用者の IAM 認証)だけが読み書き
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
