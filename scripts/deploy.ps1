# Full deploy: guard account -> build Lambdas -> terraform apply -> build web -> sync -> invalidate.
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

# 1. Account guard
$account = aws sts get-caller-identity --profile $AwsProfile --region $Region --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "Could not resolve AWS identity for profile '$AwsProfile' (try: aws sso login --profile $AwsProfile)" }
if ($account.Trim() -ne $ExpectedAccount) { throw "Wrong AWS account: $account (expected $ExpectedAccount). Aborting." }
Write-Host "AWS account OK: $account" -ForegroundColor Green

# 2. Build Lambdas
Push-Location "$Root/services"
try {
  Invoke-Checked 'services: npm ci' { npm ci --no-audit --no-fund }
  Invoke-Checked 'services: build' { npm run build }
} finally { Pop-Location }

# 3. Infrastructure
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
Write-Host "API: $apiUrl/api/health" -ForegroundColor Green

# Null while enable_cloudfront = false (account awaiting CloudFront verification).
if (-not $distributionId) {
  Write-Warning 'No CloudFront distribution (enable_cloudfront = false). Skipping web deploy.'
  exit 0
}

# 4. Build web (API URL is baked in; CORS on the API only allows the CloudFront origin)
$env:VITE_API_URL = $apiUrl
Push-Location "$Root/web"
try {
  Invoke-Checked 'web: npm ci' { npm ci --no-audit --no-fund }
  Invoke-Checked 'web: build' { npm run build }
} finally { Pop-Location }

# 5. Upload: hashed assets cached forever, everything else revalidated
Invoke-Checked 'sync assets' {
  aws s3 sync "$Root/web/dist/assets" "s3://$bucket/assets" --delete --profile $AwsProfile --region $Region `
    --cache-control 'public,max-age=31536000,immutable'
}
Invoke-Checked 'sync root files' {
  aws s3 sync "$Root/web/dist" "s3://$bucket" --delete --exclude 'assets/*' --profile $AwsProfile --region $Region `
    --cache-control 'no-cache'
}

# 6. Invalidate the non-hashed entry point
Invoke-Checked 'invalidate CloudFront' {
  aws cloudfront create-invalidation --distribution-id $distributionId --paths '/index.html' '/' `
    --profile $AwsProfile --query 'Invalidation.Id' --output text
}

Write-Host "`nDeployed: $siteUrl" -ForegroundColor Green
