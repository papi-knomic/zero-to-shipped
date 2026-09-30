data "aws_caller_identity" "current" {}

locals {
  name       = "lapse"
  account_id = data.aws_caller_identity.current.account_id

  # The deployed app's origin. Empty until CloudFront exists.
  app_origins = var.enable_cloudfront ? ["https://${module.frontend.distribution_domain}"] : []
}

module "frontend" {
  source = "./modules/frontend"

  name                = local.name
  bucket_name         = "${local.name}-web-${local.account_id}"
  enable_distribution = var.enable_cloudfront
}

module "storage" {
  source = "./modules/storage"

  table_name          = local.name
  uploads_bucket_name = "${local.name}-uploads-${local.account_id}"
  # Browsers PUT to S3 directly, so local dev needs its own origin here (the Vite proxy
  # only covers /api). Empty dev_origins before submission.
  cors_origins = concat(local.app_origins, var.dev_origins)
}

module "api" {
  source = "./modules/api"

  name                = local.name
  allowed_origins     = local.app_origins
  lambda_dist_root    = "${path.root}/../services/dist"
  table_name          = module.storage.table_name
  table_arn           = module.storage.table_arn
  uploads_bucket_name = module.storage.uploads_bucket_name
  uploads_bucket_arn  = module.storage.uploads_bucket_arn
}

module "extraction" {
  source = "./modules/extraction"

  name               = local.name
  account_id         = local.account_id
  lambda_dist_root   = "${path.root}/../services/dist"
  extractor          = var.extractor
  table_name         = module.storage.table_name
  table_arn          = module.storage.table_arn
  uploads_bucket_id  = module.storage.uploads_bucket_id
  uploads_bucket_arn = module.storage.uploads_bucket_arn
}
