output "site_url" {
  description = "Public site URL: CloudFront when enabled, otherwise the API-served fallback."
  value = (var.enable_cloudfront ? "https://${module.frontend.distribution_domain}"
    : var.custom_domain_attach ? "https://${var.custom_domain}"
  : module.api.api_endpoint)
}

output "api_url" {
  description = "HTTP API endpoint. Baked into the web build as VITE_API_URL."
  value       = module.api.api_endpoint
}

output "site_bucket" {
  value = module.frontend.bucket_name
}

output "distribution_id" {
  value = module.frontend.distribution_id
}

output "table_name" {
  value = module.storage.table_name
}

output "uploads_bucket" {
  value = module.storage.uploads_bucket_name
}

output "custom_domain_validation_records" {
  description = "Add these CNAMEs at the DNS provider so ACM can issue the certificate."
  value       = one(module.domain[*].validation_records)
}

output "custom_domain_target" {
  description = "CNAME target for the custom hostname (after custom_domain_attach = true)."
  value       = one(module.domain[*].target_domain_name)
}

output "dashboard_url" {
  value = module.observability.dashboard_url
}
