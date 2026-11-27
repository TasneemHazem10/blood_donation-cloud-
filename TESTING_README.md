# Testing README — Blood Donation Drive Organizer

This is the start-to-finish testing playbook for the project. It tells you **what to run, where to run it, and what result is acceptable**. Every command uses the real APIs; there is no hard-coded frontend data.

> **Important scope note:** Floci/localhost checks are **lab evidence only**. The required public demonstration URL is the Cloudflare Workers + Neon deployment:
> Website `https://bdo-organizer.bdo-organizer.workers.dev`, APIs `https://bdo-drive.bdo-organizer.workers.dev`, `https://bdo-donor.bdo-organizer.workers.dev`, `https://bdo-booking.bdo-organizer.workers.dev`.

> **Secrets rule:** never paste a JWT, `JWT_SECRET`, `INTERNAL_KEY`, `ORGANIZER_INVITE`, `DATABASE_URL`, `RESEND_API_KEY`, `BREVO_API_KEY`, `TURNSTILE_SECRET`, Cloudflare claim URL or Neon connection string into this file, a test command output, evidence, screenshots or the report. Read them from environment variables or git-ignored files (`infra/secrets.env`, `.data/`, `.dev.vars`).

---

## 0. Pass/fail baseline already verified

| Check | Command | Expected result | Evidence |
|---|---|---|---|
| Unit/API tests | `npm test` | 59 tests, 59 pass, 0 fail | `evidence/NPM-TEST.txt` |
| Local full journey | `npm run smoke` with local stack running | `SMOKE: 22/22 PASS` | `evidence/LOCAL-SMOKE.txt` |
| Browser stale-render regression | `npm run browser:check` | `BROWSER RENDER REGRESSION: PASS`, 0 exceptions | `evidence/BROWSER-RENDER-REGRESSION.txt` |
| Floci/Lab 7 deployment | `bash infra/setup-all.sh`, `bash infra/setup-lab7.sh`, `bash infra/check-lab7.sh` | `13 passed, 0 failed` | `evidence/LAB-07-CHECK.txt`, `evidence/FLOCI-DOCKER.txt` |
| Floci full journey | `BDO_API_URL=<gateway URL> npm run smoke` | `SMOKE: 22/22 PASS`, `storage:"s3"` | `evidence/FLOCI-SMOKE.txt` |
| Lab 8 checks | `bash infra/check-lab8.sh` | `22 passed, 0 failed` | `evidence/LAB-08-CHECK.txt` |
| k6 load | `k6 run k6/bdo-load-test.js` | 600 checks passed, p(95) < 500 ms, failed rate 0.00% | `evidence/LAB-08-K6.txt` |
| Public Cloudflare/Neon | `npm run smoke` with three public `BDO_*_URL` values | `SMOKE: 22/22 PASS` | `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-DEPLOYMENT.txt` |
| Public browser | `npm run browser:check` with the default public URL | PASS; home/drives screens load from Workers | `evidence/PUBLIC-E2E-CAPTURE.txt`, `evidence/PUBLIC-E2E-*.png` |

A failed check is not acceptable until the cause is understood and the check is rerun. Do not edit evidence to hide a failure.

---

## 1. Tools and one-time setup

Required for most checks:

```bash
node --version          # 22 or newer
npm --version
git --version
```

Required for the lab/Floci path, run in **Git Bash** on Windows:

```bash
docker --version
aws --version
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
aws sts get-caller-identity --profile floci --query Account --output text   # 000000000000
```

Optional but used by the evidence in this repository:

- **Postman Desktop** — import `evidence/lab-04-postman-collection.json`.
- **VS Code REST Client** — open `docs/requests.http` and `docs/aws-api-tests.http`.
- **Chrome/Chromium** — required by `npm run browser:check`; set `CHROME_PATH` if it is not in the default location.
- **k6** — `k6 version`; on this machine it is `C:\Program Files\k6\k6.exe`.
- **Cloudflare/Neon login** — only needed if redeploying, not for testing the already-live URLs.

Install dependencies once from the repository root:

```bash
npm install
```

---

## 2. Local test run

### 2.1 Start the stack and create demo data

Keep this terminal running:

```powershell
npm run dev
```

It starts the SPA on **http://localhost:8090** and the three APIs on **3001/3002/3003** with `TEST_MODE=1` and `EMAIL_MODE=log`.

In a second terminal:

```powershell
curl.exe -i http://localhost:3001/api/health/drive
curl.exe -i http://localhost:3002/api/health/donor
curl.exe -i http://localhost:3003/api/health/booking
curl.exe -i http://localhost:8090/
npm run seed
```

