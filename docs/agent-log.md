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

## 2026-09-30 — M1: upload, S3 trigger, mock extraction, document list + detail

**Asked:** Start M1 while CloudFront verification is pending. Commit M0 first and add a README.

**Built:**
- `infra/modules/lambda`: reusable module that gives each Lambda its own role (basic logging +
  `AWSXRayDaemonWriteAccess` + an inline least-privilege policy), a 14-day log group and Active tracing.
- `infra/modules/storage`: DynamoDB single table `lapse` (on-demand, point-in-time recovery,
  deletion protection) and a private uploads bucket (TLS-only, PUT-only CORS, cleanup of
  incomplete multipart uploads).
- `infra/modules/api`: route table with one Lambda per route. `POST /api/uploads` (PutItem +
  s3:PutObject on `ws/*`), `GET /api/documents` (Query) and `GET /api/documents/{id}` (GetItem).
  `moved` blocks adopted the M0 health resources, so nothing was recreated.
- `infra/modules/extraction`: `lapse-extract` is triggered by S3 `ObjectCreated` on `ws/`.
  Status goes UPLOADING → PROCESSING → NEEDS_REVIEW, or FAILED with a reason.
- `services/src/extractors`: the `Extractor` interface, a mock with realistic Nigerian fixtures
  picked by filename keyword, and `normalizeExtraction`, which computes expiry from issue/effective
  date + validity period in code. Covered by `node --test` (10 tests).
- Powertools Logger, Tracer (SDK clients captured) and Metrics (`DocumentsProcessed`,
  `ExtractionLatency`, `ExtractionFailures`, `ColdStart`).
- Web: workspace UUID in localStorage sent as `x-workspace-id`, drag-and-drop upload (presigned
  PUT straight to S3), document list with expiry countdowns, and a detail view with date cards,
  evidence quotes and confidence. Polls while anything is in flight. No router dependency.

**Verified end to end** (scripted against the live API): upload → PUT → NEEDS_REVIEW in about 4 s.
Workspace isolation holds (another workspace gets 404 / an empty list). Each rejection case
returns the right status: 400 for a missing header, bad JSON or a bad ID; 415 for the wrong
type; 413 for over 10 MB; 404 for an unknown document. The S3 preflight allows
`localhost:5173` and returns 403 for other origins. X-Ray traces and the custom metrics
appear in CloudWatch.

**Problems and fixes:**
- *The user tested the UI before apply* and got a 404 on `POST /api/uploads`: the route
  didn't exist yet. The apply fixed it.
- *Presigned PUT and checksums:* recent SDK v3 versions sign a CRC32 checksum into presigned
  URLs by default, which a browser PUT can't match. `requestChecksumCalculation: 'WHEN_REQUIRED'`
  on the S3 client prevents that.
- *Presigned PUTs can't enforce size:* the API validates the declared size, and the extract
  Lambda checks the real object size from the S3 event and marks the document FAILED if it's too big.
- *S3 async retries:* extraction errors mark the document FAILED instead of throwing, so a
  broken file isn't retried twice.
- *Running tests without a build step:* Node 24 strips TypeScript types natively. With
  `allowImportingTsExtensions` and `erasableSyntaxOnly`, `node --test` runs the `.ts` files
  directly and esbuild bundles the same sources.
- *Terraform `count` on unknown values:* policy statements are passed as a list, so
  `count = length(...)` is known at plan time even when the ARNs aren't.
- The health Lambda's invoke permission was replaced (the source ARN narrowed to `GET`), which
  meant a few seconds of possible errors during the apply.

## 2026-09-30 — UI and colour redesign

**Asked:** "Make the UI and colors better."

**Built:**
- New palette with fixed roles: indigo means "your action" (brand, buttons, Needs review);
  red, amber and green mean time left only, in bands that match the reminder schedule
  (≤7 / ≤30 / ≤60 / >60 days, plus expired). The old orange brand colour clashed with warnings.
  Tokens live in `:root`, with a dark variant under `prefers-color-scheme`. Components read a
  `--tone` / `--tone-soft` pair set by `.tone-*` classes.
- Plus Jakarta Sans (Google Fonts), a gradient logo mark (a clock ring with a gap) that is
  also the favicon, and a soft indigo glow behind the page.
