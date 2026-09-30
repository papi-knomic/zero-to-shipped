# Agent log

## 2026-09-30 — M0: state bucket, hello-world API, frontend shell

**Asked:** Do Milestone 0 only (state bucket, hello-world Lambda behind a public HTTPS URL,
frontend shell on CloudFront). Show the plan before applying anything.

**Built:**
- `bootstrap/`: S3 state bucket `zts-tfstate-117227382789` (versioned, SSE-S3, public access
  blocked, TLS-only policy, `prevent_destroy`, old versions expire after 90 days). Local state.
- `infra/`: S3 backend with `use_lockfile = true`. Provider pinned to profile `zts`,
  `allowed_account_ids`, and `default_tags { project = "zero-to-shipped" }`.
  - `modules/api`: `lapse-health` Lambda (Node 22, arm64, Powertools Logger), a role with only
    `AWSLambdaBasicExecutionRole`, a 14-day log group, and an HTTP API `GET /api/health` with
    stage throttling (burst 50 / rate 20). CORS is limited to the CloudFront origin, never `*`.
  - `modules/frontend`: private site bucket (OAC only), CloudFront Function for SPA rewrites,
    and a distribution (PriceClass_All, redirect-to-HTTPS). Gated by `enable_cloudfront`.
- `services/`: esbuild bundles each `src/handlers/*.ts` → `dist/<name>/index.mjs`.
- `web/`: minimal Vite + React shell with a live API health badge. `index.html` carries static
  headline and description text, so crawlers never see an empty page.
- `scripts/deploy.ps1`: account guard → build → apply → web build (API URL baked in) → S3 sync
  → invalidation.

**Live:** `https://imuwupqf28.execute-api.us-east-1.amazonaws.com/api/health` → 200 JSON.
Structured Powertools logs are in CloudWatch. Direct S3 access to the site bucket → 403.

**Problems and fixes:**
- *Review feedback mid-session:* log retention, CORS limited to the CloudFront domain,
  PriceClass_All, a basic-logging-only Lambda role, and static text in `index.html`.
  - *CORS vs. routing:* scoping CORS to the CloudFront domain while also routing `/api/*` through
    CloudFront creates a Terraform cycle (each needs the other's domain), and same-origin
    calls make CORS pointless anyway. Switched to direct browser → API calls with the API URL
    baked in as `VITE_API_URL`.
  - *Tracing:* Lambda refuses Active tracing without X-Ray write permissions, so tracing is off
    until the role gets `AWSXRayDaemonWriteAccess`.
- *CloudFront blocked:* `CreateDistribution` returned `AccessDenied: Your account must be
  verified before you can add new CloudFront resources` (request ID
  ffb36093-a8aa-4627-baff-fb561667b0f9). The user chose to wait for AWS Support rather than
  build a fallback. Added the `enable_cloudfront` flag (default false) so the API could ship on
  its own. With the flag off, the API has no CORS config at all, so no cross-origin browser access.
- *SPA rewrite verified* with `aws cloudfront test-function`: extension-less paths →
  `/index.html`, and asset paths (including missing ones) pass through. A missing asset returns
  403 from S3 rather than 404, because CloudFront has no `s3:ListBucket`.
- Git Bash rewrites `/aws/lambda/...` arguments into Windows paths. Prefix commands with
  `MSYS_NO_PATHCONV=1`.
- `$Profile` is a PowerShell automatic variable, so the deploy script uses `$AwsProfile` instead.

**Still open for M0:** once AWS Support verifies the account, set `enable_cloudfront = true`,
apply, run `scripts/deploy.ps1`, and verify the site URL and the health badge.

**Revisit early in M1 (review notes):**
- Consider routing `/api/*` through CloudFront (CachingDisabled +
  AllViewerExceptHostHeader, since API Gateway rejects a forwarded Host header) and dropping CORS:
  one domain and no baked-in API URL. CORS only restricts browsers; it is not a security boundary.
- Add `AWSXRayDaemonWriteAccess` plus Active tracing in M1, so traces build up before the
  dashboard and the write-up screenshots.
- The upload bucket needs its own S3 CORS rule for the app origin once presigned uploads land.
- Consider granting CloudFront `s3:ListBucket` so missing assets return 404 instead of 403.
