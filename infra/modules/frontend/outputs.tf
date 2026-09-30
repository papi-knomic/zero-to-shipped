output "bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = one(aws_cloudfront_distribution.this[*].id)
}

output "distribution_domain" {
  value = one(aws_cloudfront_distribution.this[*].domain_name)
}
