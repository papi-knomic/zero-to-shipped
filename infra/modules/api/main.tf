terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

# ---------------------------------------------------------------------------
# health Lambda
# ---------------------------------------------------------------------------

data "archive_file" "health" {
  type        = "zip"
  source_dir  = "${var.lambda_dist_root}/health"
  output_path = "${path.root}/.build/health.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "health" {
  name               = "${var.name}-health"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "health_logs" {
  role       = aws_iam_role.health.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "health" {
  name              = "/aws/lambda/${var.name}-health"
  retention_in_days = 14
}

resource "aws_lambda_function" "health" {
  function_name    = "${var.name}-health"
  role             = aws_iam_role.health.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  memory_size      = 128
  timeout          = 5
  filename         = data.archive_file.health.output_path
  source_code_hash = data.archive_file.health.output_base64sha256

  environment {
    variables = {
      POWERTOOLS_SERVICE_NAME = var.name
      POWERTOOLS_LOG_LEVEL    = "INFO"
      NODE_OPTIONS            = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.health,
    aws_iam_role_policy_attachment.health_logs,
  ]
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
      allow_headers = ["content-type"]
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

resource "aws_apigatewayv2_integration" "health" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.health.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /api/health"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_lambda_permission" "health_apigw" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/api/health"
}
