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

## 2026-10-01 — M3: Textract extractor

**Asked:** Move to M3. Bedrock is blocked on the account, so use Textract (the fallback CLAUDE.md
names).

**Built:**
- `services/src/extractors/textract.ts`: AnalyzeDocument with 10 **Queries** (type, title,
  issuer, holder, issue / effective / expiry / valid-until dates, period, validity). It calls the
  sync API with S3Object and falls back to async Start/GetDocumentAnalysis for multi-page PDFs
  (first 3 pages only, since Textract bills per page). `fromBlocks()` is pure and maps the answers:
  - title from the short "type" answer; category by keyword
  - issuer: Textract's answer unless it equals the holder, otherwise the most specific
    organisation in the letterhead (SERVICE/MINISTRY > COMPANY > GOVERNMENT)
  - contracts: parties from "BETWEEN … (the Landlord) / AND … (the Tenant)", no issuer
  - expiry = most confident candidate that falls *after* the start date
  - "From X to Y" gives both the effective and the expiry date
  - evidence = the full LINE the answer was found on
- `services/src/extractors/parse.ts`: DD/MM-first date parsing (numeric, written-out, ISO),
  durations ("twelve (12) calendar months" → P12M, "a term of two (2) years" → P2Y), tidy
  title-casing of SHOUTED text with acronyms preserved.
- `scripts/make-samples.mjs`: five realistic Nigerian sample PDFs (fire certificate, insurance
  policy, tax clearance, premises permit, tenancy) with dates relative to the build day.
  The deploy script regenerates them; they're served at `/samples/*.pdf` for M4's demo seeding.
- Tests: 36, including `fromBlocks` against the **real Textract responses** for all five samples
  (trimmed fixtures).
- Landing page now states Textract instead of Bedrock/Claude, so the page matches what runs.

**Verified live:** all five samples downloaded from the site, uploaded through the API, and
extracted correctly in 7–9 s each (dates, issuers, parties and evidence lines checked against
the PDFs).

**Problems and fixes:**
- *Textract named the holder as the issuer* (fire certificate) and *answered "valid until?" with
  the start date* (tenancy, 47%). Fixed with the holder≠issuer check, the letterhead fallback, and
  the "expiry must follow start" rule. Each case has a fixture test.
- *Letterhead picked a contract party line* ("AND Adebayo Foods Limited (the Tenant)"). Contracts
  skip the letterhead, and party lines are excluded.
- *A scripted edit wrote a literal backspace* into a regex (Python turned `\b` into 0x08). Caught
  through a SyntaxWarning plus `cat -A`; fixed with the editor and covered by a new test.
- *CLI shorthand doesn't accept `fileb://` inside `Bytes=`.* Probed Textract through the SDK.
- **Lambda concurrency limit is 5 on this new account.** Five parallel 7-second extractions used
  every slot, and API calls got 503s (3 throttles in CloudWatch). Requested a quota increase to
  1,000 (Service Quotas, PENDING). Reserved concurrency can't be used, since AWS keeps 10
  unreserved slots. Next: an SQS buffer with max concurrency 2 in front of extraction.
- Local network resets (ECONNRESET) during testing: the e2e script now retries fetches.

## 2026-10-01 — M4: SQS buffer, demo mode, dashboard, alarms, docs

**Asked:** Request the Lambda concurrency increase, commit M3, then build the SQS buffer and M4.

**Built:**
- **SQS between S3 and extraction:** a queue with a dead-letter queue (3 receives), visibility
  timeout 6× the function timeout, and a queue policy limited to this bucket in this account. The
  event source mapping has **maximum concurrency 2** and reports per-message failures. The
  handler retries throttling and transient errors through the queue and marks a document FAILED
  only for permanent errors or on the last attempt.
- **Demo mode:** "Load sample documents" uploads the five generated PDFs through the real
  pipeline, then confirms two (reminders off) so judges see a mix of statuses and urgencies.