Expected: four HTTP 200 responses; health bodies contain `{"status":"ok","service":"..."}`. The seed prints an organizer login, a donor login and a drive ID. Use the printed invite code for organizer registration (local default is `blood2026`).

### 2.2 Automated checks

```powershell
npm test
npm run smoke
npm run browser:check
```

Expected: `59 tests, 59 pass, 0 fail`, `SMOKE: 22/22 PASS`, and `BROWSER RENDER REGRESSION: PASS`.

The smoke script creates fresh accounts on every run, so repeats do not collide with the 56-day donation rule. It checks the full journey plus `400`, `401`, `403`, `404` and `409` cases and finishes with a report containing `booked:1`, `attended:1`, `turnoutRate:100`, `storage:"database"`.

### 2.3 Manual API journey (PowerShell)

Set shortcuts once per terminal session:

```powershell
$DRIVE   = 'http://localhost:3001'
$DONOR   = 'http://localhost:3002'
$BOOKING = 'http://localhost:3003'
$stamp   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString().Substring(7)
$orgMail = "org$stamp@demo.org"
$dnrMail = "donor$stamp@demo.org"
$password = 'DemoPass123!'
$date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
```

Register an organizer and a donor:

```powershell
$orgBody = @{name='Test Organizer';email=$orgMail;password=$password;role='organizer';inviteCode='blood2026'} | ConvertTo-Json -Compress
$org = curl.exe -s -X POST "$DONOR/api/auth/register" -H 'Content-Type: application/json' --data-raw $orgBody | ConvertFrom-Json
$orgToken = $org.token

$dnrBody = @{name='Test Donor';email=$dnrMail;password=$password;role='donor';bloodType='O+';weightKg=68;birthYear=1998} | ConvertTo-Json -Compress
$dnr = curl.exe -s -X POST "$DONOR/api/auth/register" -H 'Content-Type: application/json' --data-raw $dnrBody | ConvertFrom-Json
$donorToken = $dnr.token
```

Expected: `201` for both, each with a JWT. `GET $DONOR/api/auth/me` must not return `passwordHash`.

Drive service (Habiba):

```powershell
$driveBody = @{title='API Test Drive';venue='Kuwait City';city='Kuwait';date=$date;description='Created by curl'} | ConvertTo-Json -Compress
$drive = curl.exe -s -X POST "$DRIVE/api/drives" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $driveBody | ConvertFrom-Json
$slot = curl.exe -s -X POST "$DRIVE/api/drives/$($drive.id)/slots" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw '{"startTime":"09:00","endTime":"11:00","capacity":2}' | ConvertFrom-Json
curl.exe -s "$DRIVE/api/drives?city=kuwait&status=scheduled"
curl.exe -s "$DRIVE/api/drives?near=Kuwait%20City&radius=25"
```

Expected: drive `status:scheduled`, slot `booked:0`, drive present in both list responses; `near` result contains `distanceKm`.

Donor service (Tasneem):

```powershell
curl.exe -s "$DONOR/api/donors/me/eligibility?date=$date" -H "Authorization: Bearer $donorToken"
```

Expected: `eligible:true` for the 1998-born, 68 kg donor.

Booking service (Hala):

```powershell
$bookBody = @{driveId=$drive.id;slotId=$slot.id} | ConvertTo-Json -Compress
curl.exe -s -X POST "$BOOKING/api/bookings" -H 'Content-Type: application/json' -H "Authorization: Bearer $donorToken" --data-raw $bookBody
curl.exe -i -X POST "$BOOKING/api/bookings" -H 'Content-Type: application/json' -H "Authorization: Bearer $donorToken" --data-raw $bookBody
curl.exe -s "$BOOKING/api/bookings/mine" -H "Authorization: Bearer $donorToken"
curl.exe -s "$BOOKING/api/bookings?driveId=$($drive.id)" -H "Authorization: Bearer $orgToken"
```

Expected: first booking `201` with an id shaped `drv_...__donor@...`, second `409 CONFLICT`, both lists show one booking, and the slot now has `booked:1`.

Reminders, check-in, donation and report:

```powershell
$dateBody = @{date=$date} | ConvertTo-Json -Compress
curl.exe -s -X POST "$BOOKING/api/reminders/send" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $dateBody
curl.exe -s -X POST "$BOOKING/api/reminders/send" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $dateBody
curl.exe -s "$BOOKING/api/reminders" -H "Authorization: Bearer $orgToken"

$bookingId = "$($drive.id)__$dnrMail"
curl.exe -s -X PATCH "$BOOKING/api/bookings/$bookingId/check-in" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw '{"outcome":"attended"}'
curl.exe -s -X PATCH "$BOOKING/api/bookings/$bookingId/check-in" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw '{"outcome":"attended"}'
curl.exe -s "$DONOR/api/donors/me/donations" -H "Authorization: Bearer $donorToken"
curl.exe -s "$DRIVE/api/drives/$($drive.id)/report" -H "Authorization: Bearer $orgToken"
```

