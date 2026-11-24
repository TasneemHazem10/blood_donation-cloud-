# Deployment

All URLs, account ids and credentials below are **placeholders**. Never commit a real key, `.env`, `.dev.vars`, `infra/secrets.env` or `infra/.state` (all are git-ignored).

## 0. Prerequisites

| Tool | Used for | Check |
| --- | --- | --- |
| Node.js 22+ (`engines` in `package.json`) | local servers, tests, esbuild bundles | `node --version` |
| npm workspaces | installs `shared`, three services and `frontend` together | `npm install` |
| Docker Desktop | Floci emulator | `docker --version` |
| AWS CLI v2 | driving Floci with `aws --endpoint-url` | `aws --version` |
| Git Bash on Windows | running the `infra/*.sh` scripts | `bash --version` |
| Wrangler 4 (`devDependency`) | Workers/Pages deployment and secrets | `npx wrangler --version` |
| Neon account + psql or SQL editor | public Postgres schema | `psql --version` (optional) |

> Repository status: there is **no `.git` directory yet** in the workspace, so the GitHub repository, branches, PRs, tag `v1.0` and commit history are still a checklist item. Capture them before writing the report's section 7.

## Verified results (25 Nov 2026)

* Local website: `http://localhost:8090`; APIs: `3001` drive, `3002` donor, `3003` booking. The seed's final message now prints `http://localhost:8090` (the 8080 conflict was resolved by using 8090).
* `npm test`: **51 tests, 51 pass, 0 fail**, across `tests/{booking-api,donor-api,drive-api,integration,shared-rules}.test.js`.
* Local smoke `.data/smoke.mjs`: **22 PASS** (register/login, drive and slot, eligibility, booking `201`, duplicate `409`, reminders 1 sent + 1 skipped, check-in `attended`, donation recorded, report `{booked:1,attended:1,turnout:100,storage:"database"}`, and 401/403/404/400/409 cases). It creates fresh accounts each run and supports `BDO_API_URL` for Floci.
* `bash infra/deploy-all.sh` now completes: **ALL CHECKS PASSED** — drive/donor/booking health 200, drive list 200, website 200, Floci dashboard 200. API Gateway: `http://4f503503dd.execute-api.localhost.floci.io:4566`; 9 DynamoDB tables, 3 `bdo-*` Lambdas, `bdo-drive-reports` and `bdo-web` S3 buckets.
* Floci smoke through the API Gateway: **22 PASS**, report `storage:"s3"`.
* Booking ids use `driveId__donorId`; `idParam()` accepts them and cancel/check-in work.
* Public Cloudflare/Neon deployment is still **pending real credentials, a public URL, video and frontend browser screenshot**.

---

## 1. Local development (no cloud account)

```bash
npm install
npm run dev
```

`infra/scripts/dev-all.js` starts:

| Process | URL | Notes |
| --- | --- | --- |
| Website | `http://localhost:8090` | Static server for `frontend/`; **8090** is used because 8080 was already occupied on the development machine |
| Drive API | `http://localhost:3001` | `services/drive/server.js` |
| Donor API | `http://localhost:3002` | `services/donor/server.js` |
| Booking API | `http://localhost:3003` | `services/booking/server.js` |

The script injects `NODE_ENV=development`, `TEST_MODE=1`, `EMAIL_MODE=log`, `DATA_DRIVER=sqlite`, `SQLITE_PATH=.data/bdo.sqlite`, three service URLs, `CORS_ORIGINS=http://localhost:8090`, and development-only JWT/internal/invite values. No Turnstile token or email key is needed.

Optional demo data (created **through the real APIs**, not by writing the database directly):

```bash
npm run seed
```

The seed prints organiser/donor credentials, a drive id and `http://localhost:8090`; its final message was updated from the old port.

Local verification:

```bash
curl -s http://localhost:3001/api/health/drive
curl -s http://localhost:3002/api/health/donor
curl -s http://localhost:3003/api/health/booking
curl -s http://localhost:8090/
curl -s http://localhost:3001/api/drives
```

