variable "aws_region" {
  description = "S3 を置くリージョン"
  default     = "ap-northeast-1"
}

variable "project_name" {
  default = "issue-canvas"
}

variable "domain" {
  description = "公開サブドメイン"
  type        = string
}

variable "basic_auth_user" {
  description = "サイト全体を保護する Basic 認証のユーザー名"
  type        = string
  sensitive   = true
}

variable "basic_auth_password" {
  description = "Basic 認証のパスワード"
  type        = string
  sensitive   = true
}

variable "github_repo_subs" {
  description = "GitHub Actions OIDC の sub クレーム(StringLike)。新形式は owner@id/repo@id"
  type        = list(string)
}
