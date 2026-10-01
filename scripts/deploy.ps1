# Full deploy: guard account -> build web -> build Lambdas (web build is packaged into the
# lapse-web fallback Lambda) -> terraform apply -> if CloudFront exists: rebuild web with the
# API URL, sync to S3 and invalidate.
# Usage: powershell -File scripts/deploy.ps1 [-AutoApprove] [-SkipInfra]
param(
  [switch]$AutoApprove,
  [switch]$SkipInfra
)

$ErrorActionPreference = 'Stop'
$ExpectedAccount = '117227382789'
$AwsProfile = 'zts'
$Region = 'us-east-1'
$Root = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
  param([string]$What, [scriptblock]$Block)
  Write-Host "==> $What" -ForegroundColor Cyan
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

function Build-Web {
  param([string]$ApiUrl)
  $env:VITE_API_URL = $ApiUrl
  Push-Location "$Root/web"
  try { Invoke-Checked "web: build (VITE_API_URL='$ApiUrl')" { npm run build } } finally { Pop-Location }
}

# 1. Account guard
$account = aws sts get-caller-identity --profile $AwsProfile --region $Region --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Could not resolve AWS identity for profile '$AwsProfile' (try: aws sso login --profile $AwsProfile)" }
if ($account.Trim() -ne $ExpectedAccount) { throw "Wrong AWS account: $account (expected $ExpectedAccount). Aborting." }
Write-Host "AWS account OK: $account" -ForegroundColor Green

# 2. Web first: served same-origin by the API fallback, so no API URL is baked in.
#    Sample documents are regenerated so their dates stay relative to the deploy day.
Invoke-Checked 'sample documents' { node "$Root/scripts/make-samples.mjs" }
Push-Location "$Root/web"
try { Invoke-Checked 'web: npm ci' { npm ci --no-audit --no-fund } } finally { Pop-Location }
Build-Web -ApiUrl ''

# 3. Lambdas (services build copies web/dist into the lapse-web package)
Push-Location "$Root/services"
try {
  Invoke-Checked 'services: npm ci' { npm ci --no-audit --no-fund }
  Invoke-Checked 'services: test' { npm test }
  Invoke-Checked 'services: build' { npm run build }
} finally { Pop-Location }

# 4. Infrastructure
if (-not $SkipInfra) {
  $applyArgs = @('-chdir=infra', 'apply')
  if ($AutoApprove) { $applyArgs += '-auto-approve' }
  Push-Location $Root
  try { Invoke-Checked 'terraform apply' { terraform @applyArgs } } finally { Pop-Location }
}

$outputs = (terraform "-chdir=$Root/infra" output -json) -join "`n" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'terraform output failed' }
$bucket = $outputs.site_bucket.value
$distributionId = $outputs.distribution_id.value
$siteUrl = $outputs.site_url.value
$apiUrl = $outputs.api_url.value

# 5. CloudFront path only (null while enable_cloudfront = false)
if ($distributionId) {
  # On CloudFront the app calls the API cross-origin, so bake its URL in.
  Build-Web -ApiUrl $apiUrl

  Invoke-Checked 'sync assets' {
    aws s3 sync "$Root/web/dist/assets" "s3://$bucket/assets" --delete --profile $AwsProfile --region $Region `
      --cache-control 'public,max-age=31536000,immutable'
  }
  Invoke-Checked 'sync root files' {
    aws s3 sync "$Root/web/dist" "s3://$bucket" --delete --exclude 'assets/*' --profile $AwsProfile --region $Region `
      --cache-control 'no-cache'
  }
  Invoke-Checked 'invalidate CloudFront' {
    aws cloudfront create-invalidation --distribution-id $distributionId --paths '/*' `
      --profile $AwsProfile --query 'Invalidation.Id' --output text
  }
} else {
  Write-Host 'No CloudFront distribution: the site is served by the API (lapse-web Lambda).' -ForegroundColor Yellow
}

Write-Host "`nSite: $siteUrl" -ForegroundColor Green
Write-Host "API:  $apiUrl/api/health" -ForegroundColor Green
