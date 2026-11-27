# Blood Donation Drive Organizer

A complete three-service cloud application for organizing blood donation drives. Organizers publish drives and time slots, donors register and book a seat, and the Booking service checks eligibility, reserves seats atomically, records attendance and sends confirmations/reminders.

This README is the **project overview, requirements map and deployment guide**. A deeper implementation walkthrough is in [`FULL_PROJECT_GUIDE.md`](FULL_PROJECT_GUIDE.md). Report material is in [`docs/`](docs/), including the per-student minimum-requirements audit in [`docs/minimum-requirements.md`](docs/minimum-requirements.md). The hand-over checklist for the remaining human artefacts (student Git identities/PRs and the demo video) is in [`FINALIZATION_README.md`](FINALIZATION_README.md). The dedicated, start-to-finish testing playbook is [`TESTING_README.md`](TESTING_README.md); the longer PowerShell walkthrough is [`TESTING_STEPS.md`](TESTING_STEPS.md). To repeat the work with the same tools and command order as the Cloud Labs PDFs (Docker/Git Bash/AWS CLI `floci` profile/Postman/REST Client/k6/Vercel-style headers/Neon), use [`docs/lab-guide.md`](docs/lab-guide.md).

---

## Implementation against the brief

This table states **what was actually built**, where it lives, and how it was verified. Nothing is marked DONE unless a file or live endpoint exists.

| Requirement | What was made | Where / how to verify | Status |
|---|---|---|---|
| Three coherent, student-owned services | Drive Management, Donor/Eligibility and Booking/Reminder, each with its own routes, controllers, rules, tests, Lambda, Worker and lab script | `services/drive/`, `services/donor/`, `services/booking/`; ownership in `.github/CODEOWNERS` and `docs/individual-statements.md` | DONE (code); real per-student commits/PRs still PENDING |
| More than CRUD per service | Geocoding, slot overlap/capacity, live report from booking stats, eligibility rules, 56-day recheck, atomic booking/cancel/check-in, idempotent reminders | `services/*/controllers/`, `services/*/services/`, `docs/report.md` §3 | DONE |
| Cross-service calls | Drive → Booking (stats/cancellations); Booking → Drive (lookup/reserve/release) and Donor (eligibility/donations); Donor → Booking (active bookings) with `x-internal-key`; Cloudflare service bindings in production | `shared/serviceClient.js`, `services/*/wrangler.toml`, `docs/architecture.md` | DONE |
| Validation, correct status codes, shared error envelope | Common 400/401/403/404/409/413/429/502 envelope, malformed JWT and URL handling, body-size limits | `shared/http.js`, `shared/validation.js`, `tests/runtime-robustness.test.js`, `docs/api.md` | DONE |
| Database CRUD/search in all three services | Nine `bdo_*` entities with create/read/update/delete/search; SQLite for local/tests, DynamoDB for Floci, Neon Postgres JSONB for public | `shared/store/`, `infra/db/schema.sql`, `docs/data-model.md` | DONE |
| Real external APIs | Nominatim geocoding + `?near=` radius search, Cloudflare Turnstile branch, Resend email (Brevo fallback), S3 report snapshots, Cron/EventBridge reminders | `shared/external.js`, `services/*/services/`, `evidence/DRV-05-live-geocode.txt`, `evidence/RESEND-LIVE-EMAIL.txt` | DONE; live Turnstile widget token PENDING |
| Public Cloudflare Workers + Neon URLs (mandatory) | Static SPA + three Workers + Neon database, permanent account, health/CORS verified | Live URLs in §6; `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-*.png` | DONE |
| Floci/localhost as lab evidence only | Docker Compose Floci, DynamoDB, three Lambdas (`nodejs24.x`, `lambda.handler`), API Gateway, S3, IAM, CloudWatch, EventBridge | `infra/floci/`, `infra/setup-all.sh`, `infra/deploy-all.sh`, `evidence/FLOCI-DOCKER.txt`, `evidence/FLOCI-SMOKE.txt` | DONE |
| Lab tool flow | Git Bash scripts, AWS CLI `floci` profile, Postman collection, `.http` files, k6, Vercel/Cloudflare headers | `docs/lab-guide.md`, `evidence/lab-04-postman-collection.json`, `docs/requests.http`, `k6/`, `frontend/vercel.json`, `frontend/_headers` | DONE |
| Browser robustness | Render-generation guard prevents an old async view from overwriting a newer screen with `Cannot set properties of null (setting 'innerHTML')` | `frontend/js/app.js`, `frontend/js/ui.js`, `frontend/js/views/`, `npm run browser:check`, `evidence/BROWSER-RENDER-REGRESSION.txt` | DONE |
| Report sections 1–10, three nine-item statements, evidence | Full draft report, individual statements, test table and evidence index | `docs/report.md`, `docs/individual-statements.md`, `docs/testing.md`, `evidence/` | DONE with truthful placeholders |
| `v1.0` tag and source ZIP | Annotated tag and `bdo-organizer-v1.0.zip` regenerated from the final `main` commit | `git ls-remote --tags origin v1.0`, `evidence/RELEASE.txt` | DONE |
| Demo video ≤5 minutes with viewable URL | Not fabricated here; recording instructions and the public URL are provided | `FINALIZATION_README.md` §4, `docs/report.md` §8 | PENDING — human-created artefact |
| Secrets hygiene | Secrets only from env/git-ignored files; no token, JWT, invite or connection string in tracked docs/evidence | `.gitignore`, `infra/secrets.env.example`, `evidence/RELEASE.txt` | DONE |

