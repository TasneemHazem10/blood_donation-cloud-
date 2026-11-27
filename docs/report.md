# Final Report — Blood Donation Drive Organizer (BloodLink)

**Status.** Sections 1–6, 9 and 10 describe code and results verified in this workspace on 25 Nov 2026. The public Cloudflare Workers + Neon deployment is live and included in section 6; the remaining items are the team's real per-student Git history/PRs (section 7) and a recorded demo video (section 8), which require real identities and a human-created artefact. Those are marked **PENDING** rather than claimed. The three mandatory individual statements are in [`docs/individual-statements.md`](individual-statements.md).

---

## 1. Problem definition

Blood drives are usually coordinated with spreadsheets and informal messages. Organizers cannot see real-time seat availability, donors have no reliable way to check whether they are eligible on a given date, and confirmation/reminder emails are sent manually. Duplicate bookings, overbooked slots and missed eligibility windows are common.

BloodLink is a web application that lets an organizer publish a drive with time slots, lets donors register with a health profile, checks eligibility before a seat is held, reserves seats atomically, records attendance and produces turnout reports.

**Target users**

* Organizer — creates/edits drives and slots, checks donors in, sends reminders and reads reports.
* Donor — registers, views eligibility, books and cancels a seat, views donation history.
* System administrator / examiner — observes deployed health and data through the public URL and cloud consoles.

**Expected benefit** — one consistent source of truth for drives, seats and bookings; automated eligibility and 56-day interval checks; auditable email log; measurable turnout.

**Scope boundary**

| In scope | Out of scope |
| --- | --- |
| Three communicating services (Drive, Donor/Eligibility, Booking/Reminder) | Real medical records, payments, mobile app |
| Seat reservation with no overbooking; cancel/check-in state machine | Full production identity verification or GDPR compliance |
| Nominatim geocoding, Turnstile bot check, Resend email (Brevo fallback) | Ambulance dispatch or hospital inventory integration |
| Local SQLite, Floci/AWS emulator and public Cloudflare Workers + Neon deployments | Guarantees of clinical accuracy; the eligibility rules are a class-project model |

---

## 2. Architecture diagram and cloud model

```mermaid
flowchart TB
  subgraph Presentation["Presentation layer"]
    UI[Vanilla JS SPA<br/>Cloudflare Pages / S3 website]
  end
  subgraph Application["Application layer - three independent services"]
    DRIVE[Drive API<br/>Express / Lambda / Worker]
    DONOR[Donor + Eligibility API<br/>Express / Lambda / Worker]
    BOOKING[Booking + Reminder API<br/>Express / Lambda / Worker]
  end
  subgraph Data["Data layer"]
    SQLITE[(SQLite<br/>local + tests)]
    DDB[(DynamoDB<br/>Floci)]
    NEON[(Neon Postgres<br/>Cloudflare)]
    S3[(S3<br/>report CSV + website)]
  end
  subgraph External["External services"]
    NOM[OpenStreetMap Nominatim]
    TURN[Cloudflare Turnstile]
    RESEND[Resend email API]
    CRON[Cron / EventBridge]
  end
  UI --> DRIVE & DONOR & BOOKING
  BOOKING -->|internal key| DRIVE
  BOOKING -->|internal key| DONOR
  DRIVE -->|report stats / cancel| BOOKING
  DONOR -->|active bookings| BOOKING
  DRIVE --> NOM
  DONOR --> TURN
  BOOKING --> RESEND
  CRON --> BOOKING
  DRIVE & DONOR & BOOKING --> SQLITE
  DRIVE & DONOR & BOOKING --> DDB
  DRIVE & DONOR & BOOKING --> NEON
  DRIVE --> S3
```

**Communication.** The browser calls three public REST APIs with a JWT issued by the Donor service. Service-to-service calls use a shared `x-internal-key`. All three runtimes (Node/Express, AWS Lambda, Cloudflare Worker) mount the *same* route tables and controllers; only the entry point and store driver change. See [`docs/architecture.md`](architecture.md).

**Cloud model and approach.** The design is **serverless/PaaS-first** with a small **container** deployment for the AWS emulator:

* Cloudflare Workers + Pages + Neon Postgres are managed serverless/PaaS: no server management, automatic scaling and a public URL with minimal operations. This suits a three-person class project with sporadic traffic.
* Floci runs LocalStack-style AWS services in Docker containers (DynamoDB, Lambda, API Gateway, S3, IAM, CloudWatch Logs, EventBridge) so the same application can demonstrate three separate AWS services per student without a real AWS bill.
* SQLite is the zero-setup local/test data layer.

