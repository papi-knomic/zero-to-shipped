variable "table_name" {
  type = string
}

variable "uploads_bucket_name" {
  type = string
}

variable "cors_origins" {
  description = "Origins allowed to PUT to presigned upload URLs. Never \"*\"."
  type        = list(string)

  validation {
    condition     = !contains(var.cors_origins, "*")
    error_message = "cors_origins must list explicit origins, never \"*\"."
  }
}
