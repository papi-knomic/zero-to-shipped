terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ---------------------------------------------------------------------------
# Routes: one Lambda per route, each with only the access it needs
# ---------------------------------------------------------------------------

locals {
  routes = {
    health = {
      route_key   = "GET /api/health"
      memory_size = 128
      environment = {}
      statements  = []
    }
    create-upload = {
      route_key   = "POST /api/uploads"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name, UPLOAD_BUCKET = var.uploads_bucket_name }
      statements = [
        { actions = ["dynamodb:PutItem"], resources = [var.table_arn] },
        { actions = ["s3:PutObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] },
      ]
    }
    list-documents = {
      route_key   = "GET /api/documents"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name }
      statements  = [{ actions = ["dynamodb:Query"], resources = [var.table_arn] }]
    }
    get-document = {
      route_key   = "GET /api/documents/{id}"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name }
      statements  = [{ actions = ["dynamodb:GetItem"], resources = [var.table_arn] }]
    }
    document-file = {
      route_key   = "GET /api/documents/{id}/file"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name, UPLOAD_BUCKET = var.uploads_bucket_name }
      statements = [
        { actions = ["dynamodb:GetItem"], resources = [var.table_arn] },
        { actions = ["s3:GetObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] }, # signs the view link
      ]
    }
    delete-document = {
      route_key   = "DELETE /api/documents/{id}"
      memory_size = 256
      environment = merge(local.scheduling_env, { UPLOAD_BUCKET = var.uploads_bucket_name })
      statements = [
        { actions = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"], resources = [var.table_arn] },
        { actions = ["s3:DeleteObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] },
        { actions = ["scheduler:DeleteSchedule"], resources = [local.schedule_arns] },
      ]
    }
    confirm-document = {
      route_key   = "PUT /api/documents/{id}/confirm"
      memory_size = 256
      environment = local.scheduling_env
      statements = [
        { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [var.table_arn] },
        { actions = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"], resources = [local.schedule_arns] },
        { actions = ["iam:PassRole"], resources = [var.scheduler_role_arn] },
      ]
    }
    test-reminder = {
      route_key   = "POST /api/documents/{id}/test-reminder"
      memory_size = 256
      environment = local.scheduling_env
      statements = [
        { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [var.table_arn] },
        { actions = ["scheduler:CreateSchedule"], resources = [local.schedule_arns] },
        { actions = ["iam:PassRole"], resources = [var.scheduler_role_arn] },
      ]
    }
    list-notifications = {
      route_key   = "GET /api/notifications"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name }
      statements  = [{ actions = ["dynamodb:Query"], resources = [var.table_arn] }]
    }
    email-status = {
      route_key   = "GET /api/email/status"
      memory_size = 256
      environment = {}
      statements = [
        { actions = ["ses:GetAccount"], resources = ["*"] }, # account-level call, no resource ARN
        { actions = ["ses:GetEmailIdentity"], resources = [local.ses_identity_arns] },
      ]
    }
    verify-email = {
      route_key   = "POST /api/email/verify"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name }
      statements = [
        { actions = ["dynamodb:UpdateItem"], resources = [var.table_arn] },
        { actions = ["ses:GetAccount"], resources = ["*"] },
        { actions = ["ses:GetEmailIdentity", "ses:CreateEmailIdentity"], resources = [local.ses_identity_arns] },
      ]
    }
    # Sign up / in / out, refresh, password reset. One function: every action shares the Cognito
    # client and its secret. SignUp, InitiateAuth etc. are public Cognito APIs (no IAM needed).
    auth = {
      route_key   = "ANY /api/auth/{action}"
      memory_size = 256
      environment = { TABLE_NAME = var.table_name, CLIENT_SECRET_PARAM = var.client_secret_parameter_name }
      statements = [
        { actions = ["ssm:GetParameter"], resources = [var.client_secret_parameter_arn] },
        { actions = ["dynamodb:PutItem"], resources = [var.table_arn] }, # the user's workspace record
      ]
    }
    claim-demo = {
      route_key   = "POST /api/workspace/claim-demo"
      memory_size = 256
      environment = merge(local.scheduling_env, { UPLOAD_BUCKET = var.uploads_bucket_name })
      statements = [
        { actions = ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"], resources = [var.table_arn] },
        # CopyObject needs GetObject on the source and PutObject on the destination.
        { actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] },
        { actions = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"], resources = [local.schedule_arns] },
        { actions = ["iam:PassRole"], resources = [var.scheduler_role_arn] },
      ]
    }
  }

  # Every route verifies the session cookie (Cognito ID token) itself; this is all it needs.
  session_env = { USER_POOL_ID = var.user_pool_id, USER_POOL_CLIENT_ID = var.user_pool_client_id }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  scheduling_env = {
    TABLE_NAME            = var.table_name
    SCHEDULE_GROUP        = var.schedule_group_name
    REMINDER_FUNCTION_ARN = var.reminder_function_arn
    SCHEDULER_ROLE_ARN    = var.scheduler_role_arn
  }
  schedule_arns     = "arn:aws:scheduler:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:schedule/${var.schedule_group_name}/*"
  ses_identity_arns = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/*"
}

module "fn" {
  source   = "../lambda"
  for_each = local.routes

  function_name     = "${var.name}-${each.key}"
  handler           = each.key
  dist_root         = var.lambda_dist_root
  memory_size       = each.value.memory_size
  environment       = merge(local.session_env, each.value.environment)
  policy_statements = each.value.statements
}

# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name}-api"
  protocol_type = "HTTP"

  # Browsers may only call the API from the app's own origin (CloudFront), never "*".
  # With no origins, no CORS config exists and browsers can't call the API cross-origin at all.
  dynamic "cors_configuration" {
    for_each = length(var.allowed_origins) > 0 ? [1] : []

    content {
      allow_origins = var.allowed_origins
      allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
      allow_headers = ["content-type", "x-workspace-id"]
      max_age       = 3600
    }
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  # Public demo URL: cap request rate so abuse can't run up a bill.
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_apigatewayv2_integration" "this" {
  for_each = local.routes

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "this" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value.route_key
  target    = "integrations/${aws_apigatewayv2_integration.this[each.key].id}"
}

locals {
  # "GET /api/documents/{id}" → "GET/api/documents/*" for the permission's source ARN.
  # ANY routes are invoked with the real method, so they need a wildcard method.
  route_arn_suffix = {
    for k, r in local.routes :
    k => "${replace(split(" ", r.route_key)[0], "ANY", "*")}${replace(split(" ", r.route_key)[1], "/\\{[^}]+\\}/", "*")}"
  }
}

resource "aws_lambda_permission" "invoke" {
  for_each = local.routes

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/${local.route_arn_suffix[each.key]}"
}

# ---------------------------------------------------------------------------
# M0 → M1 refactor: adopt the existing health resources instead of recreating them
# ---------------------------------------------------------------------------

moved {
  from = aws_iam_role.health
  to   = module.fn["health"].aws_iam_role.this
}

moved {
  from = aws_iam_role_policy_attachment.health_logs
  to   = module.fn["health"].aws_iam_role_policy_attachment.logs
}

moved {
  from = aws_cloudwatch_log_group.health
  to   = module.fn["health"].aws_cloudwatch_log_group.this
}

moved {
  from = aws_lambda_function.health
  to   = module.fn["health"].aws_lambda_function.this
}

moved {
  from = aws_apigatewayv2_integration.health
  to   = aws_apigatewayv2_integration.this["health"]
}

moved {
  from = aws_apigatewayv2_route.health
  to   = aws_apigatewayv2_route.this["health"]
}

moved {
  from = aws_lambda_permission.health_apigw
  to   = aws_lambda_permission.invoke["health"]
}

# ---------------------------------------------------------------------------
# Web hosting fallback (while CloudFront is unavailable): the same API serves the
# static landing page and the React app, so the site and /api share one origin.
# Explicit /api routes above always win over these catch-alls.
# ---------------------------------------------------------------------------

module "web" {
  source = "../lambda"
  count  = var.serve_web ? 1 : 0

  function_name = "${var.name}-web"
  handler       = "web"
  dist_root     = var.lambda_dist_root
  memory_size   = 256
}

resource "aws_apigatewayv2_integration" "web" {
  count = var.serve_web ? 1 : 0

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.web[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "web" {
  for_each = var.serve_web ? toset(["ANY /", "ANY /{proxy+}"]) : toset([])

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.web[0].id}"
}

resource "aws_lambda_permission" "web" {
  count = var.serve_web ? 1 : 0

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.web[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
