variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "lambda_dist_root" {
  type = string
}

variable "extractor" {
  description = "mock | bedrock | textract"
  type        = string

  validation {
    condition     = contains(["mock", "bedrock", "textract"], var.extractor)
    error_message = "extractor must be mock, bedrock or textract."
  }
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "uploads_bucket_id" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}
