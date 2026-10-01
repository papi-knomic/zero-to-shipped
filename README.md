# Lapse — never miss a renewal

Businesses upload licences, contracts, insurance policies, permits and certifications. Lapse
extracts the key dates and emails reminders 60, 30 and 7 days before anything expires. The user
confirms the dates before any reminders are scheduled.

Built for the AWS **Zero to Shipped** hackathon.

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | State bucket, hello-world API, frontend shell | Live at https://lapse.reck-tech.com (served from API Gateway; CloudFront awaiting account verification) |
| M1 | Upload, S3 trigger, mock extraction, DynamoDB, document list | Done |
| M2 | Review/confirm, EventBridge Scheduler reminders, SES + in-app feed | Done (SES in sandbox: verified recipients + in-app feed) |
| M3 | Textract extraction (Bedrock blocked for now) with evidence snippets | Done |
| M4 | Demo mode, dashboard, alarms, polish | Next |

Live: https://lapse.reck-tech.com · demo at `/app` · health check at `/api/health`

## Architecture

```
Browser ──HTTPS──► CloudFront ──OAC──► S3 (static React build)
   │
   ├──HTTPS──► API Gateway (HTTP API) ──► Lambda per route ──► DynamoDB (single table)
   │                                          │ presigned PUT URL
   └──PUT (presigned)──► S3 uploads ──ObjectCreated──► extract Lambda ──► Extractor ──► DynamoDB
```

1. `POST /api/uploads` creates the document (`UPLOADING`) and returns a presigned PUT URL.
2. The browser uploads straight to S3. `ObjectCreated` triggers the extract Lambda.
3. The configured `Extractor` (Amazon Textract Queries; `mock` for local work, Bedrock behind a
   flag) returns the document type, issuer, parties and dates, each with the line it was quoted
   from. DD/MM dates and "valid for twelve months" are parsed in code, and expiry is computed in
   code when the document only states a validity period. The status becomes `NEEDS_REVIEW`.
4. The user confirms or edits the fields. Confirming creates one-time EventBridge Scheduler
   schedules 60/30/7 days before expiry; the reminder Lambda emails via SES and records each
   reminder in an in-app feed.

Every Lambda has its own least-privilege role and X-Ray tracing. Logs and metrics go through
Powertools. Everything is serverless and pay-per-use, with nothing billed hourly. All resources
are tagged `project = zero-to-shipped`.

### API

All routes require an `x-workspace-id` header (a UUID; demo mode has no login).

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `POST /api/uploads` | `{filename, contentType, size}` → document + presigned PUT URL (PDF/PNG/JPEG, ≤ 10 MB) |
| `GET /api/documents` | Workspace documents, newest first |
| `GET /api/documents/{id}` | One document with its extraction |
| `PUT /api/documents/{id}/confirm` | Save reviewed fields, (re)schedule 60/30/7-day reminders; `reminderEmail: null` stops them |
| `POST /api/documents/{id}/test-reminder` | Demo: one reminder two minutes from now |
| `GET /api/notifications` | In-app reminder feed |
| `GET /api/email/status` · `POST /api/email/verify` | SES sandbox: can this address receive reminders? Send AWS's verification link |

## Repo layout

```
bootstrap/   Terraform state bucket (local state, apply once)
infra/       App infrastructure (S3 backend with native lockfile)
  modules/   lambda (shared), api, storage, extraction, reminders, domain, frontend
services/    Lambda code (TypeScript, bundled with esbuild)
  src/handlers/    one file per Lambda
  src/extractors/  Extractor interface, Textract (+ parsing), mock, expiry normalisation
  src/lib/         HTTP, AWS clients, observability, dates
web/         Vite + React + TypeScript frontend
scripts/     deploy.ps1, make-samples.mjs (sample PDFs for the demo)
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
cd services; npm install; npm test; npm run build    # outputs dist/<handler>/index.mjs
cd web; npm install
# web/.env.local:  VITE_API_PROXY=https://imuwupqf28.execute-api.us-east-1.amazonaws.com
npm run dev                                # Vite proxies /api to the deployed API
```