---

## 3. Service/API list and data model

| Service | Owner | Three or more non-CRUD-only functions | Other services used |
| --- | --- | --- | --- |
| Drive Management | Habiba | validate/geocode and publish a drive; enforce slot overlap and capacity; build turnout reports from live booking stats; atomic seat reserve/release | Booking (stats, cancellations), Nominatim, S3 |
| Donor and Eligibility | Tasneem | hash passwords and issue JWTs; evaluate 18–65/≥50 kg/56-day/deferral rules; check Turnstile and login rate limit; block deletion when bookings are active | Booking (active bookings) |
| Booking and Reminder | Hala | reserve-then-insert booking with compensation; CAS cancel/check-in; idempotent reminder runs for button/cron/EventBridge; email audit log | Drive (lookup, reserve/release), Donor (eligibility, donations), Resend (Brevo fallback) |

Full endpoint tables, payloads, validation rules and status codes are in [`docs/api.md`](api.md) and [`docs/openapi.yaml`](openapi.yaml). Representative examples:

| Method and endpoint | Sends | Validates | Expected response |
| --- | --- | --- | --- |
| `POST /api/drives` | title, venue, city, date, description + JWT | field lengths, real date, organizer role | `201` drive with id/status/geocode; `400`/`401`/`403` |
| `POST /api/auth/register` | name, email, password, role, donor profile, optional Turnstile token | email, password 8–128, profile ranges, invite for organizers, bot check | `201` JWT + user; `400`/`401`/`409`/`429` |
| `POST /api/bookings` | driveId, slotId + donor JWT | id patterns, future scheduled drive, eligibility, seat availability, duplicate | `201` booking id `driveId__donorId`; `400`/`401`/`409`/`502` |
| `PATCH /api/bookings/:id/check-in` | outcome `attended`/`no_show` + organizer JWT | owner, status CAS, outcome enum | `200` with donation recorded on `attended`; `400`/`403`/`409` |
| `GET /internal/drives/:id/stats` | `x-internal-key` | internal key | `200` counts used by reports; `401` |
| `POST /internal/reminders/daily` | `x-internal-key` | internal key, date | `200` sent/skipped counts; `401` |

**Entities and relationships** (full ER diagram in [`docs/data-model.md`](data-model.md)):

```mermaid
erDiagram
  USERS ||--o| DONORS : "same email"
  DONORS ||--o{ DONATIONS : "donorId"
  DRIVES ||--|{ SLOTS : "driveId"
  DRIVES ||--o{ BOOKINGS : "driveId"
  DONORS ||--o{ BOOKINGS : "donorId"
  BOOKINGS ||--o{ REMINDERS : "bookingId"
  DRIVES ||--o{ REPORTS : "driveId"
  DRIVES ||--o{ GEOCODES : "cache"
```

Nine logical tables (`bdo_users`, `bdo_donors`, `bdo_donations`, `bdo_drives`, `bdo_slots`, `bdo_bookings`, `bdo_reminders`, `bdo_reports`, `bdo_geocodes`) are created in all three data drivers. Each service performs create, read, update, delete and search where appropriate; for example Booking searches by `donorId` and `driveId`, Drive searches slots by `driveId`, and Donor searches donations by `donorId`. The per-table CRUD/search matrix is in [`docs/data-model.md`](data-model.md) and in section 1 of each individual statement.

---

## 4. Methodology / technical solution

* **Languages/tools:** JavaScript (Node 22), npm workspaces, Express 5, `node:sqlite`, AWS SDK v3, esbuild/serverless-http, Cloudflare Wrangler, `@neondatabase/serverless`, Node's built-in test runner and Supertest.
* **Development process:** the repository is one npm workspace with `shared/` (router, validation, crypto, store interface, external clients) and three independent service folders. A change to a controller automatically reaches all three runtimes because each entry point mounts `services/<name>/routes.js`.
* **Integration:** the local `npm run dev` command starts the three APIs (3001/3002/3003) and the SPA (8090) against one SQLite file with WAL. Cross-service calls go through `shared/serviceClient.js`; tests replace it with deterministic stubs while the smoke flow uses real HTTP.
* **Testing approach:** unit tests on pure rules, API tests via Supertest, an integration test across real ports, a 22-step smoke flow that can target local or Floci, and the evidence capture script for live geocoding/rate-limit/Turnstile branches. Results are in section 9 and [`docs/testing.md`](testing.md).
* **Deployment:** `npm run zip:all` and `npm run workers:bundle` produce deployment artefacts; `infra/deploy-all.sh` creates the Floci resources and `npm run deploy:cloudflare` deploys Workers, secrets, schema and Pages. Neither script stores credentials in the repository.
* **Documentation:** [`README.md`](../README.md) is the manual setup guide; [`FULL_PROJECT_GUIDE.md`](../FULL_PROJECT_GUIDE.md) is the detailed implementation walkthrough.