## Cloud Labs mapping

The lab PDFs use `cloud-issue-tracker`; this repository uses the required Blood Donation Drive Organizer. The tools, order, file names and evidence shape are preserved. Full commands are in [`docs/lab-guide.md`](docs/lab-guide.md).

| Lab stage | Lab tool / checkpoint | BDO implementation and command | Evidence |
|---|---|---|---|
| 1–2 | Git Bash, Node 22, npm workspace | `npm install`, `npm test`, `npm run dev`, `npm run browser:check` | `evidence/NPM-TEST.txt`, `evidence/LOCAL-SMOKE.txt`, `evidence/BROWSER-RENDER-REGRESSION.txt` |
| 3 | REST design, data services, ER model | `docs/api.md`, `docs/openapi.yaml`, `docs/data-model.md`, nine tables in every store | `docs/report.md` §3 |
| 4 | Express + Postman Desktop + REST Client | `evidence/lab-04-postman-collection.json`, `docs/requests.http`, `docs/aws-api-tests.http` | `evidence/lab-04-postman-collection.json` |
| 5 | Frontend, Vercel/Cloudflare headers, Neon | `frontend/vercel.json`, `frontend/_headers`, `npm run deploy:cloudflare`, `infra/db/schema.sql` | `evidence/PUBLIC-DEPLOYMENT.txt` |
| 6/7 | Docker, Floci, DynamoDB, IAM, Lambda, API Gateway, S3, CloudWatch | `bash infra/setup-all.sh`, `bash infra/setup-lab7.sh`, `bash infra/check-lab7.sh`; handlers are `lambda.handler` on `nodejs24.x` | `evidence/FLOCI-DOCKER.txt`, `evidence/FLOCI-SMOKE.txt`, `evidence/LAB-07-CHECK.txt` |
| 8 | Scale, secure, observe, k6 | `bash infra/run-floci.sh`, `bash infra/scale-test.sh`, `bash infra/check-lab8.sh`, `k6/bdo-load-test.js` | `evidence/LAB-08-K6.txt`, `evidence/LAB-08-CHECK.txt` |
| Final | Public URL, report, ZIP, video | Cloudflare Workers + Neon; `docs/report.md`; `v1.0`; ZIP | `evidence/PUBLIC-SMOKE.txt`, `evidence/RELEASE.txt`; video still PENDING |

---

## 1. What is included

| Layer | What runs | Local address |
|---|---|---|
| Presentation | Vanilla JS single-page app | http://localhost:8090 |
| Application | Drive API (Express) | http://localhost:3001 |
| Application | Donor / Auth / Eligibility API | http://localhost:3002 |
| Application | Booking / Reminder API | http://localhost:3003 |
| Data | SQLite (local), DynamoDB (Floci/AWS), Neon Postgres (Cloudflare) | — |

The same controllers run in all environments. Only the entry point and data driver change.

Student ownership:

- **Habiba** – Drive Management (`services/drive/`)
- **Tasneem** – Donor and Eligibility (`services/donor/`)
- **Hala** – Booking and Reminder (`services/booking/`)

---

## 2. Prerequisites

- Node.js 22 or newer (`node --version`)
- npm
- Docker Desktop (only for Floci)
- AWS CLI (only for Floci)
- Git Bash on Windows for the `infra/*.sh` scripts
- A Cloudflare account and a Neon account (only for the public deployment)