Stop everything with `Ctrl+C` in the `npm run dev` terminal (the script kills its three children on `SIGINT`).

---

## 2. Floci / AWS emulator deployment

### 2.1 Start the emulator

```bash
docker compose -f infra/floci/docker-compose.yml up -d
curl -fsS http://localhost:4566/_floci/health
```

The compose file maps port `4566`, region `us-east-1`, dummy credentials `test/test`, and a persistent `floci-data` volume. `infra/config.sh` exports the same dummy AWS credentials and defines `aws_f()` = `aws --endpoint-url http://localhost:4566`.

### 2.2 One-command deployment

Run from the project root in Git Bash:

```bash
npm install
bash infra/deploy-all.sh
```

This bundles code, creates the gateway, deploys the three student services, uploads the frontend, and runs checks:

```bash
npm run zip:all       # dist/lambda/{drive,donor,booking}.zip, handler index.handler
npm run workers:bundle # services/*/dist/worker.js (prepares the Cloudflare artefacts too)
bash infra/gateway.sh
bash infra/services/drive.sh
bash infra/services/donor.sh
bash infra/services/booking.sh
bash infra/frontend.sh
bash infra/check.sh
```

Verified on 25 Nov 2026: this script completes with **ALL CHECKS PASSED**. Deployment fixes now in place: relative `fileb://dist/lambda/<service>.zip` paths avoid Windows paths with spaces; Lambda `AWS_ENDPOINT_URL=http://floci:4566` uses Docker DNS instead of localhost; the S3 client sets `forcePathStyle` for emulator endpoints; and `shared/router.js` normalizes `serverless-http` Buffer bodies so Express 5 parses JSON on Lambda. DynamoDB `reserveSeat()` uses read-compare-update with retry (`ConditionExpression` arithmetic is invalid).

`infra/config.sh` generates `infra/secrets.env` on first use with random `JWT_SECRET`, `INTERNAL_KEY` and an `ORGANIZER_INVITE`, prints the invite, and stores gateway ids/URL in `infra/.state`. Override values by copying `infra/secrets.env.example` to `infra/secrets.env` before the first run.

### 2.3 Resources per student (at least three AWS services each)

| Student / service | AWS services actually used | Resource names |
| --- | --- | --- |
| **Habiba — Drive** (`infra/services/drive.sh`) | 1. DynamoDB (4 tables)<br>2. S3 (`bdo-drive-reports` for CSV snapshots)<br>3. IAM role + policy<br>4. CloudWatch Logs<br>5. Lambda (`nodejs22.x`, 20 s)<br>6. API Gateway routes | tables `bdo_drives`, `bdo_slots`, `bdo_reports`, `bdo_geocodes`; IAM `bdo-drive-role`; log group `/aws/lambda/bdo-drive-service`; Lambda `bdo-drive-service` |
| **Tasneem — Donor** (`infra/services/donor.sh`) | 1. DynamoDB (3 tables)<br>2. IAM role + policy<br>3. CloudWatch Logs<br>4. Lambda<br>5. API Gateway routes<br>(Turnstile is an external SaaS check) | tables `bdo_users`, `bdo_donors`, `bdo_donations`; IAM `bdo-donor-role`; log group `/aws/lambda/bdo-donor-service`; Lambda `bdo-donor-service`; `TURNSTILE_SECRET` env var |
| **Hala — Booking** (`infra/services/booking.sh`) | 1. DynamoDB (2 tables)<br>2. IAM role + policy (incl. `lambda:InvokeFunction`)<br>3. CloudWatch Logs<br>4. Lambda<br>5. EventBridge rule<br>6. API Gateway routes<br>(Brevo is external) | tables `bdo_bookings`, `bdo_reminders`; IAM `bdo-booking-role`; log group `/aws/lambda/bdo-booking-service`; Lambda `bdo-booking-service`; rule `bdo-daily-reminders` |
| Shared | 1. API Gateway HTTP API (all routes + `OPTIONS` proxy routes)<br>2. S3 static website `bdo-web` with public read policy | `API_ID`, `API_URL` in `infra/.state`; site URL `<FLOCI_URL>/bdo-web/index.html` |

