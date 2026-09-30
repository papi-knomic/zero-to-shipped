terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

module "extract" {
  source = "../lambda"

  function_name = "${var.name}-extract"
  handler       = "extract"
  dist_root     = var.lambda_dist_root
  memory_size   = 512
  timeout       = 120 # headroom for Bedrock + escalation in M3

  environment = {
    TABLE_NAME = var.table_name
    EXTRACTOR  = var.extractor
  }

  policy_statements = [
    { actions = ["s3:GetObject"], resources = ["${var.uploads_bucket_arn}/ws/*"] },
    { actions = ["dynamodb:UpdateItem"], resources = [var.table_arn] },
  ]
}

resource "aws_lambda_permission" "s3" {
  statement_id   = "AllowUploadsBucketInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = module.extract.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = var.uploads_bucket_arn
  source_account = var.account_id
}

# The only notification config on the uploads bucket (S3 allows one per bucket).
resource "aws_s3_bucket_notification" "uploads" {
  bucket = var.uploads_bucket_id

  lambda_function {
    lambda_function_arn = module.extract.function_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "ws/"
  }

  depends_on = [aws_lambda_permission.s3]
}