- Home: two-column hero with the upload card, a stats strip (tracked / needs review / due in 30
  days / expired), and document cards sorted by soonest expiry, with an urgency-tinted icon,
  countdown and status pill.
- Detail: a validity timeline (issue → expiry, with today and the 60/30/7-day reminder ticks),
  a details card, and date cards with a confidence meter and evidence quote. Computed expiry is
  marked differently from quoted dates.
- Loading skeletons, spinners, pulsing in-flight states, and reduced-motion support.
- Dev-only `?workspace=<uuid>` override so headless screenshots can open a seeded workspace
  (guarded by `import.meta.env.DEV`; confirmed absent from the production bundle).

**How it was checked:** headless Chrome screenshots against a separate Vite server on :5174 with
a seeded workspace, in light and dark themes and at desktop and 390px width.

**Problems and fixes:**
- Headless Chrome follows the OS theme; `--blink-settings=preferredColorScheme=1|0` forces it.
- Chrome on Windows won't shrink a window below about 500px, so "mobile" screenshots were
  cropped. Rendering the app inside 390px iframes gave a true phone-width check.
- Plus Jakarta Sans has tight word spaces; added a small `word-spacing` globally and more on
  the display heading.
- Python on Windows read UTF-8 files as cp1252 during scripted edits. Use `encoding='utf-8'`
  or `PYTHONUTF8=1`.

## 2026-10-01 — Fallback hosting, landing page, custom domain

**Asked:** Re-check CloudFront (still blocked). Serve the site without CloudFront so there's a
live URL for SES production access and judging, on `lapse.reck-tech.com` (Cloudflare DNS).
What are the fallbacks if Bedrock and SES stay blocked?

**Built:**
- `lapse-web` Lambda on the existing HTTP API (`ANY /`, `ANY /{proxy+}`; explicit `/api/*`
  routes still win), behind `serve_web = !enable_cloudfront`. It serves the web build from its own
  zip, loaded into memory once per container:
  - `/` → static landing page; other extension-less paths → `app.html`
  - a missing file → 404, never HTML; an unmatched `/api/*` → JSON 404; other methods → 405
  - immutable caching for hashed assets; CSP, HSTS, nosniff and frame-deny headers
- Frontend split into two Vite pages. `index.html` is a **zero-JS** landing page (headline,
  problem, how it works, AWS architecture, "Try the demo") for the judging crawler and the SES
  reviewer. `app.html` is the React demo at `/app`. The CloudFront rewrite function and a Vite
  dev middleware follow the same routing rules.
- `infra/modules/domain`: ACM certificate (us-east-1, so CloudFront can reuse it), then
  (`custom_domain_attach`) certificate validation + a REGIONAL API Gateway custom domain + API
  mapping. DNS stays in Cloudflare: one CNAME for validation and one for `lapse`.
- Uploads bucket CORS now also allows the `execute-api` origin and `https://lapse.reck-tech.com`.
- `deploy.ps1` builds web before services (the web build is packaged into `lapse-web`) and only
  syncs to S3 / invalidates when a CloudFront distribution exists.
- Metrics are flushed only when something was recorded, so functions with no custom metrics stop
  logging "No application metrics to publish" on every request.

**Verified:** live routes and status codes, zero `<script>` tags on the landing page, security
headers, asset caching, and the custom domain returning 200 with valid TLS via a pinned IP
before the DNS cutover.

**Service checks (new-account restrictions):**
- CloudFront: still "account must be verified". Re-checked with a deliberately invalid
  CreateDistribution, which can't create anything.
- Bedrock: `Converse` → `ValidationException: Operation not allowed`, so blocked.
- Textract: reachable. Use AnalyzeDocument Queries as the M3 extractor.
- SES: sandbox (200/day), so production access needs requesting.
- Fallbacks agreed:
  - extraction: Bedrock → Textract Queries → manual entry on review
  - email: SES production → SES sandbox with self-verified recipients → in-app feed

**Problems and fixes:**
- *Wrong domain:* the user first said `recktech.com`, which is a different domain whose DNS is
  at GoDaddy. Public NS lookups showed the mismatch. Switched to `reck-tech.com` (Cloudflare);
  the certificate was replaced with create-before-destroy.