`infra/gateway.sh` creates one HTTP API and maps each `METHOD /path` (curly-brace parameters) to the owning Lambda. `infra/frontend.sh` copies `frontend/index.html`, `css/`, `js/` and generates `js/config.js` pointing all three services at `API_URL`; no secret is written to that file.

Environment variables passed to the Lambdas include `DATA_DRIVER=dynamo`, `AWS_ENDPOINT_URL=http://floci:4566` (Docker DNS), JWT/internal/invite values, the three service URLs, `CORS_ORIGINS=http://localhost:4566`, plus `REPORTS_BUCKET` (drive), `TURNSTILE_SECRET` (donor) and `EMAIL_MODE`/`BREVO_API_KEY` (booking).

### 2.4 Daily reminder cron on Floci

`infra/services/booking.sh` creates:

```
cron(0 6 * * ? *)  →  rule bdo-daily-reminders  →  Lambda bdo-booking-service
```

The rule invokes `bdo-booking-service` directly. `services/booking/lambda.js` detects EventBridge events with `source === 'aws.events'` and `detail-type === 'Scheduled Event'`, then calls the same `sendForDate()` logic with `event.detail.date` or tomorrow; HTTP API v2 events still go through `serverless-http`. The organizer Emails button and `POST /internal/reminders/daily` are manual triggers for the same function, and local/Floci smoke verifies 1 reminder sent + 1 skipped when run twice.

### 2.5 Floci verification commands

```bash
source infra/config.sh && source infra/.state

# Gateway health and UI
curl -s "$API_URL/api/health/drive"
curl -s "$API_URL/api/health/donor"
curl -s "$API_URL/api/health/booking"
curl -s "$FLOCI_URL/bdo-web/index.html" | head
curl -s "$FLOCI_URL/_floci/ui" | head

# Resources
aws_f dynamodb list-tables --query TableNames --output text
aws_f lambda list-functions --query Functions[].FunctionName --output text
aws_f apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[].RouteKey' --output text
aws_f events list-rules --query 'Rules[].Name' --output text
aws_f s3api list-buckets --query Buckets[].Name --output text

# Full PASS/FAIL summary (also good evidence)
bash infra/check.sh
```

`infra/check.sh` prints `PASS`/`FAIL` for the three health endpoints, drive list, website file and dashboard, then lists DynamoDB tables, Lambdas and S3 buckets. The verified run ends with **ALL CHECKS PASSED**.

Teardown (does not delete `.data` or secrets):

```bash
bash infra/destroy.sh
```

---

## 3. Cloudflare Workers + Neon (public target)

### 3.1 Before starting — confirmation checklist

- [ ] Confirm with the instructor that Cloudflare + Neon are accepted (the sample lab uses Floci). Save the reply as a screenshot for report section 6.
- [ ] Create a Neon project; note the connection string as `<NEON_DATABASE_URL>` (secret).
- [ ] Create one database role per service if the instructor expects it; store each password only in the connection string.
- [ ] Create Cloudflare account; note the account id `<CF_ACCOUNT_ID>` (placeholder).
- [ ] Record the real Pages/Workers hostnames after deployment; replace every `<...>` placeholder in the report and `window.BDO` config.

### 3.2 Apply the schema

Either paste `infra/db/schema.sql` into the Neon SQL editor or run:

```bash
psql "<NEON_DATABASE_URL>" -f infra/db/schema.sql
```

This creates the nine `(id text PRIMARY KEY, data jsonb NOT NULL)` tables. `createNeonStore.init()` also issues `CREATE TABLE IF NOT EXISTS`, so the tables are safe to re-apply.

### 3.3 Bundle and deploy the three Workers

```bash
npm run workers:bundle
# writes services/{drive,donor,booking}/dist/worker.js

npx wrangler deploy --config services/drive/wrangler.toml   # -> <DRIVE_WORKER_URL>
npx wrangler deploy --config services/donor/wrangler.toml   # -> <DONOR_WORKER_URL>
npx wrangler deploy --config services/booking/wrangler.toml # -> <BOOKING_WORKER_URL>
```

