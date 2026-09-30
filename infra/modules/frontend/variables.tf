variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "enable_distribution" {
  description = "Create the CloudFront distribution. Off while the account awaits CloudFront verification."
  type        = bool
}

variable "bucket_name" {
  description = "Globally unique name for the static site bucket."
  type        = string
}
