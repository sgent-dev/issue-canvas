locals {
  # コスト配分タグ(他プロジェクトと共通スキーム。Project タグは Billing で有効化済み)
  cost_allocation_tags = {
    Project     = "issue-canvas"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}