---

## 5. External integration

| Integration | Used by / workflow | Why | Configuration |
| --- | --- | --- | --- |
| OpenStreetMap Nominatim | Drive creation geocodes `venue, city`; `GET /api/drives?near=&radius=` | Real coordinates, distance search and map labels | Public HTTPS endpoint with a descriptive `User-Agent`; results cached in `bdo_geocodes`; no key needed. Live evidence: `evidence/DRV-05-live-geocode.txt` |
| Cloudflare Turnstile | Donor registration/login | Bot protection before an account is created or a token is issued | `TURNSTILE_SITE_KEY` injected into the SPA config; `TURNSTILE_SECRET` sent only to the Worker via a secret (env/secret store on Lambda). `TEST_MODE=1` bypasses it locally; with a secret configured and no token the API returns `401` (`evidence/DON-16-turnstile-missing-token.txt`). Live PASS: free published dummy keys, browser token accepted by `siteverify` on register (201) and login (200) (`evidence/TURNSTILE-LIVE-VALIDATION.txt`) |
| Resend email API | Booking confirmations, cancellations and daily reminders | Real email delivery in production | `RESEND_API_KEY` (Brevo fallback: `BREVO_API_KEY`) and `EMAIL_FROM` as Worker secrets with `EMAIL_MODE=live`; without a key or with `EMAIL_MODE=log`, messages are written to the audit table and service log. Live evidence: `evidence/RESEND-LIVE-EMAIL.txt` |
| AWS S3 | Drive report CSV snapshots and the website bucket on Floci | Durable report artefacts and static hosting | `REPORTS_BUCKET` from Floci deployment state; path-style S3 client for the emulator |
| Neon Postgres + Cloudflare cron | Data layer and 06:00 daily reminder trigger on the public deployment | Managed serverless database and scheduled job | `DATABASE_URL` and Worker secrets; Cron Trigger declared in `services/booking/wrangler.toml`; a scheduled run was not separately captured. Manual Reminder button and `POST /internal/reminders/daily` verified. |

Every credential is read from an environment variable by `shared/config.js`; no secret appears in code, `frontend/js/config.js`, the repository or the evidence files. The Resend live-key run is verified. Turnstile is also verified live with Cloudflare's free published dummy keys; the browser token, the Worker secret and all JWTs are redacted from every tracked evidence file.

---

## 6. Deployment approach

**Verified — Floci / AWS emulator (service-based, containers).** The repo-owned `infra/floci/docker-compose.yml` starts `bdo-floci` from `floci/floci:latest-compat` with hybrid storage, the Docker socket and a persistent `floci-data` volume (`evidence/FLOCI-DOCKER.txt`). `npm run zip:all` creates three Lambda zips; `bash infra/deploy-all.sh` creates nine DynamoDB tables, three Lambdas (`bdo-drive-service`, `bdo-donor-service`, `bdo-booking-service`), two S3 buckets (`bdo-drive-reports`, `bdo-web`), IAM roles/policies, CloudWatch log groups and an EventBridge rule. API Gateway base URL: `http://079d67cedb.execute-api.localhost.floci.io:4566`. Website: `http://localhost:4566/bdo-web/index.html`. Health checks, drive list and 22/22 smoke steps passed with `ALL CHECKS PASSED` (re-verified 25 Nov 2026 in `evidence/FLOCI-SMOKE.txt`, report `storage:"s3"`). Resource details and screenshots checklist: [`docs/deployment.md`](deployment.md).

**Verified — public Cloudflare Workers + Neon (serverless/PaaS).** The deployed website is **https://bdo-organizer.bdo-organizer.workers.dev** and the three service URLs are `https://bdo-drive.bdo-organizer.workers.dev`, `https://bdo-donor.bdo-organizer.workers.dev` and `https://bdo-booking.bdo-organizer.workers.dev`. The SPA is served as Cloudflare Workers static assets; the supplied Neon database stores the nine JSONB tables. All three health endpoints return 200 with the correct CORS origin, the deployed `frontend/js/config.js` points to the public Workers, and `npm run smoke` returns **22/22 PASS** against the public deployment. Evidence: `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png`, `evidence/RESEND-LIVE-EMAIL.txt`.

