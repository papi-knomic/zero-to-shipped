# Lapse — never miss a renewal

AWS "Zero to Shipped" hackathon entry. Deadline: Oct 2, 2026 11:59 PM PDT.
A live public URL on AWS is a pass/fail gate, so keep the app deployable at every step.

## What it does
Businesses upload documents (licences, contracts, insurance policies, permits, certifications).
The app extracts document type, issuer, parties and all relevant dates, the user confirms the
details, and the app schedules escalating reminders (60, 30, 7 days before expiry) by email.

## Hard rules for the agent
- Only ever operate in AWS account `117227382789` via profile `zts`, region `us-east-1`.
  Run `aws sts get-caller-identity` before any deploy; stop if the account differs.
- Never read, modify or use any other AWS profile in `~/.aws/config`.
- Never delete the Terraform state bucket or run `terraform destroy` without asking.
- Nothing billed hourly: no NAT gateways, RDS, EC2, always-on Fargate, OpenSearch.
- Tag everything via provider `default_tags`: `project = "zero-to-shipped"`.
- After each work session, append a short entry to `docs/agent-log.md`
  (what was asked, what was built, problems hit, how they were fixed). This feeds the write-up.

## Stack
- TypeScript, Node.js 22 Lambdas, bundled with esbuild.
- Terraform >= 1.10, S3 backend with `use_lockfile = true` (no DynamoDB lock table).
  Provider sets `allowed_account_ids = ["117227382789"]`.
- Frontend: Vite + React + TypeScript, minimal dependencies, static build on S3 + CloudFront.
- Powertools for AWS Lambda (TypeScript): Logger, Tracer (X-Ray), Metrics.

## Repo layout
```
bootstrap/        # one-time: state bucket (local state)
infra/            # all app infrastructure
  modules/        # auth, api, storage, extraction, reminders, frontend, observability, domain
services/         # Lambda handlers + shared code
  src/extractors/ # Extractor interface + mock | bedrock | textract implementations
web/              # frontend
docs/             # agent-log.md, architecture diagram, write-up notes
```

## Architecture
1. Frontend requests a presigned S3 PUT URL from the API and uploads the file directly to S3.
2. S3 `ObjectCreated` triggers the extract Lambda, which calls the configured Extractor and
   writes the result to DynamoDB with status `NEEDS_REVIEW`.
3. User reviews and confirms or edits the extracted fields in the UI. Status becomes `ACTIVE`.
4. On confirm, the API creates one-time EventBridge Scheduler schedules (`at(...)`) for each
   reminder offset that is still in the future, targeting the reminder Lambda, with
   `ActionAfterCompletion = DELETE`. Editing the expiry date replaces the schedules.
5. The reminder Lambda sends email via SES and records the notification in DynamoDB.

API: API Gateway HTTP API + Lambda. Least-privilege IAM role per Lambda.

## Extraction
- `Extractor` interface: `extract(bucket, key) => ExtractionResult`.
- Selected by env var `EXTRACTOR=mock|bedrock|textract`. Start with `mock`.
- `bedrock`: Converse API with the PDF/image as a document block. `BEDROCK_MODEL_ID`
  (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`). If confidence is low or required
  fields are missing, retry once with `BEDROCK_ESCALATION_MODEL_ID` (Sonnet).
- `textract`: AnalyzeDocument with Queries ("What is the expiry date?", etc.). Fallback if
  Bedrock access stays blocked.
- Result schema: `documentType`, `title`, `issuer`, `parties[]`,
  `dates[]` (each: `label` issue|effective|expiry|renewal, `isoDate`, `evidence` quote, `confidence`),
  `validityPeriod` (e.g. "P12M", when the doc states a duration instead of a date), `notes`.
- Dates are DD/MM by default (Nigerian documents). Compute expiry from issue date + validity
  period in code, never in the model.

## Data (DynamoDB, single table, on-demand)
- `PK = WS#<workspaceId>`, `SK = DOC#<docId>` for documents.
- `SK = NOTIF#<timestamp>` for sent reminders.
- Document fields: s3Key, status, extraction, confirmed fields, reminderEmail, scheduleNames[].

## Accounts
- Cognito user pool (email + password + name). Only the `auth` Lambda calls Cognito, with the
  app client secret from SSM. Sessions are HttpOnly cookies; every route verifies the ID token
  (`services/src/lib/session.ts`). A user's workspace ID is their Cognito `sub`.
- Phase 2 (planned): "Continue with Google" via a Cognito domain + Google IdP.

## Demo mode (anyone can try it instantly at /demo)
- No login. A workspace ID is generated and kept in localStorage, sent as `x-workspace-id`, and
  always mapped server-side to `demo-<uuid>` (never a real workspace). Demo data expires after 7 days.
- "Load sample documents" seeds 4-5 realistic documents with a mix of statuses (demo only).
- "Send test reminder" schedules a reminder 2 minutes from now so visitors see the email flow.
- SES may be in sandbox: also show every reminder in an in-app notifications feed.
- After sign-in, demo documents can be moved into the account (`claim-demo`).

## Observability
- Structured logs, X-Ray tracing and custom metrics (documents processed, extraction latency,
  escalations, reminders sent) via Powertools.
- CloudWatch dashboard and error alarms defined in Terraform.

## Milestones (do them in order, deploy after each)
- M0: bootstrap state bucket; hello-world Lambda behind a public HTTPS URL; frontend shell
  on CloudFront. Ship gate cleared.
- M1: presigned upload, S3 trigger, mock extractor, DynamoDB, document list + detail UI.
- M2: review/confirm flow, Scheduler reminders, SES + in-app notifications.
- M3: real extractor (bedrock or textract), escalation, evidence snippets in the UI.
- M4: demo mode, dashboard, alarms, polish, architecture diagram, README.


## Landing page
- The hackathon submission was missed (Oct 2026); Lapse is now a Reck Tech Ltd product for
  Nigerian businesses. The landing page sells to them: problem, how it works, security, CTAs.
- It stays static HTML with no JavaScript (fast, crawlable), with "Get started" and "Try the demo".
- Only claim on it what is true today (e.g. no "never used to train AI" until the opt-out exists).