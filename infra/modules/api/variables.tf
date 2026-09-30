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
