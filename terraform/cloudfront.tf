# --- OAC(S3 静的アセット用) ---
resource "aws_cloudfront_origin_access_control" "s3" {
  provider                          = aws.us_east_1
  name                              = "${var.project_name}-s3-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- /api/* 用: キャッシュしない ---
resource "aws_cloudfront_cache_policy" "api_no_cache" {
  provider    = aws.us_east_1
  name        = "${var.project_name}-api-no-cache"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Host 以外を全転送(Host を転送すると Function URL が拒否する)
data "aws_cloudfront_origin_request_policy" "all_except_host" {
  provider = aws.us_east_1
  name     = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  provider = aws.us_east_1
  name     = "Managed-CachingOptimized"
}

# --- Basic 認証(viewer-request)。UI と /api の両方に付ける ---
resource "aws_cloudfront_function" "viewer_request" {
  provider = aws.us_east_1
  name     = "${var.project_name}-viewer-request"
  runtime  = "cloudfront-js-2.0"
  comment  = "Basic auth for issue-canvas (UI + API)"
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

  origin {
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
    origin_id   = "lambda-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
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

  # API
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "lambda-api"

    viewer_protocol_policy   = "redirect-to-https"
    cache_policy_id          = aws_cloudfront_cache_policy.api_no_cache.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
    compress                 = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  # custom_error_response(403/404 → index.html)は付けない: ディストリビューション全体に効くため
  # /api/* の 404(board not found)まで 200 の index.html に化けてしまう。SPA は "/" 単一ルートなので不要。

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
