variable "name" {
  type = string
}

variable "lambda_dist_root" {
  type = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "from_address" {
  description = "Sender address on an SES-verified domain, e.g. reminders@reck-tech.com."
  type        = string
}

variable "app_url" {
  description = "Public app URL used for links in reminder emails."
  type        = string
}
