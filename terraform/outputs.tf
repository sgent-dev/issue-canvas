output "cloudfront_domain_name" {
  description = "CloudFront のドメイン名。DNS で <domain> からここへ CNAME を張る"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "acm_validation_records" {
  description = "ACM 証明書の DNS 検証レコード。DNS に手動で追加する"
  value = [for r in aws_acm_certificate.main.domain_validation_options : {
    name  = r.resource_record_name
    type  = r.resource_record_type
    value = r.resource_record_value
  }]
}

output "data_bucket_name" {
  description = "ボードデータのバケット。ローカル MCP の ISSUE_CANVAS_BUCKET に設定する"
  value       = aws_s3_bucket.data.id
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.id
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "github_actions_role_arn" {
  description = "GitHub リポジトリの variables(AWS_GITHUB_ACTIONS_ROLE_ARN)に設定する"
  value       = aws_iam_role.github_actions_deploy.arn
}
