variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "allowed_origins" {
  description = "Exact origins allowed by CORS (e.g. https://dxxxx.cloudfront.net). Empty = no CORS."
  type        = list(string)

  validation {
    condition     = !contains(var.allowed_origins, "*")
    error_message = "allowed_origins must list explicit origins, never \"*\"."
  }
}

variable "lambda_dist_root" {
  description = "Directory containing one built folder per Lambda (services/dist)."
  type        = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "uploads_bucket_name" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}

variable "serve_web" {
  description = "Serve the web build from this API (fallback while CloudFront is unavailable)."
  type        = bool
}

variable "schedule_group_name" {
  type = string
}

variable "reminder_function_arn" {
  type = string
}

variable "scheduler_role_arn" {
  type = string
}

variable "user_pool_id" {
  type = string
}

variable "user_pool_client_id" {
  type = string
}

variable "client_secret_parameter_name" {
  type = string
}

variable "client_secret_parameter_arn" {
  type = string
}