No API keys or passwords are stored in the repository. Copy `.env.example` or `infra/secrets.env.example` and fill values locally.

---

## 3. Run the whole app locally

```bash
npm install
npm run dev
```

Open **http://localhost:8090**.

The `npm run dev` command starts all three APIs, the static website and a shared SQLite database with WAL enabled. It uses `TEST_MODE=1` and `EMAIL_MODE=log`, so external calls are deterministic and emails are printed to the service logs instead of being sent.

Create demo data through the real APIs:

```bash
npm run seed
```

The seed prints an organizer login, a donor login and a drive ID. Use those credentials in the website. The organizer invite code defaults to `blood2026`.

Quick health check:

```bash
curl http://localhost:3001/api/health/drive
curl http://localhost:3002/api/health/donor
curl http://localhost:3003/api/health/booking
curl http://localhost:8090/
```

All four should return HTTP 200.

### Manual end-to-end scenario

1. Log in as the seeded organizer.
2. Open **Organizer dashboard → New drive**, publish a future drive, then add a time slot.
3. Log out and log in as the seeded donor.
4. Open **Find a donation drive**, select the drive, click **Book seat**.
5. Open **My bookings** to see the confirmed booking.
6. Log back in as the organizer, open **Organizer dashboard → Bookings**, mark the donor **Attended**.
7. Open **Report** and generate the turnout report.
8. Open **Emails** and send a reminder; send it again to see the duplicate-skip counter.

---

## 4. Tests

```bash
npm test
```

The suite uses Node's built-in test runner and Supertest (59 tests, 59 pass). It covers business rules, every service API, validation/error codes and a full cross-service journey. With `npm run dev` running, `npm run browser:check` uses headless Chrome to verify that a slow API response cannot overwrite a newer screen. To regenerate request/response evidence for live geocoding, the login rate limit and the Turnstile missing-token branch, run `npm run evidence:capture`; the files are written to `evidence/`. See [`docs/testing.md`](docs/testing.md) for the report table and evidence checklist.

Useful API examples:

```bash
# Register a donor (TEST_MODE skips Turnstile locally)
curl -X POST http://localhost:3002/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Donor","email":"test@demo.org","password":"DemoPass123!","role":"donor","bloodType":"O+","weightKg":68,"birthYear":1998}'

# List drives with filters
curl 'http://localhost:3001/api/drives?city=kuwait&status=scheduled'

# Book a slot (use the token returned by register/login and IDs from the drive)
curl -X POST http://localhost:3003/api/bookings \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' \
  -d '{"driveId":"DRIVE_ID","slotId":"SLOT_ID"}'
```

---

## 5. Deployment option A — Floci / AWS emulator

This path demonstrates containers/serverless AWS services locally: DynamoDB, Lambda, API Gateway, S3, IAM, CloudWatch Logs and EventBridge. Habiba leads this deployment; Hala supports it.

```bash
# 1. Start Floci
docker compose -f infra/floci/docker-compose.yml up -d

# 2. Build Lambda and Worker packages
npm run zip:all
npm run workers:bundle

# 3. Create all AWS resources, deploy code and check
bash infra/deploy-all.sh
```

`bash infra/check.sh` prints PASS/FAIL for all three health endpoints, the drive list, the website and the AWS resources. The API URL and IDs are stored in `infra/.state` (git-ignored). Generated secrets are stored in `infra/secrets.env` (git-ignored).

To remove the Floci resources:

```bash
bash infra/destroy.sh
```

Each student's service script is separate:

```bash
bash infra/services/drive.sh    # Habiba: DynamoDB + S3 + IAM + Lambda + CloudWatch
bash infra/services/donor.sh    # Tasneem: DynamoDB + IAM + Lambda + CloudWatch
bash infra/services/booking.sh  # Hala: DynamoDB + IAM + Lambda + CloudWatch + EventBridge
```

See [`docs/deployment.md`](docs/deployment.md) for screenshots to capture and the full resource list.

---

## 6. Deployment option B — Cloudflare Workers + Neon (public URL)

This is the public deployment required by the final-phase plan. It uses three Cloudflare Workers, a Cloudflare Workers static-asset site for the SPA, and Neon Postgres. Resend live email is configured for the public Booking Worker; Turnstile keys remain optional.

### Live public deployment (verified 25 Nov 2026)

