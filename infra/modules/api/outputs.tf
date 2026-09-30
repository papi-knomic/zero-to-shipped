output "api_endpoint" {
  description = "https://<id>.execute-api.<region>.amazonaws.com"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "health_function_name" {
  value = aws_lambda_function.health.function_name
}
