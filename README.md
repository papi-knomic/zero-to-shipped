# Lapse — never miss a renewal

Businesses upload licences, contracts, insurance policies, permits and certifications. Lapse
extracts the key dates and emails reminders 60, 30 and 7 days before anything expires. The user
confirms the dates before any reminders are scheduled.

Built for the AWS **Zero to Shipped** hackathon.

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | State bucket, hello-world API, frontend shell | API live. CloudFront is waiting on AWS account verification. |
| M1 | Upload, S3 trigger, mock extraction, DynamoDB, document list | Next |
| M2 | Review/confirm, EventBridge Scheduler reminders, SES | — |
| M3 | Bedrock/Textract extraction with evidence snippets | — |
| M4 | Demo mode, dashboard, alarms, polish | — |

Health check: `https://imuwupqf28.execute-api.us-east-1.amazonaws.com/api/health`

## Architecture

```
Browser ──HTTPS──► CloudFront ──OAC──► S3 (static React build)
   │
   └──HTTPS──► API Gateway (HTTP API) ──► Lambda (Node 22, arm64)
```

Everything is serverless and pay-per-use, with nothing billed hourly. The API allows CORS only
from the CloudFront origin. All resources are tagged `project = zero-to-shipped`.

## Repo layout

```
bootstrap/   Terraform state bucket (local state, apply once)
infra/       App infrastructure (S3 backend with native lockfile)
  modules/   api, frontend
services/    Lambda handlers (TypeScript, bundled with esbuild)
web/         Vite + React + TypeScript frontend
scripts/     deploy.ps1
docs/        agent-log.md (build log for the write-up)
```

## Prerequisites

- Terraform >= 1.10, Node.js >= 22, AWS CLI v2
- AWS profile `zts` for account `117227382789`, region `us-east-1`

## Deploy

```powershell
aws sso login --profile zts

# One-time: create the state bucket
terraform -chdir=bootstrap init
terraform -chdir=bootstrap apply

# Infrastructure and app
terraform -chdir=infra init
powershell -File scripts/deploy.ps1
```

`deploy.ps1` checks the AWS account, builds the Lambdas, runs `terraform apply`, builds the web
app with the API URL baked in, syncs it to S3 and invalidates CloudFront.

CloudFront is behind `enable_cloudfront` in `infra/variables.tf`. It is off until AWS
verifies the account for CloudFront.

## Local development

```powershell
cd services; npm install; npm run build    # outputs dist/<handler>/index.mjs
cd web; npm install
# web/.env.local:  VITE_API_PROXY=https://imuwupqf28.execute-api.us-east-1.amazonaws.com
npm run dev                                # Vite proxies /api to the deployed API
```
