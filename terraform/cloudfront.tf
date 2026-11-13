# --- OAC(S3 静的アセット用) ---
resource "aws_cloudfront_origin_access_control" "s3" {
  provider                          = aws.us_east_1
  name                              = "${var.project_name}-s3-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  provider = aws.us_east_1
  name     = "Managed-CachingOptimized"
}

# --- Basic 認証(viewer-request) ---
resource "aws_cloudfront_function" "viewer_request" {
  provider = aws.us_east_1
  name     = "${var.project_name}-viewer-request"
  runtime  = "cloudfront-js-2.0"
  comment  = "Basic auth for issue-canvas"
  publish  = true
  code = replace(
    file("${path.module}/files/viewer-request.js"),
    "__BASIC_AUTH_TOKEN__",
    base64encode("${var.basic_auth_user}:${var.basic_auth_password}")
  )
}

resource "aws_cloudfront_distribution" "main" {
  provider            = aws.us_east_1
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.project_name
  aliases             = [var.domain]
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # 日本を含む。US/EU のみの 100 だと日本からの遅延が増える

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "s3-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # 既定: SPA(静的)
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-assets"

    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