All three Workers set `compatibility_flags = ["global_fetch_strictly_public"]` because Cloudflare otherwise returns `404 error code: 1042` when one Worker fetches another Worker's public `workers.dev` URL. Cross-service calls use Cloudflare service bindings (`env.BOOKING` in Drive; `env.DRIVE` and `env.DONOR` in Booking), which also avoids a `522` error from Worker-to-Worker public fetches on the preview account. Secrets (`DATABASE_URL`, `JWT_SECRET`, `INTERNAL_KEY`, invite, `RESEND_API_KEY`) were supplied only as Worker secrets from git-ignored files; the Booking Worker runs with `EMAIL_MODE=live`. The deployment uses the claimed permanent Cloudflare account. The 06:00 Cron Trigger is declared in `services/booking/wrangler.toml`; a scheduled run was not separately captured, so the manual Reminder button and internal daily route remain the verified path.

---

## 7. GitHub repository

**PARTIAL.** The repository is **https://github.com/TasneemHazem10/blood_donation-cloud-.git** and is public. The latest `main` and the three branches `feature/s1-drive`, `feature/s2-donor`, `feature/s3-booking` have been pushed to that remote. `main` contains the import commit plus documentation/evidence commits by Tasneem's configured identity (*not* a claim that she wrote every service). There are still **no pull requests/reviews or real per-student commits**. The `v1.0` tag and `bdo-organizer-v1.0.zip` were created from the current verified `main` state; they must be recreated after the authentic student history lands. The intended structure is:

* `main` — deployable state (branch protection still to be enabled); `feature/s1-*`, `feature/s2-*`, `feature/s3-*` — one branch per student; pull requests reviewed by another student; `v1.0` tag used for the submitted ZIP.
* `.github/CODEOWNERS` maps `services/drive/` to Habiba, `services/donor/` to Tasneem, `services/booking/` to Hala and shared folders to all three. The real GitHub handles must replace the placeholders before submission.
* Each student must commit their own service from their own Git identity; the code in this workspace is not evidence of authorship by itself.

To complete this section: make one real commit per student on their branch with their own Git identity, open and merge the three PRs, set the CODEOWNERS handles, fill the links below, then recreate `v1.0` and `bdo-organizer-v1.0.zip` from the final demonstrated commit. Step-by-step commands are in [`docs/git-workflow.md`](git-workflow.md). Repository URL: **https://github.com/TasneemHazem10/blood_donation-cloud-.git**. Insert the three PR/commit links here: **[PR_LINK_HABIBA]**, **[PR_LINK_TASNEEM]**, **[PR_LINK_HALA]**.

---

## 8. Demo video

**PENDING.** A ≤5-minute video must be recorded from the **public Cloudflare URL** (not localhost, not Floci), with the link set to "anyone with the link can view". Required order: full end-to-end journey first (organizer creates drive and slot → donor registers/books → reminder log → check-in → report), then one short segment per student showing their service's functions. The public URL to record is **https://bdo-organizer.bdo-organizer.workers.dev**. No video link was available at the time of writing; insert it here before submission: **[VIDEO_URL]**.

---

## 9. Testing

`npm test` → **59 tests, 59 pass, 0 fail** (seven test files). Local smoke → **22/22 PASS**. Floci smoke through API Gateway → **22/22 PASS**, report `storage:"s3"`. Public Cloudflare + Neon smoke → **22/22 PASS** with report `storage:"database"`. Evidence files: `evidence/NPM-TEST.txt`, `evidence/LOCAL-SMOKE.txt`, `evidence/DRV-05-live-geocode.txt`, `evidence/DON-14-rate-limit.txt`, `evidence/DON-16-turnstile-missing-token.txt`, `evidence/TURNSTILE-LIVE-VALIDATION.txt`, `evidence/TURNSTILE-LIVE-*.png`, `evidence/FLOCI-SMOKE.txt`, `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png`, `evidence/PUBLIC-E2E-CAPTURE.txt`, `evidence/LAB-07-CHECK.txt`, `evidence/LAB-08-CHECK.txt`, `evidence/LAB-08-K6.txt`, `evidence/RESEND-LIVE-EMAIL.txt`. Full case-by-case table with actual results and evidence links: [`docs/testing.md`](testing.md).

