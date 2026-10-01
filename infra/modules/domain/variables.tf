variable "domain_name" {
  description = "Hostname to serve the app on, e.g. lapse.reck-tech.com."
  type        = string
}

variable "attach" {
  description = "Phase 2: wait for the certificate to be issued and map the hostname to the API."
  type        = bool
}

variable "api_id" {
  type = string
}

variable "stage_id" {
  type = string
}
