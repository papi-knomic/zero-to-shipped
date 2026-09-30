# One Lambda with its own least-privilege role, log group and X-Ray tracing.

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

data "archive_file" "this" {
  type        = "zip"
  source_dir  = "${var.dist_root}/${var.handler}"
  output_path = "${path.root}/.build/${var.function_name}.zip"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.function_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Write-only: PutTraceSegments / PutTelemetryRecords / sampling rules.
resource "aws_iam_role_policy_attachment" "xray" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "this" {
  count = length(var.policy_statements) > 0 ? 1 : 0

  name = "${var.function_name}-access"
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [for s in var.policy_statements : {
      Effect   = "Allow"
      Action   = s.actions
      Resource = s.resources
    }]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.this.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  memory_size      = var.memory_size
  timeout          = var.timeout
  filename         = data.archive_file.this.output_path
  source_code_hash = data.archive_file.this.output_base64sha256

  environment {
    variables = merge({
      POWERTOOLS_SERVICE_NAME      = var.service_name
      POWERTOOLS_METRICS_NAMESPACE = var.metrics_namespace
      POWERTOOLS_LOG_LEVEL         = "INFO"
      NODE_OPTIONS                 = "--enable-source-maps"
    }, var.environment)
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.logs,
    aws_iam_role_policy_attachment.xray,
  ]
}
