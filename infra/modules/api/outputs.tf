output "api_endpoint" {
  description = "https://<id>.execute-api.<region>.amazonaws.com"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "function_names" {
  value = { for k, m in module.fn : k => m.function_name }
}
