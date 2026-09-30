variable "enable_cloudfront" {
  description = <<-EOT
    Create the CloudFront distribution (and scope API CORS to it). Account 117227382789 is
    blocked from creating CloudFront resources until AWS Support verifies it (Sept 30, 2026).
    Flip to true once verified.
  EOT
  type        = bool
  default     = false
}
