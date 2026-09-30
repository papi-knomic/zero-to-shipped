variable "function_name" {
  type = string
}

variable "handler" {
  description = "Handler name: the folder under dist_root holding index.mjs (e.g. create-upload)."
  type        = string
}

variable "dist_root" {
  description = "services/dist"
  type        = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_statements" {
  description = "Allow statements for the function's inline policy, beyond logging and X-Ray."
  type = list(object({
    actions   = list(string)
    resources = list(string)
  }))
  default = []
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type    = number
  default = 10
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "service_name" {
  type    = string
  default = "lapse"
}

variable "metrics_namespace" {
  type    = string
  default = "Lapse"
}