Each `wrangler.toml` sets `main = "dist/worker.js"`, `DATA_DRIVER = "neon"`, `NODE_ENV = "production"` and `CORS_ORIGINS = "https://bdo-organizer.pages.dev"`. Change that var if the actual Pages hostname differs. Booking also sets `EMAIL_MODE = "log"`; set it to a live value (for example `live`) only after a Brevo key is configured.

### 3.4 Secrets and variables

Set secrets (never put these values in `wrangler.toml`):

```bash
# On each of the three services (repeat with --config for donor and booking)
npx wrangler secret put DATABASE_URL    --config services/drive/wrangler.toml
npx wrangler secret put JWT_SECRET      --config services/drive/wrangler.toml
npx wrangler secret put INTERNAL_KEY    --config services/drive/wrangler.toml
npx wrangler secret put ORGANIZER_INVITE --config services/drive/wrangler.toml

# Cross-service bases (required by shared/serviceClient.js)
npx wrangler secret put DRIVE_SERVICE_URL  --config services/drive/wrangler.toml
npx wrangler secret put DONOR_SERVICE_URL  --config services/drive/wrangler.toml
npx wrangler secret put BOOKING_SERVICE_URL --config services/drive/wrangler.toml
# ...repeat for donor and booking with the same three Worker URLs

# Donor only
npx wrangler secret put TURNSTILE_SECRET --config services/donor/wrangler.toml

# Booking only
npx wrangler secret put BREVO_API_KEY --config services/booking/wrangler.toml
npx wrangler secret put EMAIL_FROM    --config services/booking/wrangler.toml
```

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | all Workers | Neon HTTP connection string |
| `JWT_SECRET`, `INTERNAL_KEY`, `ORGANIZER_INVITE` | all Workers | Token signing, internal-call key, organiser sign-up gate |
| `DRIVE_SERVICE_URL`, `DONOR_SERVICE_URL`, `BOOKING_SERVICE_URL` | all Workers | Server-to-server bases; use the real Worker URLs, not `localhost` |
| `CORS_ORIGINS` | all Workers | Must match the deployed frontend origin |
| `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` | Donor / frontend | Bot check; site key is public and placed in `window.BDO` |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_MODE` | Booking | Transactional email; without a key the code logs to `EMAIL_DEV_LOG` |
| `REPORTS_BUCKET` | Drive | Only used on Floci/S3; leave unset on Workers |
| `DONATION_INTERVAL_DAYS` | Donor | Default 56; optional override |
| `REMINDER_DAYS_AHEAD` | config only | Defined in `shared/config.js` but **not yet used** by reminder code (which always uses tomorrow) |

Inspect deployed configuration with `npx wrangler secret list --config ...` and logs with `npx wrangler tail bdo-booking`.

### 3.5 Frontend on Cloudflare

`frontend/wrangler.toml` declares:

```toml
name = "bdo-organizer"
assets = { directory = "./", html_handling = "auto-trailing-slash", not_found_handling = "single-page-application" }
```

Before deploying, `frontend/js/config.js` must contain the real Worker URLs:

```js
window.BDO = {
  services: {
    drive: '<DRIVE_WORKER_URL>',
    donor: '<DONOR_WORKER_URL>',
    booking: '<BOOKING_WORKER_URL>'
  },
  turnstileSiteKey: '<TURNSTILE_SITE_KEY>',
  appName: 'BloodLink'
};
```

> `infra/scripts/configure-cloudflare.js` **exists**, and `npm run deploy:cloudflare` runs it. With real Cloudflare/Neon environment variables it bundles Workers, applies the schema, deploys, sets secrets (including the detected Pages URL for `CORS_ORIGINS`), writes `frontend/js/config.js`, and verifies the three health endpoints. No real credentials or public URL have been used yet; no secrets belong in this file.

Deploy:

```bash
npx wrangler deploy --config frontend/wrangler.toml   # -> <PAGES_OR_WORKERS_SITE_URL>
```

If using classic Cloudflare Pages instead, create a Pages project named `bdo-organizer` and upload `frontend/`; then set the same `window.BDO` values through the Pages build output. The report must use the final public URL, never `localhost`.

### 3.6 Cloudflare cron status — checklist

- [x] `services/booking/wrangler.toml` sets `[triggers] crons = ["0 6 * * *"]`.
- [x] `services/booking/worker.js` exports `scheduled(controller, env, ctx)`, which calls the same `sendForDate()` logic as the organizer button and `/internal/reminders/daily`.
- [x] Floci EventBridge events are handled by `services/booking/lambda.js` when `source === 'aws.events'`.
- [ ] Public Cloudflare cron execution is unverified: real Cloudflare/Neon credentials and a deployed URL are still pending. Organizer → Emails (`POST /api/reminders/send`) remains the manual demonstration path.

### 3.7 Public verification

```bash
curl -s <DRIVE_WORKER_URL>/api/health/drive
curl -s <DONOR_WORKER_URL>/api/health/donor
curl -s <BOOKING_WORKER_URL>/api/health/booking
curl -s <PAGES_OR_WORKERS_SITE_URL>/
curl -s '<DRIVE_WORKER_URL>/api/drives?city=<CITY>'
```

Neon row counts (evidence for data layer):

```bash
psql "<NEON_DATABASE_URL>" -c 'SELECT count(*) FROM bdo_drives;'
psql "<NEON_DATABASE_URL>" -c 'SELECT id, status FROM bdo_bookings LIMIT 10;'
psql "<NEON_DATABASE_URL>" -c 'SELECT type, status, "to" FROM bdo_reminders ORDER BY scheduledFor DESC LIMIT 10;'
```

Wake Neon before a demo: free compute may pause after inactivity and the first request can be slow.

---

## 4. Evidence capture checklist

| Evidence | How to capture |
| --- | --- |
| Deployment URL works | Screenshot of the browser at `<PAGES_OR_WORKERS_SITE_URL>` (or Floci `<FLOCI_URL>/bdo-web/index.html`) showing `3/3 services online` in the footer |
| Cloud resources | `bash infra/check.sh` output, Floci dashboard screenshots, `aws_f ... list-*` output, or Cloudflare dashboard resource list |
| Schema | Neon SQL editor screenshot showing the nine tables or `psql -f` output |
| API requests/responses | Copy `curl -i` output or Postman request/response per endpoint; include status codes |
| Database rows | Neon SQL editor / SQLite query / DynamoDB console screenshots after create, update and delete |
| Logs | `npx wrangler tail`, CloudWatch Logs, or the `EMAIL_DEV_LOG` lines from `npm run dev` |
| Build version | `git tag v1.0`, zip from that tag, and the demo video recorded from that deployed version |
| Cloudflare approval | Screenshot of instructor reply confirming Cloudflare + Neon are allowed |
| Git ownership | Repository link, `git log` showing three authors, PR review comments, branch protection screenshot |

**Checklist status**

- [x] `infra/scripts/configure-cloudflare.js` exists; `npm run deploy:cloudflare` runs it.
- [x] Cloudflare Booking cron (`0 6 * * *`) and `scheduled()` handler are configured; Booking Lambda handles EventBridge `aws.events`.
- [x] Floci deployment completes with `ALL CHECKS PASSED`; local and Floci smoke are 22/22 each; `npm test` is 51/51.
- [ ] Repository initialisation, commits, branches, PRs, `v1.0` tag and code zip are still not done; CODEOWNERS retain placeholders until real GitHub usernames are known.
- [ ] Demo video, frontend browser screenshot, Cloudflare/Neon approval screenshot, real Cloudflare/Neon credentials and public URL are still not done.
- [ ] Real Turnstile/Brevo keys are not configured; no live email or bot-check evidence has been captured.
- [ ] Public Cloudflare deployment has not been executed; manual Nominatim evidence is not captured (`TEST_MODE` uses deterministic coordinates).
