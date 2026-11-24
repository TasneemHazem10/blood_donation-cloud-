# Blood Donation Drive Organizer

A complete three-service cloud application for organizing blood donation drives. Organizers publish drives and time slots, donors register and book a seat, and the Booking service checks eligibility, reserves seats atomically, records attendance and sends confirmations/reminders.

This README is the **manual setup and deployment guide**. A deeper implementation walkthrough is in [`FULL_PROJECT_GUIDE.md`](FULL_PROJECT_GUIDE.md). Report material is in [`docs/`](docs/). The hand-over checklist of everything still needed from the team (GitHub identities, Cloudflare/Neon secrets, video, evidence and final tagging) is in [`FINALIZATION_README.md`](FINALIZATION_README.md). The exact step-by-step manual testing procedure (API journey, error cases, UI, database, smoke runs and deployed checks) is in [`TESTING_STEPS.md`](TESTING_STEPS.md).

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

The suite uses Node's built-in test runner and Supertest (53 tests, 53 pass). It covers business rules, every service API, validation/error codes and a full cross-service journey. To regenerate request/response evidence for live geocoding, the login rate limit and the Turnstile missing-token branch, run `npm run evidence:capture`; the files are written to `evidence/`. See [`docs/testing.md`](docs/testing.md) for the report table and evidence checklist.

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

This is the public deployment required by the final-phase plan. It uses three Cloudflare Workers, a Cloudflare Workers static-asset site for the SPA, and Neon Postgres. Optional Turnstile and Brevo keys can be added later.

### Live public deployment (verified 25 Nov 2026)

| Component | Public URL |
|---|---|
| Website | **https://bdo-organizer.tourmaline-headphones.workers.dev** |
| Drive API | https://bdo-drive.tourmaline-headphones.workers.dev |
| Donor/Eligibility API | https://bdo-donor.tourmaline-headphones.workers.dev |
| Booking/Reminder API | https://bdo-booking.tourmaline-headphones.workers.dev |

Neon project `cloud` (`rapid-shadow-53692379`), branch `production`, has `infra/db/schema.sql` applied. All three health endpoints return 200 with the website origin in `Access-Control-Allow-Origin`, the deployed `frontend/js/config.js` points at the three public Worker URLs, and `npm run smoke` passes **22/22** against the public deployment. Evidence: `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png`.

The three `services/*/wrangler.toml` files set `compatibility_flags = ["global_fetch_strictly_public"]`. Without it Cloudflare returns error `1042` when the Booking Worker calls the Drive/Donor Workers through their public `workers.dev` URLs.

This deployment uses a **temporary Cloudflare preview account**. Claim it with the link supplied out-of-band (never commit the claim token) or redeploy to a permanent account. The temporary free plan allows **0 cron triggers**, so the `0 6 * * *` trigger declared in `services/booking/wrangler.toml` could not be attached there; the organizer Reminder button and `POST /internal/reminders/daily` were verified instead. Turnstile/Brevo keys were not configured, so `EMAIL_MODE=log` is intentional.

### One-time manual setup

1. Log in: `npx wrangler login`.
2. Create a Neon project and copy its connection string.
3. Apply the schema from `infra/db/schema.sql` in the Neon SQL editor (the deploy script also applies it).
4. Create a Turnstile widget and a Brevo API key if you want real bot protection and real email. Leave them empty to stay in log mode.
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
export BREVO_API_KEY=''                                 # optional

npm run deploy:cloudflare
```

The script bundles the Workers, applies the Neon schema, sets secrets with `wrangler secret put`, deploys the three Workers, rewrites `frontend/js/config.js` with the public service URLs, deploys the static site to Cloudflare Pages, and verifies all three health endpoints. Deployed URLs are saved to `.data/cloudflare-urls.json`.

On Windows PowerShell, use `$env:NAME='value'` instead of `export NAME='value'`.

Verify manually in a browser and from a phone:

```text
https://bdo-organizer.tourmaline-headphones.workers.dev
https://bdo-drive.tourmaline-headphones.workers.dev/api/health/drive
https://bdo-donor.tourmaline-headphones.workers.dev/api/health/donor
https://bdo-booking.tourmaline-headphones.workers.dev/api/health/booking
```

Never commit `.dev.vars`, `.env`, `infra/secrets.env` or real credentials.

---

## 7. Repository, ownership and evidence

The team repository is **https://github.com/TasneemHazem10/blood_donation-cloud-.git** (`main` and the three feature branches are pushed). Make it public or invite the module leader as a collaborator. Suggested branching strategy:

- `main` is protected and always deployable.
- Each student works on `feature/s1-*`, `feature/s2-*` or `feature/s3-*` and opens a PR reviewed by another student.
- Shared folders (`frontend/`, `shared/`, `infra/`, `tests/`) require review from all three owners. See `.github/CODEOWNERS`.
- Replace the placeholder GitHub handles in `.github/CODEOWNERS` with real usernames.

Each student must make real commits to their own service. The generated code is complete, but commit history cannot be faked; the students should commit their own work from their own Git identities.

Evidence to collect for the report:

- Public health/config/database evidence is in `evidence/PUBLIC-DEPLOYMENT.txt` and `evidence/PUBLIC-SMOKE.txt`; public browser screenshots are `evidence/PUBLIC-E2E-home.png` and `evidence/PUBLIC-E2E-drives.png`. Local browser evidence is in `evidence/E2E-04-home.png` and `evidence/E2E-04-drives.png` (headless Chrome at `http://localhost:8090`).
- Postman or `curl` request/response pairs for each endpoint.
- Neon SQL editor screenshots after create/update/delete.
- `npm test` output plus rows in [`docs/testing.md`](docs/testing.md).
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
| Cron Trigger missing on temporary preview account | Temporary free accounts have a limit of 0 cron triggers; use the manual Reminder button or a permanent Cloudflare account. |
| Neon first request is slow | Free compute wakes from pause; open the app once before the demo. |
| Reminder emails do not arrive | Without `BREVO_API_KEY` the service stays in log mode and records messages in `/api/reminders`. |

---

## 9. Documentation index

- [`FULL_PROJECT_GUIDE.md`](FULL_PROJECT_GUIDE.md) — detailed implementation guide
- [`docs/architecture.md`](docs/architecture.md) — layers, Mermaid diagram and cloud model
- [`docs/api.md`](docs/api.md) — all public and internal endpoints
- [`docs/data-model.md`](docs/data-model.md) — entities, ER diagram and CRUD/search matrix
- [`docs/deployment.md`](docs/deployment.md) — both deployment paths and evidence checklist
- [`docs/testing.md`](docs/testing.md) — test plan and result table
- [`docs/report.md`](docs/report.md) — final report draft (sections 1–10 + appendix)
- [`docs/limitations.md`](docs/limitations.md) — known limits and improvements
- [`docs/individual-statements.md`](docs/individual-statements.md) — the three mandatory contribution statements
- [`docs/notes.md`](docs/notes.md) — technical decisions and problems solved
- [`docs/openapi.yaml`](docs/openapi.yaml) — machine-readable API description
