variable "name" {
  type = string
}

variable "api_id" {
  type = string
}

variable "queue_name" {
  type = string
}

variable "dlq_name" {
  type = string
}

variable "ses_configuration_set" {
  type = string
}

variable "metrics_namespace" {
  type    = string
  default = "Lapse"
}

variable "service_name" {
  type    = string
  default = "lapse"
}

variable "alarm_email" {
  description = "Optional address subscribed to alarm notifications (AWS emails a confirmation link)."
  type        = string
  default     = ""
}
