# CloudFront 用 ACM 証明書は us-east-1 固定。DNS 検証。
# 親ドメインの DNS は Terraform 管理外(ConoHa)のため、検証用 CNAME は outputs に出して手動で追加する。
resource "aws_acm_certificate" "main" {
  provider          = aws.us_east_1
  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "main" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_acm_certificate.main.domain_validation_options : r.resource_record_name]

  timeouts {
    create = "45m"
  }
}