- **Observability module:** CloudWatch dashboard `lapse` (documents, extraction latency,
  reminders, API traffic and latency, Lambda concurrency/errors/throttles, errors by function,
  queue and DLQ, SES events, alarm panel). Five alarms: API 5xx, Lambda errors, Lambda throttles,
  extraction failures, DLQ not empty. They notify an SNS topic, with optional `alarm_email`.
- `docs/architecture.md` (Mermaid diagram, flows, data model, security, account constraints)
  and a README rewritten for judges: a two-minute walkthrough, the fallback table and the API.
- Removed `localhost:5173` from the upload CORS before submission.

**Verified live:** sample loading through `lapse.reck-tech.com`: five uploads, the queue
holding the later ones in UPLOADING, all NEEDS_REVIEW, two confirmed to ACTIVE, in 22 s. Metrics
are on the dashboard (23 extractions, 7 confirmations, reminders) and all 7 alarms are OK.

**Problems and fixes:**
- *The Lambda concurrency quota request* (5 → 1,000) went to **manual review** (CASE_OPENED).
- *The API itself was throttled under the demo burst.* Even with extraction capped, five
  parallel uploads plus five sample downloads (cold starts) hit the 5-slot limit: 2 throttles,
  one failed upload. Fixes in the browser:
  - the API client retries 503/429 with exponential backoff and jitter (safe, because a
    throttled request never runs the function)
  - samples upload one at a time
  - drag-and-drop uploads at most two at a time

  The re-run had 0 failed calls (5 throttles absorbed by retries).
- *Terraform has no function literals:* an attempted helper in `locals` was invalid HCL. I
  removed it and wrote the dashboard widgets out in full.

## 2026-10-01 — Redesign: "official paperwork, made calm"

**Asked:** "I don't like the styling… the design and colors could be so much better." There was
no brief, so the direction was the agent's call.

**Built:**
- New identity drawn from the domain (certificates, permits, policies):
  - warm paper and ink palette, deep green brand (also "all clear")
  - **highlighter yellow** for "needs you": Needs-review stamps, the review form, evidence quotes
  - vermilion, ochre and slate blue for time-to-expiry only
  - light and dark ("night desk") themes, plus a subtle SVG paper grain
- Type: Instrument Serif (headlines, countdowns, dates), Instrument Sans (text), IBM Plex Mono
  (labels, dates, references).
- Components:
  - status as rubber stamps
  - documents as paper slips with a coloured urgency tab
  - stats as one ledger strip
  - the validity timeline as a ruler
  - evidence quotes highlighted as if with a marker (`<mark>`)
  - new logo: a document with a highlighted line
- Landing page (still zero JavaScript): a desk scene in the hero. A stack of sheets with the fire
  certificate on top, its issue date and "twelve (12) calendar months" highlighted, an
  "EXPIRES · 5 DAYS LEFT" stamp and a "60 · 30 · 7" sticky note. Editorial problem columns, a
  four-step ledger with the human "You confirm" step highlighted, a ruled request flow, and a
  dark-green closing band.

**How it was checked:** headless Chrome against real data, in light and dark, at desktop and at
a true 390px width (iframes). Fixes found that way:
- light ink on the yellow marker in dark mode → marker text is always dark ink
- stamp widths made the countdown column zig-zag → fixed stamp width
- an orphaned heading word → `text-wrap: balance`
- on mobile the sticky note covered the stamp, and the issuer line ran under the folded corner

**Problems and fixes:**
- *A long heredoc with typographic apostrophes broke the shell's quoting.* It failed at parse
  time, so nothing was half-written; the page was written with the editor instead.

## 2026-10-02 — Invoices and multi-page PDFs

**Asked:** Re-probe CloudFront and Bedrock. Why did an uploaded invoice only get its issue date?
Can multi-page PDFs be handled? What would reading more pages cost?