| Component | Public URL |
|---|---|
| Website | **https://bdo-organizer.bdo-organizer.workers.dev** |
| Drive API | https://bdo-drive.bdo-organizer.workers.dev |
| Donor/Eligibility API | https://bdo-donor.bdo-organizer.workers.dev |
| Booking/Reminder API | https://bdo-booking.bdo-organizer.workers.dev |

The supplied Neon database has `infra/db/schema.sql` applied. All three health endpoints return 200 with the website origin in `Access-Control-Allow-Origin`, the deployed `frontend/js/config.js` points at the three public Worker URLs, and `npm run smoke` passes **22/22** against the public deployment. Evidence: `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png`.

The three `services/*/wrangler.toml` files set `compatibility_flags = ["global_fetch_strictly_public"]`. Without it Cloudflare returns error `1042` when one Worker calls another through a public `workers.dev` URL. Cross-service calls now use Cloudflare service bindings (`env.BOOKING` in Drive; `env.DRIVE` and `env.DONOR` in Booking), which also avoids a `522` from Worker-to-Worker public fetches on the preview account.

This deployment uses the **claimed permanent Cloudflare account** via `wrangler login`; no claim token is stored in the repository. The `0 6 * * *` trigger is declared in `services/booking/wrangler.toml`; a scheduled run was not separately captured, so the organizer Reminder button and `POST /internal/reminders/daily` were verified instead. Turnstile remains unconfigured; Resend live email is enabled with `EMAIL_MODE=live` and a git-ignored API key.

### One-time manual setup

1. Log in: `npx wrangler login`.
2. Create a Neon project and copy its connection string.
3. Apply the schema from `infra/db/schema.sql` in the Neon SQL editor (the deploy script also applies it).
4. Create a Turnstile widget if you want real bot protection. Resend live email is already configured for the public deployment; leave the key empty locally to stay in log mode.
5. Decide the three Worker names and their public URLs, e.g. `https://bdo-drive.<account>.workers.dev`.

### Deploy

```bash
export DATABASE_URL='postgresql://...'
export JWT_SECRET='a-long-random-string'
export INTERNAL_KEY='another-long-random-string'
export ORGANIZER_INVITE='your-invite-code'
export DRIVE_WORKER_URL='https://bdo-drive.<account>.workers.dev'
export DONOR_WORKER_URL='https://bdo-donor.<account>.workers.dev'
export BOOKING_WORKER_URL='https://bdo-booking.<account>.workers.dev'
export FRONTEND_URL='https://bdo-organizer.<account>.workers.dev'   # optional; detected after deploy
export TURNSTILE_SECRET=''                              # optional
export TURNSTILE_SITE_KEY=''                            # optional, public site key
export RESEND_API_KEY=''                                 # optional locally; set in Worker secrets for live email
export EMAIL_FROM='Blood Donation Drive <onboarding@resend.dev>'
export EMAIL_MODE='log'                                  # use 'live' only with a real key

npm run deploy:cloudflare
```

The script bundles the Workers, applies the Neon schema, sets secrets with `wrangler secret put`, deploys the three Workers, rewrites `frontend/js/config.js` with the public service URLs, deploys the static site to Cloudflare Pages, and verifies all three health endpoints. Deployed URLs are saved to `.data/cloudflare-urls.json`.

On Windows PowerShell, use `$env:NAME='value'` instead of `export NAME='value'`.

Verify manually in a browser and from a phone:

```text
https://bdo-organizer.bdo-organizer.workers.dev
https://bdo-drive.bdo-organizer.workers.dev/api/health/drive
https://bdo-donor.bdo-organizer.workers.dev/api/health/donor
https://bdo-booking.bdo-organizer.workers.dev/api/health/booking
```

Never commit `.dev.vars`, `.env`, `infra/secrets.env` or real credentials.

---

## 7. Repository, ownership and evidence

The team repository is **https://github.com/TasneemHazem10/blood_donation-cloud-.git** and is public (`main`, the three feature branches, `v1.0` and `bdo-organizer-v1.0.zip` are pushed/created). Suggested branching strategy:

- `main` is protected and always deployable.
- Each student works on `feature/s1-*`, `feature/s2-*` or `feature/s3-*` and opens a PR reviewed by another student.
- Shared folders (`frontend/`, `shared/`, `infra/`, `tests/`) require review from all three owners. See `.github/CODEOWNERS`.
- Replace the placeholder GitHub handles in `.github/CODEOWNERS` with real usernames.

