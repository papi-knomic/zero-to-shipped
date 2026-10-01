terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  max_attempts     = 3
  function_timeout = 120 # Textract async jobs on multi-page PDFs can take a while
}

# ---------------------------------------------------------------------------
# S3 → SQS → extract Lambda. The queue absorbs bursts (e.g. "Load sample documents") and the
# event source mapping caps extraction at 2 concurrent invocations, so slow Textract calls
# can't use up the account's Lambda concurrency and starve the API.
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-extract-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "extract" {
  name                       = "${var.name}-extract"
  visibility_timeout_seconds = local.function_timeout * 6 # AWS guidance for Lambda consumers
  message_retention_seconds  = 345600                     # 4 days
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = local.max_attempts
  })
}

data "aws_iam_policy_document" "queue" {
  statement {
    sid       = "AllowUploadsBucket"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.extract.arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.uploads_bucket_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "extract" {
  queue_url = aws_sqs_queue.extract.id
  policy    = data.aws_iam_policy_document.queue.json
}

module "extract" {
  source = "../lambda"

  function_name = "${var.name}-extract"
  handler       = "extract"
  dist_root     = var.lambda_dist_root
  memory_size   = 512
  timeout       = local.function_timeout

  environment = {
    TABLE_NAME   = var.table_name
    EXTRACTOR    = var.extractor
    MAX_ATTEMPTS = tostring(local.max_attempts)
  }

  policy_statements = [
    { actions = ["s3:GetObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] },
    { actions = ["dynamodb:UpdateItem"], resources = [var.table_arn] },
    { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [aws_sqs_queue.extract.arn] },
    # Textract has no resource-level permissions; it reads the object with this role's s3:GetObject.
    {
      actions   = ["textract:AnalyzeDocument", "textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis"]
      resources = ["*"]
    },
  ]
}

resource "aws_lambda_event_source_mapping" "extract" {
  event_source_arn        = aws_sqs_queue.extract.arn
  function_name           = module.extract.function_arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2 # the minimum SQS allows
  }
}

# The only notification config on the uploads bucket (S3 allows one per bucket).
resource "aws_s3_bucket_notification" "uploads" {
  bucket = var.uploads_bucket_id

  queue {
    queue_arn     = aws_sqs_queue.extract.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "ws/"
  }

  depends_on = [aws_sqs_queue_policy.extract]
}
