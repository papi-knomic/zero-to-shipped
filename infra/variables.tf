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

variable "custom_domain" {
  description = "Hostname the app is served on (DNS managed outside AWS). Empty disables."
  type        = string
  default     = "lapse.reck-tech.com"
}

variable "custom_domain_attach" {
  description = <<-EOT
    Phase 2 of the custom domain: set true once the ACM validation CNAME exists in DNS.
    Apply then waits for the certificate and maps the hostname onto the HTTP API.
  EOT
  type        = bool
  default     = true
}
