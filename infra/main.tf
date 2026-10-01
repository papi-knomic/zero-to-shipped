data "aws_caller_identity" "current" {}

locals {
  name       = "lapse"
  account_id = data.aws_caller_identity.current.account_id

  # The deployed app's origin. Empty until CloudFront exists.
  app_origins = var.enable_cloudfront ? ["https://${module.frontend.distribution_domain}"] : []

  # Fallback while CloudFront is unavailable: the HTTP API also serves the site.
  serve_web = !var.enable_cloudfront
  # Origins the API-served site is reachable on. Same-origin for /api, but presigned
  # uploads go to S3, which needs them in its CORS rule.
  web_origins = local.serve_web ? concat(
    [module.api.api_endpoint],
    var.custom_domain != "" ? ["https://${var.custom_domain}"] : [],
  ) : []
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
  cors_origins = concat(local.app_origins, local.web_origins, var.dev_origins)
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
  serve_web           = local.serve_web

  schedule_group_name   = module.reminders.schedule_group_name
  reminder_function_arn = module.reminders.reminder_function_arn
  scheduler_role_arn    = module.reminders.scheduler_role_arn
}

module "reminders" {
  source = "./modules/reminders"

  name             = local.name
  lambda_dist_root = "${path.root}/../services/dist"
  table_name       = module.storage.table_name
  table_arn        = module.storage.table_arn
  from_address     = var.ses_from_address
  app_url          = var.custom_domain_attach ? "https://${var.custom_domain}" : module.api.api_endpoint
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

module "domain" {
  source = "./modules/domain"
  count  = var.custom_domain != "" ? 1 : 0

  domain_name = var.custom_domain
  attach      = var.custom_domain_attach
  api_id      = module.api.api_id
  stage_id    = module.api.stage_id
}

module "observability" {
  source = "./modules/observability"

  name                  = local.name
  api_id                = module.api.api_id
  queue_name            = module.extraction.queue_name
  dlq_name              = module.extraction.dlq_name
  ses_configuration_set = module.reminders.configuration_set_name
  alarm_email           = var.alarm_email
}