Each student must make real commits to their own service. The generated code is complete, but commit history cannot be faked; the students should commit their own work from their own Git identities.

Evidence to collect for the report:

- Floci deployment + smoke evidence is in `evidence/FLOCI-SMOKE.txt`; public health/config/database evidence is in `evidence/PUBLIC-DEPLOYMENT.txt` and `evidence/PUBLIC-SMOKE.txt`; public browser screenshots are `evidence/PUBLIC-E2E-home.png` and `evidence/PUBLIC-E2E-drives.png`, with capture details in `evidence/PUBLIC-E2E-CAPTURE.txt`. Live Resend delivery evidence is in `evidence/RESEND-LIVE-EMAIL.txt`. Local browser evidence is in `evidence/E2E-04-home.png` and `evidence/E2E-04-drives.png` (headless Chrome at `http://localhost:8090`).
- Postman or `curl` request/response pairs for each endpoint.
- Neon SQL editor screenshots after create/update/delete.
- `npm test` output (`evidence/NPM-TEST.txt`) and local smoke output (`evidence/LOCAL-SMOKE.txt`), plus rows in [`docs/testing.md`](docs/testing.md).
- GitHub PR/merge/commit links for each student.
- A demo video of ≤5 minutes recorded from the **public cloud URL**, starting with the full end-to-end journey, then one segment per student. Make the link viewable by anyone.

ZIP the exact version that was demonstrated:

```bash
git tag v1.0
git archive --format=zip --output=bdo-organizer-v1.0.zip v1.0
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Port 8080 already in use | The project intentionally uses **8090**; do not change it back. |
| `database is locked` | SQLite is now opened with WAL + a 5s busy timeout. Restart `npm run dev`. |
| 401 on an internal endpoint | Send `x-internal-key` with the value from `INTERNAL_KEY`. |
| 403 on organizer endpoints | Register with `role: 'organizer'` and the correct invite code. |
| Worker returns 500 after deployment | Check `npx wrangler tail <worker-name>`; usually a missing Worker secret (`DATABASE_URL`, `JWT_SECRET`, `INTERNAL_KEY`). |
| Cross-service call returns `404 error code: 1042` on Workers | Add `compatibility_flags = ["global_fetch_strictly_public"]` to the calling Worker's `wrangler.toml` and redeploy. This is already set on all three services. |
| Cross-service call returns `522` on a preview account | Use Cloudflare service bindings instead of public `workers.dev` fetches. Drive binds `BOOKING`; Booking binds `DRIVE` and `DONOR`. This is already configured. |
| Cron Trigger timing was not captured | The trigger is declared and the account is permanent; use the manual Reminder button for deterministic evidence. |
| Neon first request is slow | Free compute wakes from pause; open the app once before the demo. |
| Reminder emails do not arrive | Without `RESEND_API_KEY` or `BREVO_API_KEY` the service stays in log mode. With Resend's free testing mode, only the account owner's address receives mail; other recipients are stored as `failed` rows. See `evidence/RESEND-LIVE-EMAIL.txt`. |

---

## 9. Documentation index

- [`FULL_PROJECT_GUIDE.md`](FULL_PROJECT_GUIDE.md) — detailed implementation guide
- [`docs/architecture.md`](docs/architecture.md) — layers, Mermaid diagram and cloud model
- [`docs/api.md`](docs/api.md) — all public and internal endpoints
- [`docs/data-model.md`](docs/data-model.md) — entities, ER diagram and CRUD/search matrix
- [`docs/deployment.md`](docs/deployment.md) — both deployment paths and evidence checklist
- [`TESTING_README.md`](TESTING_README.md) — start-to-finish testing playbook for local, lab, Floci and public deployments
- [`TESTING_STEPS.md`](TESTING_STEPS.md) — full PowerShell request/response walkthrough
- [`docs/testing.md`](docs/testing.md) — test plan and result table
- [`docs/minimum-requirements.md`](docs/minimum-requirements.md) — per-student audit of the brief's minimum checklist
- [`docs/report.md`](docs/report.md) — final report draft (sections 1–10 + appendix)
- [`docs/limitations.md`](docs/limitations.md) — known limits and improvements
- [`docs/individual-statements.md`](docs/individual-statements.md) — the three mandatory contribution statements
- [`docs/notes.md`](docs/notes.md) — technical decisions and problems solved
- [`docs/openapi.yaml`](docs/openapi.yaml) — machine-readable API description
