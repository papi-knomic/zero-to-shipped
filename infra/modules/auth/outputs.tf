output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "client_secret_parameter_name" {
  value = aws_ssm_parameter.client_secret.name
}

output "client_secret_parameter_arn" {
  value = aws_ssm_parameter.client_secret.arn
}