**Account status:** CloudFront and Bedrock are still blocked. SES is still in the sandbox. Lambda
concurrency rose from 5 to 40 without action on our side. The Bedrock test on the user's main
account also returned "Operation not allowed". The agent did not touch that account (CLAUDE.md
rule); the user ran it.

**Findings and fixes** (each confirmed against live Textract before it was changed):
- *Invoice due date missing.* No query asked for it. Asked directly, Textract returned it at
  96%. Fix:
  - a `DUE` query, used as the reminder date only when there is no expiry, so a "premium due"
    line on a policy can't displace the end of cover
  - a new `Invoice` category
- *Invoice issuer and party swapped.* The generic "who issued this?" got no answer, so the
  letterhead fallback picked the first company on the page, which was the "Bill to" customer.
  The invoice-specific "Who is this invoice from?" / "billed to?" answered at 100% / 98%.
  These answers are used for invoices only.
- *Multi-page PDFs.* Textract returns one answer per page for each query, and the code kept
  whichever came last. A live 3-page contract came back titled "Signatures" (page 3), so it
  wasn't recognised as a contract. Fix: who/what questions take the earliest page that answers
  (letterhead); date questions take the most confident answer from any page.
- *Page limit 3 → 10.* At ~$0.015 per page, the worst case per upload is $0.15. Testing found
  that Textract **fails the job** when the page range runs past the end of the document. So the
  old "1-3" broke every 2-page PDF. A first fix ("try 1–10, on rejection read all pages") cost
  2–9 page PDFs three Textract calls. At the user's prompting, page counting moved up front:
  - **pdf-lib** reads the page tree; a regex can't, because most PDFs keep page objects in
    compressed streams, and a test proves that
  - one page goes to the sync API, more pages go to one async job for exactly `1-min(pages, 10)`
  - the old path remains only for PDFs the parser can't read
  - cost: +0.5 MB on the extraction bundle

**Verified live:** the 3-page contract now extracts as a Contract, titled "Service Agreement",
with both parties, effective and expiry from page 2; the logs show `pages: 3`. A 1-page sample
logs `pages: 1` and extracts exactly as before. 43 tests pass, including synthetic invoice,
multi-page and compressed-PDF page-count cases. The user's real invoice was used for testing but not committed,
because it contains bank details.

## 2026-10-03 — From hackathon entry to product: accounts (phase 1)

**Context:** The hackathon submission was missed (the user was ill over the deadline). Lapse
continues as a Reck Tech Ltd product for Nigerian businesses. Decisions:
- stay all-AWS and wait for CloudFront
- Paystack for billing, later
- Nigeria Data Protection Act obligations noted, for a lawyer or DPCO to confirm

**Asked:** Build sign-in. The user chose email + password plus Google, with Google as phase 2.
They also chose to keep the no-login demo, auto-deleted after 7 days. Mid-build requests:
- move demo documents into the account on sign-up
- collect the user's name. One full-name field, after discussing first/last: Nigerian names
  don't split cleanly, and nothing downstream needs the split.
- drop the architecture section from the landing page in favour of a truthful security section

**Built:**
- **Cognito** (`infra/modules/auth`):
  - user pool on the Essentials tier with deletion protection, email username, 10-character
    passwords, user-existence errors prevented, and Cognito's own email sender (SES is still
    in the sandbox)
  - a confidential app client whose secret lives in SSM
- **`auth` Lambda** (`/api/auth/{action}`): sign up, confirm, resend, sign in, refresh, sign
  out (revokes the refresh token), forgot and reset password, me.
  - Sessions are HttpOnly, Secure, SameSite=Lax cookies: the ID token (1 h, `/api`), plus the
    refresh token and username (30 d, `/api/auth`).
  - A user's workspace is their `sub`. A workspace META record is written on first sign-in.
    This is simpler than the planned custom attribute, with the same guarantees.
- **`session.ts`:** every route verifies the cookie itself (`aws-jwt-verify`). The demo
  header maps to `demo-<uuid>` and can never name a real workspace. 401s carry
  `session_expired` / `unauthenticated`, and the browser refreshes once, then goes to sign-in.