Expected: first reminder `sent:1, skipped:0`; second `sent:0, skipped:1` with a second reminder row and the same dedup key. First check-in `200`; repeat `200 "already recorded"` with **one** donation row. Report shows `booked:1, attended:1, turnoutRate:100`.

The complete copy-paste walkthrough, including cancel/delete guards, is in [`TESTING_STEPS.md`](TESTING_STEPS.md).

### 2.4 Browser UI check

1. Open **http://localhost:8090**; footer must show **3/3 services online**.
2. Log in as the organizer → **Organizer dashboard** → create a drive and two non-overlapping slots.
3. Open **Report** and **Emails**; generate a report and send a reminder twice.
4. Log out, log in as the donor → **Find a donation drive** → open the drive → **Book seat**.
5. **My bookings** shows the confirmed booking and a working **Cancel** button.
6. Organizer → **Bookings** tab → **Attended** / **No-show** buttons update the row.
7. Donor → **Profile** shows the eligibility banner, donation timeline and edit form.
8. Capture screenshots for the individual statements. Redact tokens before saving.

### 2.5 Error cases

All errors use the shared envelope `{"error":{"code":"...","message":"..."}}`.

| Test | How | Expected |
|---|---|---|
| Missing field | `POST /api/drives` with `{}` + organizer token | `400 VALIDATION_ERROR` |
| Malformed JSON | `POST /api/drives` with `{` | `400 VALIDATION_ERROR` |
| Body too large | Send a body over the server limit | `413 PAYLOAD_TOO_LARGE` |
| Unknown route/id | `GET /api/drives/drv_unknown` or `/api/does-not-exist` | `404 NOT_FOUND` |
| Wrong owner | Organizer B `PUT /api/drives/{id}` of Organizer A | `409 CONFLICT` |
| Overlap / full slot | second slot `09:30–10:30`; two donors for capacity 1 | `409 CONFLICT` |
| Ineligible donor | donor with `weightKg:40` books | `409` with eligibility reason |
| No token | `GET /api/donors/me` or `/api/bookings/mine` | `401 UNAUTHORIZED` |
| Wrong role | donor calls check-in | `403 FORBIDDEN` |
| Duplicate email | register the same email twice | `409 CONFLICT` |
| Wrong password | login with a bad password | `401 UNAUTHORIZED` |
| Bad outcome | check-in `{"outcome":"maybe"}` | `400 VALIDATION_ERROR` |
| Missing internal key | `GET /internal/drives/{id}/stats` without `x-internal-key` | `401 UNAUTHORIZED` |
| Rate limit | 9 failed logins from one IP in 10 minutes | 8×`401`, 9th `429 RATE_LIMIT` |
| Turnstile missing token | with a Turnstile secret configured, register without a token | `401` bot-check message |
| Upstream dependency | stop a dependent API during an internal call | `502 UPSTREAM_ERROR` |

The rate-limit and Turnstile missing-token branches are already captured in `evidence/DON-14-rate-limit.txt` and `evidence/DON-16-turnstile-missing-token.txt`; regenerate them with `npm run evidence:capture`. A real Turnstile widget token has **not** been exercised.

---

## 3. Postman Desktop and REST Client

1. Start the local stack (`npm run dev`) or deploy Floci (section 5).
2. Import `evidence/lab-04-postman-collection.json` into **Postman Desktop**.
3. Set the collection variable `baseUrl` to `http://localhost:3001`, `3002`, `3003` or the Floci API Gateway URL.
4. Run T01–T08: health, list, validation error, unknown route, CORS, malformed JSON, donor validation and auth protection.
5. Open `docs/requests.http` for local Express requests and `docs/aws-api-tests.http` for Floci API Gateway requests in VS Code REST Client; use **Send Request** after replacing `REPLACE_WITH_ORGANIZER_TOKEN` with a token obtained from login.
6. Save one request and one response per endpoint as `evidence/<TEST-ID>-request.txt` / `-response.txt`. Redact JWTs and secrets.

The full endpoint contract is in [`docs/api.md`](docs/api.md) and [`docs/openapi.yaml`](docs/openapi.yaml).

---

## 4. Database verification

