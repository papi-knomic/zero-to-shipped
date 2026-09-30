output "site_url" {
  description = "Public app URL (CloudFront)."
  value       = var.enable_cloudfront ? "https://${module.frontend.distribution_domain}" : null
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