- **Demo expiry:** DynamoDB TTL on `expiresAt`, plus an S3 lifecycle rule on `ws/demo-`
  (7 days).
- **`claim-demo` Lambda:** writes the account record, copies the file, re-points future
  reminder schedules, then deletes the demo copies. The extractor now only processes
  documents still in UPLOADING/PROCESSING, so the copy's S3 event can't re-extract (and
  duplicate events can't either).
- **Web:**
  - sign-in, sign-up (with name and code step) and reset pages
  - account menu in the header
  - demo banner, and the move-your-demo-documents offer
  - samples in the demo only
  - the reminder email pre-filled with the account email
- **Landing page:** Get started / Try the demo / Sign in. Architecture is replaced by
  "Your documents are safe", which claims only what is true today.
- **Docs:** CLAUDE.md, README and architecture.md updated.

**Problems and fixes:**
- *Bundled AWS SDK errors all matched each other under `instanceof`.* The first live run
  failed 3 of 28 checks: a wrong password said "account already exists". The cause: the SDK
  implements `instanceof` by comparing class names, and esbuild's minifier renamed every class
  to `t`. This had been silently affecting older code too:
  - the extractor's "document missing" check
  - Textract's multi-page fallback
  - Scheduler's "already exists" path

  Reproduced with a minimal bundle and fixed with esbuild `keepNames: true`.
- *A redirect loop risk:* an expired session on a sign-in page could redirect to itself.
  Guarded.

**Verified live:** a throwaway `example.com` account went through the real API, confirmed via
admin API rather than email. 29/29 checks passed:
- sign-up validation (password, name), unconfirmed sign-in, wrong code, wrong password
- cookie flags and paths, me (with name)
- upload into `ws/<sub>/`
- a demo header carrying the user's sub reads nothing; form posts are rejected
- demo upload, confirm with 3 reminders, then claim: moved, still ACTIVE, file and schedules
  re-pointed, no expiry
- refresh after the ID token is dropped, sign-out, and the revoked refresh token refused

The test account and all its data were deleted afterwards.

## 2026-10-03 — Passports, view original, delete

**Asked:** The user's international passport extracted nothing. They also asked to view the
original file and to delete a document.

**Found (from logs and metadata only, not the passport's contents):** the passport finished as
"Document" with 0 dates. Two causes: passports label dates bilingually ("Date of expiry / Date
d'expiration"), and print them as `13 MAR /MARS 31` (month name, French alternative, 2-digit
year), which the parser didn't handle.

**Built:**
- `extractors/mrz.ts`: reads the machine-readable zone (ICAO 9303; TD3 passports, TD1 ID
  cards) and verifies the expiry by its 7-3-1 check digit, so a misread digit is rejected.
  - **Returned:** issuing state, holder name and expiry.
  - **Never returned:** date of birth and document number, enforced by a test.
  - **Evidence:** quotes the printed expiry line when it agrees, otherwise "Machine-readable
    zone: …". The MRZ line itself is never quoted.
- The parser now handles bilingual month names with 2- or 4-digit years.
- The `Passport` category.
- `document-file` Lambda: a five-minute signed inline link to the original (`s3:GetObject`
  only). The web app opens the tab synchronously so popup blockers allow it.
- `delete-document` Lambda: deletes reminder schedules first (so none fire), then the file, the
  document's reminder history and the record. Delete-only permissions. Web: **Delete
  document** with a confirm.

**Problems and fixes:** the first test run failed 3 of 59 because of my test data: a 45-character
MRZ line, and treating OCR's `«` as one `<` (it stands for two). Both fixed.

**Verified live (demo workspace):** the view link serves the original byte-for-byte as an inline
PDF, and another workspace gets 404. After deletion the record returns 404, the old link no
longer serves the file, and a second delete returns 404.