### SQLite (local/tests)

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('.data/bdo.sqlite');for(const t of ['bdo_users','bdo_donors','bdo_drives','bdo_slots','bdo_bookings','bdo_reminders','bdo_donations','bdo_reports','bdo_geocodes']){console.log('\n'+t, db.prepare('select count(*) c from '+t).get().c);console.log(db.prepare('select data from '+t+' limit 1').all())}"
```

Check that a booking changed from `confirmed` to `attended`, exactly one donation row exists, a reminder row exists per send attempt, and `bdo_geocodes` contains live Nominatim rows.

### DynamoDB (Floci)

```bash
aws --profile floci dynamodb list-tables --query TableNames --output table
aws --profile floci dynamodb scan --table-name bdo_bookings --output json
```

Use the Floci dashboard at `http://localhost:4566/_floci/ui` for screenshots. Tables are `bdo_users`, `bdo_donors`, `bdo_drives`, `bdo_slots`, `bdo_bookings`, `bdo_reminders`, `bdo_donations`, `bdo_reports`, `bdo_geocodes`.

### Neon Postgres (public)

Open the Neon SQL editor for the project used by the Workers. Confirm the nine `bdo_*` tables from `infra/db/schema.sql` exist and query rows created by the public smoke run, for example:

```sql
SELECT 'bookings' AS entity, count(*) FROM bdo_bookings
UNION ALL SELECT 'donations', count(*) FROM bdo_donations
UNION ALL SELECT 'reports', count(*) FROM bdo_reports;
```

Screenshot the result and redact any connection string or account identifier. The public database URL is a Worker secret, not a repository value.

---

## 5. Floci / Cloud Labs flow (Git Bash)

This is lab evidence, not the public demonstration URL.

```bash
# One-time resources, Lambdas, API Gateway, DynamoDB, IAM, S3, CloudWatch
bash infra/setup-all.sh
bash infra/setup-lab7.sh
bash infra/check-lab7.sh | tee evidence/LAB-07-CHECK.txt

# Restore the generated API URL into the current shell, then run the full journey
bash infra/lab7-vars.sh          # prints export API_ID=... and export API_URL=...
source infra/lab7-vars.sh
BDO_API_URL="$API_URL" npm run smoke
```

Expected: `13 passed, 0 failed` for Lab 7 and `SMOKE: 22/22 PASS` with `storage:"s3"` through the API Gateway. Lambdas are bundled as `lambda.handler` on `nodejs24.x`; verify with:

```bash
aws --profile floci lambda get-function --function-name bdo-drive-service \
  --query 'Configuration.[Runtime,Handler]' --output text
```

Lab 8 scaling, security and load:

```bash
bash infra/run-floci.sh
bash infra/run-floci.sh status
bash infra/reset-data.sh
bash infra/scale-test.sh vertical
bash infra/scale-test.sh horizontal 3
bash infra/scale-test.sh status
bash infra/scale-test.sh kill 2
bash infra/scale-test.sh load
bash infra/scale-test.sh stop
bash infra/check-lab8.sh | tee evidence/LAB-08-CHECK.txt
```

k6 directly:

```bash
K6_BASE_URL=http://localhost:3001 "/c/Program Files/k6/k6.exe" run k6/bdo-load-test.js
```

Thresholds: `p(95) < 500 ms` and `http_req_failed < 5%`. The recorded run is `evidence/LAB-08-K6.txt`. The full lab tool mapping is in [`docs/lab-guide.md`](docs/lab-guide.md).

---

## 6. Public Cloudflare Workers + Neon checks

Use these URLs; the API roots intentionally return `404`, so always call `/api/health/<service>`:

```powershell
curl.exe -i https://bdo-organizer.bdo-organizer.workers.dev
curl.exe -i https://bdo-drive.bdo-organizer.workers.dev/api/health/drive
curl.exe -i https://bdo-donor.bdo-organizer.workers.dev/api/health/donor
curl.exe -i https://bdo-booking.bdo-organizer.workers.dev/api/health/booking
```

Expected: website 200; all three health endpoints 200 with `Access-Control-Allow-Origin: https://bdo-organizer.bdo-organizer.workers.dev`.

Full public journey:

```powershell
$env:BDO_API_URL = ''
$env:BDO_DRIVE_URL = 'https://bdo-drive.bdo-organizer.workers.dev'
$env:BDO_DONOR_URL = 'https://bdo-donor.bdo-organizer.workers.dev'
$env:BDO_BOOKING_URL = 'https://bdo-booking.bdo-organizer.workers.dev'
$env:ORGANIZER_INVITE = '<organizer invite used by the deployed Worker>'
npm run smoke
```

