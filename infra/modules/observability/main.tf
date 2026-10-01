terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

data "aws_region" "current" {}

locals {
  region = data.aws_region.current.region
  # Powertools Metrics publishes custom metrics with a "service" dimension.
  app = { dims = ["service", var.service_name] }
  api = ["ApiId", var.api_id, "Stage", "$default"]
}

# ---------------------------------------------------------------------------
# Alarms → SNS (subscribe an email with var.alarm_email)
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    api-5xx = {
      description = "HTTP API returned more than 5 server errors in 5 minutes"
      namespace   = "AWS/ApiGateway", metric = "5xx", stat = "Sum", threshold = 5
      dimensions  = { ApiId = var.api_id, Stage = "$default" }
    }
    lambda-errors = {
      description = "A Lambda function errored (account-wide; this account only runs Lapse)"
      namespace   = "AWS/Lambda", metric = "Errors", stat = "Sum", threshold = 0
      dimensions  = {}
    }
    lambda-throttles = {
      description = "Lambda invocations were throttled (account concurrency limit reached)"
      namespace   = "AWS/Lambda", metric = "Throttles", stat = "Sum", threshold = 0
      dimensions  = {}
    }
    extraction-failures = {
      description = "A document could not be extracted (status FAILED)"
      namespace   = var.metrics_namespace, metric = "ExtractionFailures", stat = "Sum", threshold = 0
      dimensions  = { service = var.service_name }
    }
    extract-dlq = {
      description = "Uploads gave up after retries and landed in the extraction dead-letter queue"
      namespace   = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", stat = "Maximum", threshold = 0
      dimensions  = { QueueName = var.dlq_name }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.stat
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "text", x = 0, y = 0, width = 24, height = 2
        properties = {
          markdown = "## Lapse: renewal reminders\nUploads → SQS → Textract extraction → review → EventBridge Scheduler → SES. Custom metrics come from Powertools (namespace `${var.metrics_namespace}`). Alarms notify SNS topic `${aws_sns_topic.alarms.name}`."
        }
      },
      {
        type = "metric", x = 0, y = 2, width = 8, height = 6
        properties = {
          title = "Documents", region = local.region, view = "timeSeries", stat = "Sum", period = 300
          metrics = [
            concat([var.metrics_namespace, "DocumentsProcessed"], local.app.dims, [{ label = "Extracted" }]),
            concat([var.metrics_namespace, "DocumentsConfirmed"], local.app.dims, [{ label = "Confirmed" }]),
            concat([var.metrics_namespace, "ExtractionFailures"], local.app.dims, [{ label = "Failed", color = "#d62728" }]),
            concat([var.metrics_namespace, "ExtractionRetries"], local.app.dims, [{ label = "Retried", color = "#ff7f0e" }]),
          ]
        }
      },
      {
        type = "metric", x = 8, y = 2, width = 8, height = 6
        properties = {
          title = "Extraction latency (ms)", region = local.region, view = "timeSeries", period = 300
          metrics = [
            concat([var.metrics_namespace, "ExtractionLatency"], local.app.dims, [{ stat = "Average", label = "Average" }]),
            concat([var.metrics_namespace, "ExtractionLatency"], local.app.dims, [{ stat = "p90", label = "p90" }]),
          ]
        }
      },
      {
        type = "metric", x = 16, y = 2, width = 8, height = 6
        properties = {
          title = "Reminders", region = local.region, view = "timeSeries", stat = "Sum", period = 300
          metrics = [
            concat([var.metrics_namespace, "RemindersScheduled"], local.app.dims, [{ label = "Scheduled" }]),
            concat([var.metrics_namespace, "RemindersSent"], local.app.dims, [{ label = "Fired" }]),
            concat([var.metrics_namespace, "ReminderEmailsDelivered"], local.app.dims, [{ label = "Emailed", color = "#2ca02c" }]),
            concat([var.metrics_namespace, "ReminderEmailsNotDelivered"], local.app.dims, [{ label = "In-app only", color = "#ff7f0e" }]),
          ]
        }
      },
      {
        type = "metric", x = 0, y = 8, width = 8, height = 6
        properties = {
          title = "API requests", region = local.region, view = "timeSeries", stat = "Sum", period = 300
          metrics = [
            concat(["AWS/ApiGateway", "Count"], local.api, [{ label = "Requests" }]),
            concat(["AWS/ApiGateway", "4xx"], local.api, [{ label = "4xx", color = "#ff7f0e" }]),
            concat(["AWS/ApiGateway", "5xx"], local.api, [{ label = "5xx", color = "#d62728" }]),
          ]
        }
      },
      {
        type = "metric", x = 8, y = 8, width = 8, height = 6
        properties = {
          title = "API latency (ms)", region = local.region, view = "timeSeries", period = 300
          metrics = [
            concat(["AWS/ApiGateway", "Latency"], local.api, [{ stat = "p50", label = "p50" }]),
            concat(["AWS/ApiGateway", "Latency"], local.api, [{ stat = "p90", label = "p90" }]),
          ]
        }
      },
      {
        type = "metric", x = 16, y = 8, width = 8, height = 6
        properties = {
          title = "Lambda (account)", region = local.region, view = "timeSeries", period = 300
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", { stat = "Maximum", label = "Peak concurrency" }],
            ["AWS/Lambda", "Errors", { stat = "Sum", label = "Errors", color = "#d62728" }],
            ["AWS/Lambda", "Throttles", { stat = "Sum", label = "Throttles", color = "#ff7f0e" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 14, width = 8, height = 6
        properties = {
          title   = "Errors by function", region = local.region, view = "timeSeries", stat = "Sum", period = 300
          metrics = [[{ expression = "SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Errors\" FunctionName=\"${var.name}-\"', 'Sum', 300)", id = "e1", label = "" }]]
        }
      },
      {
        type = "metric", x = 8, y = 14, width = 8, height = 6
        properties = {
          title = "Extraction queue", region = local.region, view = "timeSeries", stat = "Maximum", period = 300
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name, { label = "Waiting" }],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.queue_name, { label = "Oldest (s)", yAxis = "right" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name, { label = "Dead-letter", color = "#d62728" }],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 14, width = 8, height = 6
        properties = {
          title = "Email (SES configuration set)", region = local.region, view = "timeSeries", stat = "Sum", period = 300
          metrics = [
            ["AWS/SES", "Send", "ses:configuration-set", var.ses_configuration_set, { label = "Sent" }],
            ["AWS/SES", "Delivery", "ses:configuration-set", var.ses_configuration_set, { label = "Delivered", color = "#2ca02c" }],
            ["AWS/SES", "Bounce", "ses:configuration-set", var.ses_configuration_set, { label = "Bounced", color = "#d62728" }],
            ["AWS/SES", "Complaint", "ses:configuration-set", var.ses_configuration_set, { label = "Complaints", color = "#9467bd" }],
          ]
        }
      },
      {
        type = "alarm", x = 0, y = 20, width = 24, height = 3
        properties = {
          title  = "Alarms"
          alarms = [for a in aws_cloudwatch_metric_alarm.this : a.arn]
        }
      },
    ]
  })
}
