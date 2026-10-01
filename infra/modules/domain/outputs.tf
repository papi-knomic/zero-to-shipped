output "certificate_arn" {
  value = aws_acm_certificate.this.arn
}

output "validation_records" {
  description = "CNAMEs to add at the DNS provider so ACM can issue the certificate."
  value = [for o in aws_acm_certificate.this.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "target_domain_name" {
  description = "Point the app hostname's CNAME here (available once attach = true)."
  value       = one(aws_apigatewayv2_domain_name.this[*].domain_name_configuration[0].target_domain_name)
}
