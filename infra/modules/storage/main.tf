terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ---------------------------------------------------------------------------
# Single table: PK = WS#<workspaceId>, SK = DOC#<docId> | NOTIF#<timestamp>
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "this" {
  name                        = var.table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = true

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  # Demo-workspace items carry expiresAt (epoch seconds); DynamoDB deletes them after it passes.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# Uploads bucket: private; browsers PUT via presigned URLs only
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "uploads" {
  bucket = var.uploads_bucket_name
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

# Presigned PUTs come straight from the browser, so the bucket needs its own CORS rule.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  count  = length(var.cors_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.cors_origins
    allowed_headers = ["content-type"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # The no-login demo keeps files under ws/demo-<id>/; they're deleted with the demo's records.
  rule {
    id     = "expire-demo-uploads"
    status = "Enabled"

    filter {
      prefix = "ws/demo-"
    }

    expiration {
      days = 7
    }
  }
}
