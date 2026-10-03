terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ---------------------------------------------------------------------------
# Cognito user pool: email + password. Only the API's auth Lambda talks to it,
# using the app client's secret, so nobody can sign up or sign in around the API.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "this" {
  name                = var.name
  user_pool_tier      = "ESSENTIALS" # free up to 10,000 monthly active users; allows passkeys / email codes later
  deletion_protection = "ACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # SES is still in the sandbox (it can only reach verified addresses), so Cognito sends its own
  # emails for now: any address, 50 a day. Switch to SES once production access is granted.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Lapse code"
    email_message        = "Your Lapse verification code is {####}. It expires in 24 hours."
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret               = true
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  # name is a standard attribute (no schema entry needed); the API requires it at sign-up.
  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"]

  supported_identity_providers = ["COGNITO"]
}

# The auth Lambda reads the client secret at cold start rather than from its environment.
resource "aws_ssm_parameter" "client_secret" {
  name        = "/${var.name}/cognito/client-secret"
  description = "Cognito app client secret for the ${var.name} auth Lambda"
  type        = "SecureString"
  value       = aws_cognito_user_pool_client.web.client_secret
}
