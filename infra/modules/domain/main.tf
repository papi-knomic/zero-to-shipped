# Custom hostname for the app (e.g. lapse.reck-tech.com). DNS lives outside AWS, so this is
# two-phase: (1) create the certificate and output its validation CNAME; (2) once that record
# is in place, set attach = true to wait for issuance and map the hostname onto the HTTP API.
# The certificate is in us-east-1, so CloudFront can reuse it later.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "this" {
  count = var.attach ? 1 : 0

  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for o in aws_acm_certificate.this.domain_validation_options : o.resource_record_name]
}

# REGIONAL endpoint: no CloudFront involved, so it works while the account is unverified.
resource "aws_apigatewayv2_domain_name" "this" {
  count = var.attach ? 1 : 0

  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.this[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "this" {
  count = var.attach ? 1 : 0

  api_id      = var.api_id
  domain_name = aws_apigatewayv2_domain_name.this[0].id
  stage       = var.stage_id
}
