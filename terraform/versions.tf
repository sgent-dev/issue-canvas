terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # state バケットは Terraform 管理外(先に aws s3api create-bucket で作る。README 参照)
  backend "s3" {
    bucket       = "issue-canvas-tfstate"
    key          = "terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true # S3 ネイティブロック(DynamoDB 不要)
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.cost_allocation_tags
  }
}

# CloudFront / ACM は us-east-1 固定
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.cost_allocation_tags
  }
}