Expected: `SMOKE: 22/22 PASS`. The invite is a Worker secret; if it is already in a git-ignored local env file, the smoke script can read it there instead of an environment variable. Do not print it.

Public browser checks:

```powershell
npm run browser:check
```

By default this targets the public website and overwrites `evidence/BROWSER-RENDER-REGRESSION.txt`. To test a different URL without confusing the public evidence, set `BDO_TEST_URL` explicitly, for example `$env:BDO_TEST_URL='http://localhost:8090/#/'`.

Also repeat the manual journey from section 2 in the browser at the public website, check from a phone, and take home/drives screenshots. Hard-refresh (Ctrl+F5) after a frontend deployment to avoid cached JavaScript. The permanent deployment details are in [`FINALIZATION_README.md`](FINALIZATION_README.md) section 3.

Redeploy is only needed if you change code or secrets:

```powershell
npx wrangler login
npm run workers:bundle
npm run deploy:cloudflare
```

Never commit `.dev.vars`, `.env`, `infra/secrets.env` or `.data/`.

---

## 7. Regenerating committed evidence

Run from the repository root. These commands write the same filenames used by the report.

```powershell
npm test 2>&1 | Tee-Object -FilePath evidence/NPM-TEST.txt
npm run smoke 2>&1 | Tee-Object -FilePath evidence/LOCAL-SMOKE.txt
npm run evidence:capture
npm run browser:check
```

For public smoke, set the four environment variables from section 6 first, then:

```powershell
npm run smoke 2>&1 | Tee-Object -FilePath evidence/PUBLIC-SMOKE.txt
```

In Git Bash for the lab checks:

```bash
bash infra/check-lab7.sh | tee evidence/LAB-07-CHECK.txt
bash infra/check-lab8.sh | tee evidence/LAB-08-CHECK.txt
K6_BASE_URL=http://localhost:3001 "/c/Program Files/k6/k6.exe" run k6/bdo-load-test.js | tee evidence/LAB-08-K6.txt
```

`npm run browser:check` writes its own evidence file. Public screenshots are captured by the git-ignored helper described in `evidence/PUBLIC-E2E-CAPTURE.txt`; if you do not have that helper, capture the same screens manually. Do not invent a result that you did not observe.

---

## 8. Release verification

After the final documentation commit is on `main`:

```bash
git status --short --branch
git log -1 --oneline
git cat-file -t v1.0                 # tag
git ls-remote --tags origin v1.0
git archive --format=zip --output=bdo-organizer-v1.0.zip v1.0
```

Check the archive contains no secrets or build output. In PowerShell:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path bdo-organizer-v1.0.zip))
$names = $zip.Entries.FullName
"entries: $($names.Count)"
$bad = $names | Where-Object { $_ -match '(^|/)(\.data|dist|node_modules|\.git)/|(^|/)(\.env|\.dev\.vars|secrets\.env)$' }
"disallowed: $(@($bad).Count)"
$zip.Dispose()
```

Expected: `disallowed: 0`. The recorded entry count is in `evidence/RELEASE.txt`.

---

## 9. Known pending tests (do not claim as PASS)

| Item | Reality |
|---|---|
| Live Turnstile widget token | Only the missing-token branch is exercised and evidenced. |
| Cron Trigger scheduled run | Declared (`0 6 * * *`) and the manual/reminder route is tested; a scheduled firing was not separately captured. |
| Demo video ≤5 minutes | Human-created artefact from the public URL; link still `[VIDEO_URL]` in the report. |
| Per-student PRs/reviews and real identities | Cannot be fabricated; see [`FINALIZATION_README.md`](FINALIZATION_README.md) section 2 and `.github/CODEOWNERS`. |
| Instructor Cloudflare/Neon approval screenshot | Not available in this workspace. |

---

## 10. Documentation links

- [`README.md`](README.md) — project overview, requirements map, labels and live URLs
- [`TESTING_STEPS.md`](TESTING_STEPS.md) — full PowerShell request/response walkthrough
- [`docs/testing.md`](docs/testing.md) — test case table and evidence checklist
- [`docs/lab-guide.md`](docs/lab-guide.md) — Cloud Labs tool-by-tool mapping
- [`docs/minimum-requirements.md`](docs/minimum-requirements.md) — per-student audit of the minimum brief
- [`docs/report.md`](docs/report.md) — sections 1–10 of the final report
- [`docs/individual-statements.md`](docs/individual-statements.md) — three contribution statements
- [`FINALIZATION_README.md`](FINALIZATION_README.md) — hand-over checklist and pending human artefacts
- [`evidence/RELEASE.txt`](evidence/RELEASE.txt) — final tag/ZIP/release evidence
