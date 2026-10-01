terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
}

# ---------------------------------------------------------------------------
# EventBridge Scheduler: one-time at() schedules live in this group and delete
# themselves after firing. The API creates them on confirm.
# ---------------------------------------------------------------------------

resource "aws_scheduler_schedule_group" "this" {
  name = var.name
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# Role Scheduler assumes to invoke the reminder Lambda, and nothing else.
resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.name}-scheduler-invoke"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = [module.reminder.function_arn, "${module.reminder.function_arn}:*"]
    }]
  })
}

# ---------------------------------------------------------------------------
# Reminder Lambda: sends the email (SES) and records the in-app notification.
# ---------------------------------------------------------------------------

module "reminder" {
  source = "../lambda"

  function_name = "${var.name}-reminder"
  handler       = "reminder"
  dist_root     = var.lambda_dist_root
  timeout       = 30

  environment = {
    TABLE_NAME        = var.table_name
    FROM_ADDRESS      = var.from_address
    CONFIGURATION_SET = aws_sesv2_configuration_set.this.configuration_set_name
    APP_URL           = var.app_url
  }

  policy_statements = [
    { actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], resources = [var.table_arn] },
    {
      # In the SES sandbox, sending also needs permission on the (verified) recipient identities.
      actions = ["ses:SendEmail"]
      resources = [
        "arn:aws:ses:${local.region}:${local.account_id}:identity/*",
        aws_sesv2_configuration_set.this.arn,
      ]
    },
  ]
}

# ---------------------------------------------------------------------------
# SES: bounce/complaint suppression, reputation metrics, event metrics, alarms
# ---------------------------------------------------------------------------

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = var.name

  reputation_options {
    reputation_metrics_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_configuration_set_event_destination" "cloudwatch" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "cloudwatch-metrics"

  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"]

    cloud_watch_destination {
      dimension_configuration {
        dimension_name          = "ses:configuration-set"
        dimension_value_source  = "MESSAGE_TAG"
        default_dimension_value = var.name
      }
    }
  }
}

# Account-wide: never send to an address that has bounced or complained.
resource "aws_sesv2_account_suppression_attributes" "this" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}

# SES pauses accounts around 10% bounce / 0.5% complaints; alarm well before that.
resource "aws_cloudwatch_metric_alarm" "bounce_rate" {
  alarm_name          = "${var.name}-ses-bounce-rate"
  alarm_description   = "SES bounce rate above 5%"
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.05
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "complaint_rate" {
  alarm_name          = "${var.name}-ses-complaint-rate"
  alarm_description   = "SES complaint rate above 0.1%"
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.001
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
