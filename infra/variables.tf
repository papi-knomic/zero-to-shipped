variable "enable_cloudfront" {
  description = <<-EOT
    Create the CloudFront distribution (and scope API CORS to it). Account 117227382789 is
    blocked from creating CloudFront resources until AWS Support verifies it (Sept 30, 2026).
    Flip to true once verified.
  EOT
  type        = bool
  default     = false
}

variable "dev_origins" {
  description = "Extra origins allowed to PUT to presigned upload URLs (local Vite dev). Empty before submission."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "extractor" {
  description = "Extraction backend for the extract Lambda: mock | bedrock | textract."
  type        = string
  default     = "mock"
}
