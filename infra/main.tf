data "aws_caller_identity" "current" {}

locals {
  name       = "lapse"
  account_id = data.aws_caller_identity.current.account_id
}

module "frontend" {
  source = "./modules/frontend"

  name                = local.name
  bucket_name         = "${local.name}-web-${local.account_id}"
  enable_distribution = var.enable_cloudfront
}

module "api" {
  source = "./modules/api"

  name             = local.name
  allowed_origins  = var.enable_cloudfront ? ["https://${module.frontend.distribution_domain}"] : []
  lambda_dist_root = "${path.root}/../services/dist"
}