| Case group | Covered | Result |
| --- | --- | --- |
| DRV-01–DRV-13 (Habiba) | health, create, slots, filters, live `?near=`, report, 400/401/403/404/409 errors | 13/13 PASS |
| DON-01–DON-16 (Tasneem) | register, both roles, login, `me`, eligibility, profile, history, 400/401/403/409/429, Turnstile missing-token branch and live widget-token round trip | 16/16 PASS — live browser token accepted on register (201) and login (200) with free published dummy keys |
| BOK-01–BOK-19 (Hala) | book, list, cancel, check-in, reminders, internal routes, 400/401/403/409/502 | 19/19 PASS |
| E2E-01–E2E-06 | full journey, auth removal, drive cancellation, browser footer, reminders, public deployment | E2E-01–E2E-06 PASS. Local browser footer in `evidence/E2E-04-home.png`; public browser in `evidence/PUBLIC-E2E-*.png`; public 22/22 in `evidence/PUBLIC-SMOKE.txt` |

Invalid cases include missing fields, unknown ids, wrong owner/role, overlapping slots, full slots, duplicate bookings, ineligible donors, malformed outcomes/dates and missing internal keys. Response bodies use the common `error.code`/`error.message` envelope.

---

## 10. Limitations

Open items with reason and proposed improvement are tracked in [`docs/limitations.md`](limitations.md). The most important ones:

| Limitation | Reason | Proposed improvement |
| --- | --- | --- |
| Cloudflare Cron Trigger run was not separately captured | The trigger is declared and deployed, but no scheduled execution screenshot exists | Capture one scheduled run from Worker logs; the manual Reminder button is verified |
| Scheduled reminders depend on Cloudflare Cron Trigger timing | A scheduled run was not separately captured | Use the organizer Reminder button or `POST /internal/reminders/daily` for deterministic evidence |
| No PRs/reviews or real per-student commits (section 7); tag/ZIP exist but need recreating afterwards | Student GitHub handles/identities unknown | Add real per-student commits/PRs, then recreate `v1.0` and zip that tag |
| No demo video (section 8) | Must be created by a person | Record ≤5-minute walkthrough from the public URL |
| Public-URL browser evidence is a static screenshot, not an interactive recording | Headless Chrome captured the deployed home and drives pages; the video still has to show the journey | Record the demo video from the public URL |
| In-memory login rate limiter and in-process reminder state | Simplifies three-runtime compatibility | Add Cloudflare WAF rate limiting and a shared durable store |
| DynamoDB/Neon `search()` uses scan/filter rather than indexes | Document-model simplicity | Add GSIs/columns and pagination |
| Recovery window if the process crashes between reserve and insert | Compensating release cannot run after a hard crash | Make reservation idempotent with a TTL hold |
| Domain-bound production Turnstile widget not configured | Live validation used Cloudflare's free published dummy keys, not a domain-bound widget | Optional: create a free Turnstile widget in Cloudflare and replace the dummy site/secret keys; no payment is required |

---

## Appendix — Cloud Labs tool alignment

The lab PDFs were built around a different sample app (`cloud-issue-tracker`), so BDO keeps its own domain model but uses the same tools and deployment sequence. The complete command-by-command mapping is in [`docs/lab-guide.md`](lab-guide.md).

| Lab tool / step | BDO implementation |
|---|---|
| Docker Desktop, Git Bash, `floci` AWS CLI profile | `infra/floci/docker-compose.yml`, `infra/config.sh`, `infra/setup-all.sh` |
| Node.js, npm, Express, Postman Desktop, `.http` requests | `npm test`, `npm run dev`, `evidence/lab-04-postman-collection.json`, `docs/requests.http` |
| Lambda `nodejs24.x`, handler `lambda.handler` | `infra/scripts/zip-lambda.js`, `infra/services/*.sh`, three bundled `lambda.js` packages |
| DynamoDB, IAM, CloudWatch Logs, API Gateway, S3 | `infra/services/*.sh`, `infra/gateway.sh`, `infra/frontend.sh`, `infra/check-lab7.sh` |
| Vercel/Neon frontend deployment pattern | Live public deployment uses Cloudflare Workers + Neon because public Workers URLs are mandatory; `frontend/vercel.json` and `frontend/_headers` carry the lab-style security headers |
| k6 scale/security checks | `k6/bdo-load-test.js`, `k6/bdo-rps-capacity-test.js`, `infra/scale-test.sh`, `infra/check-lab8.sh` |

The BDO check scripts print BDO-specific pass/fail results and do not claim lab checkpoints for the sample app.

---

## Appendix — individual contribution statements

The three mandatory statements, each covering all nine required items (owned component/functions, frontend, backend/API, data operations, validation/errors, tests, integration, technical decisions, difficulties/fixes), are in [`docs/individual-statements.md`](individual-statements.md):

1. Habiba — Drive Management
2. Tasneem — Donor and Eligibility
3. Hala — Booking and Reminder