- *`-target` pulled in extra changes:* `-target=module.domain` dragged in a CloudFront function
  update through the dependency chain. Targeting the certificate resource alone kept the apply
  to exactly what was authorised.
- *Stale outputs after a targeted apply:* Terraform warned that outputs may be incomplete and
  printed the old validation record. Read the new record from `aws acm describe-certificate`.
- *CSS order:* Vite emitted `landing.css` before `styles.css`, so base `.button` padding overrode
  `.button-sm/-lg`. Fixed by `@import`-ing `styles.css` from `landing.css` (one bundle).
- *SSO token expiry* interrupts AWS calls about once a day: `aws sso login --profile zts`.

## 2026-10-01 — M2: review/confirm, Scheduler reminders, SES + in-app feed

**Asked:** Move on to M2. SES production access came back "more information needed". Also asked:
can we work with the SES sandbox, and how should I reply to Support about the account
verification?

**Built:**
- `PUT /api/documents/{id}/confirm`: validates the reviewed fields and the reminder email,
  replaces all EventBridge Scheduler schedules (deletes old ones, then creates `at()` schedules
  at 60/30/7 days before expiry, 09:00 WAT, future dates only, `ActionAfterCompletion=DELETE`), and
  marks the document ACTIVE. `reminderEmail: null` = "Stop reminders". FAILED documents can be
  confirmed with hand-entered details (the manual fallback for extraction).
- `POST /api/documents/{id}/test-reminder`: one schedule 2 minutes out, at most one pending per
  document (a ConflictException becomes 409).
- `lapse-reminder` (Scheduler target): renders a transactional email (text + HTML, user text
  escaped), sends through SES v2 with configuration set `lapse`, and **always** writes a
  `NOTIF#<ts>#<docId>` item. In the sandbox an unverified recipient gives `NOT_DELIVERED`
  ("In-app only") instead of an error.
- `GET /api/notifications` (the in-app feed), `GET /api/email/status` (production access or a
  verified address/domain counts as deliverable), and `POST /api/email/verify` (sandbox
  fallback: AWS sends a verification link; capped at 3 per workspace with a DynamoDB counter).
- `infra/modules/reminders`: schedule group, a Scheduler role that may only invoke the reminder
  Lambda, the reminder Lambda, SES configuration set (bounce/complaint suppression, reputation
  metrics, CloudWatch event destination), account-level suppression, and bounce/complaint-rate
  alarms. These back up what the SES production-access reply describes.
- Least privilege: confirm/test can only create or delete schedules in `schedule/lapse/*` and
  pass only the Scheduler role; the SES calls are scoped to this account's identities.
- UI: review form (pre-filled from extraction, flags a computed expiry, remembers the email,
  shows deliverability with a verify button), reminders card (three reminder dates with
  scheduled/sent/passed state, test button, edit, stop), and a Reminder activity feed on `/app`.
- Tests: 20 (reminder timing incl. past offsets and the 1-minute lead, email copy, escaping).

**Verified end to end against the live API:** validation (400s, 409 before confirm); confirm
created exactly the future offsets (30d and 7d for a doc 55 days out); editing the expiry
replaced them with 60/30/7; test reminders fired after about 2 minutes. The verified Gmail
address got the email (the user confirmed it arrived, marked SENT), and the unverified address
was recorded `NOT_DELIVERED` with SES's sandbox message. `testReminderAt` cleared after firing;
the duplicate test returned 409; "stop" deleted every schedule. Screenshots checked for the
review form, the feed (dark) and the active document.

**Service status:**
- SES production access: "more information needed". A reply was drafted covering the use case,
  volume, opt-in, bounce/complaint handling and a sample email. Sandbox delivery plus
  self-verification and the in-app feed covers the demo either way.
- CloudFront and Bedrock: still blocked. A follow-up for the Support case was drafted with the
  deadline, request IDs and use case.

**Problems and fixes:**
- *Sandbox send permissions:* in the SES sandbox, `ses:SendEmail` is also authorised against the
  recipient identity, so the reminder Lambda is allowed `identity/*` in this account, not just
  the sending domain.
- *Empty metrics warning:* functions without custom metrics logged "No application metrics to
  publish" on every call. `hasStoredMetrics()` now guards the flush.
- *Test hygiene:* the e2e script stops reminders at the end, so the real 30/7-day schedules it
  created don't email the user in the coming weeks.
