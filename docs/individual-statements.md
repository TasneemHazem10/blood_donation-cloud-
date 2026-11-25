# Individual contribution statements

These statements describe **the code that exists in this workspace**. Functional claims are verified by `npm test` (53/53), local + Floci + public Cloudflare/Neon smoke (22/22 each) and the captured files in `evidence/`. The team repository is **https://github.com/TasneemHazem10/blood_donation-cloud-.git**; `main` and three `feature/*` branches are pushed, but there is no PR, `v1.0` tag or per-student commit yet; no authorship claim is made for the import commit. Local browser screenshots are `evidence/E2E-04-*.png` and public browser screenshots are `evidence/PUBLIC-E2E-*.png`. Public deployment evidence is `evidence/PUBLIC-DEPLOYMENT.txt` and `evidence/PUBLIC-SMOKE.txt`. The demo video and real API keys remain untested/pending. Replace every remaining `[PLACEHOLDER]` with a real artefact before submitting the report; see `docs/git-workflow.md`.

Shared evidence placeholders used below:

* `[REPO_URL]` — **https://github.com/TasneemHazem10/blood_donation-cloud-.git** (`main` and the three feature branches are pushed; PRs/tag still pending).
* `[PR_LINK_*]`, `[COMMIT_HASH_*]` — real PR/commit links per contribution.
* `[EVIDENCE: ...]` — screenshot, copied request/response, SQL row image or log excerpt.
* `[DEPLOYED_URL]` — **https://bdo-organizer.polarized-tarsal.workers.dev** (public Cloudflare URL, not localhost).

---

## Statement 1 — Habiba: Drive Management

### 1. Owned component and functions implemented

Owned component: **Drive Management service** (`services/drive/`), from organizer screens to drive/slot/report data.

| Function | Source | What it does |
| --- | --- | --- |
| `createDrive(ctx)` | `services/drive/controllers/drives.js` | Validates input, geocodes venue+city, stores a drive with owner and `scheduled` status |
| `updateDrive(ctx)` / `changeStatus(ctx)` / `deleteDrive(ctx)` | same | Owner-checked edit, legal status transitions (cancel/complete with cross-service side effects), guarded delete |
| `createSlot(ctx)` / `updateSlot(ctx)` / `deleteSlot(ctx)` | same | Slot CRUD with time/capacity rules, overlap detection and booked-seat guard |
| `listDrives(ctx)` / `getDrive(ctx)` | same | Public list with city/status/date filters, optional `near` radius search, slot availability summary |
| `getReport(ctx)` / `listReports(ctx)` | same, `services/drive/services/driveRules.js` | Builds fill/turnout/no-show rates from Booking stats, stores snapshot, lists snapshots |
| `reserveSeat(ctx)` / `releaseSeat(ctx)` | same | Internal atomic seat reserve/release for Booking |
| `filterDrives` / `filterNear` / `buildReport` / `validateDriveInput` / `validateSlotInput` / `assertNoOverlap` | `services/drive/services/driveRules.js` | Pure business rules used by the controllers |
| `saveReportSnapshot(report)` | `services/drive/services/s3.js` | Writes CSV snapshot to S3 when `REPORTS_BUCKET` is set, otherwise records database-only storage |

Function list is present in source and exercised by `npm test` / Floci smoke. Git evidence placeholder: `[EVIDENCE: function list linked to [PR_LINK_HABIBA_DRIVE] and [COMMIT_HASH_HABIBA_DRIVE]]`. A local repo exists but links must be created, not invented.

### 2. Frontend work

Implemented the organizer area in `frontend/js/views/organizer.js`:

* Organizer dashboard listing only drives whose `organizerId` equals the logged-in user.
* "New drive" form (title, city, venue, date, description) calling `POST /api/drives`.
* Slots tab: add slot, view `booked/capacity`, delete unbooked slot.
* Bookings tab: read `GET /api/bookings?driveId=…` and check donors in as `attended` or `no_show` (the check-in button lives in the Booking service but is presented here).
* Report tab: generate a turnout report and display rates plus storage location.
* Emails tab: send reminders for a date and display the reminder log.
* Cancel drive / delete cancelled drive controls with confirmation dialogs from `frontend/js/ui.js`.

Evidence placeholder: `[EVIDENCE: screenshots of #/organizer with create form, slots table and report tab]`, `[PR_LINK_HABIBA_FRONTEND]`.

### 3. Backend/API work

Routes registered in `services/drive/routes.js` (15 total):

| Public / organizer | Internal |
| --- | --- |
| `GET /api/health/drive`, `GET /api/drives`, `POST /api/drives`, `GET /api/drives/:id`, `PUT /api/drives/:id`, `PATCH /api/drives/:id/status`, `DELETE /api/drives/:id`, `POST/PUT/DELETE /api/drives/:id/slots[...]`, `GET /api/drives/:id/report`, `GET /api/drives/:id/reports` | `GET /internal/drives/:id`, `POST /internal/drives/:id/slots/:slotId/reservation`, `DELETE /internal/drives/:id/slots/:slotId/reservation` |

Runtime files: `server.js` (Express, port 3001), `lambda.js` (serverless-http + DynamoDB), `worker.js` (Cloudflare Worker + Neon). All use the same routes and controllers via `shared/router.js`.

Drive routes are verified by `npm test` / Floci smoke; capture placeholder: `[EVIDENCE: one curl/Postman request and response per row in docs/api.md section 2]`.

### 4. Data operations

| Table | Create | Read | Update | Delete | Search |
| --- | --- | --- | --- | --- | --- |
| `bdo_drives` | `put` in `createDrive` | `get`, `all` | `update` in edit/status | `remove` after cancellation & zero bookings | `all` + in-memory city/status/date filter |
| `bdo_slots` | `put` in `createSlot` | `get`, `all` | `update`, atomic `reserveSeat(±1)` | `remove` when `booked = 0` | `search('bdo_slots','driveId')` |
| `bdo_reports` | `put` snapshot | `all` via search | — | `remove` with drive | `search('bdo_reports','driveId')` |
| `bdo_geocodes` | `put` from `geocode()` | `get` by normalised place | — | — | cache lookup by key |

S3 snapshot: `reports/<driveId>/<reportId>.csv` on Floci only.

Evidence placeholder: `[EVIDENCE: SQL editor/DynamoDB console screenshots of drive, slot and report rows before/after operations]`.

### 5. Input validation and error handling

* Drive fields: title 3–120, venue 3–160, city 2–80, real `YYYY-MM-DD` date, description ≤ 1000 (`driveRules.validateDriveInput`).
* Slots: `HH:MM` times, start before end, integer capacity 1–200, no overlap (`validateSlotInput`, `assertNoOverlap`).
* Query filters: `status` enum, `dateFrom/dateTo` valid, `radius` 1–500 km; `near` geocode failure → `502`.
* Authorization: `401` without JWT or with wrong internal key, `403` for non-organizer, `409` for non-owner/non-editable state/full slot/overlap, `404` for missing drive, `400` for validation errors. All responses use `shared/errors.js` envelope.

Verified by local and Floci smoke, which cover 400/401/403/404/409 cases; capture placeholder: `[EVIDENCE: 400/401/403/404/409 responses for DRV-07..DRV-13]`.

### 6. Tests

Automated cases DRV-01–DRV-13 are in `docs/testing.md` (health, create, slot add, filters, report, missing field, unknown id, wrong owner, overlap, full slot, cancel/delete, future completion). They are implemented in `tests/drive-api.test.js` and `tests/integration.test.js` with `node --test` and Supertest; `npm test` reports 53 tests, 53 pass, 0 fail across all six test files.

Verified by `npm test` (53/53 overall) and local + Floci smoke (22/22 each), plus the public Cloudflare/Neon run in `evidence/PUBLIC-SMOKE.txt` (drive create, slot create, report with `storage:"database"`). DRV-05 additionally has live external-API evidence in `evidence/DRV-05-live-geocode.txt` (real Nominatim coordinates, cached rows and a `?near=` result with `distanceKm`).

### 7. Integration work

* Called by Booking for seat reserve/release and drive lookup (internal key); Drive never overbooks because of the conditional update in all three store drivers.
* Calls Booking `GET /internal/drives/:id/stats` for reports and `POST /internal/drives/:id/cancellations` when a drive is cancelled.
* Calls OpenStreetMap Nominatim through `shared/external/geo.js`, caching coordinates in `bdo_geocodes`.
* Writes report CSV to S3 via `services/drive/services/s3.js` on the Floci deployment.

Verified by local + Floci smoke for the internal seat/report/email flow; capture placeholder remains `[EVIDENCE: request/response pair for one internal call in each direction + GEOCODE/S3 log line]`.

### 8. Important technical decisions

1. **One controller set, three runtimes** — Express/Lambda/Worker entry points all mount the same `routes.js`, so behaviour cannot drift.
2. **Atomic seat change in the database** (`UPDATE ... BETWEEN 0 AND capacity`) rather than read-modify-write in the application.
3. **JSON document tables** with one logical table per entity, so SQLite, DynamoDB and Neon share the same store interface.
4. **Ownership + status rules in `driveRules.js`** instead of trusting the client; organizer id comes from the JWT, never the request body.
5. **Geocoding failures are non-fatal** for drive creation but explicit (`502`) for `?near=` search.

Evidence placeholder: `[EVIDENCE: code links [COMMIT_HASH_HABIBA_RULES], [COMMIT_HASH_HABIBA_STORE]]`.

### 9. Significant difficulties and fixes

1. **SQLite "database is locked" while three local services initialised the same file.** Fixed by enabling WAL, a 5-second busy timeout and `synchronous=NORMAL` in `shared/store/sqlite.js` (see `docs/notes.md`).
2. **Port 8080 was already taken on the development machine.** Moved the website to **http://localhost:8090** in `infra/scripts/dev-all.js` and updated `CORS_ORIGINS`; the three APIs stayed on 3001/3002/3003. The seed script's final message was also corrected to 8090.
3. **Floci geocode cache table.** Added `bdo_geocodes` to `infra/services/drive.sh`; the verified deployment creates nine DynamoDB tables and the cache is available. DRV-05 now has a live `?near=` capture outside `TEST_MODE=1` in `evidence/DRV-05-live-geocode.txt`.
4. **CORS origin differs per deployment** (8090 local, 4566 Floci, Workers static-asset URL on Cloudflare). Handled with the `CORS_ORIGINS` env var; on the public deployment it is set to `https://bdo-organizer.polarized-tarsal.workers.dev` and verified by the `Access-Control-Allow-Origin` health-check header in `evidence/PUBLIC-DEPLOYMENT.txt`.

Evidence: `evidence/E2E-04-home.png` and `evidence/E2E-04-drives.png` show the SPA running on **http://localhost:8090** with `3/3 services online`; the pre-fix WAL error log screenshot is still a placeholder.

---

## Statement 2 — Tasneem: Donor and Eligibility

### 1. Owned component and functions implemented

Owned component: **Donor and Eligibility service** (`services/donor/`), including authentication and the donor-facing profile screens.

| Function | Source | What it does |
| --- | --- | --- |
| `register(ctx)` / `login(ctx)` / `me(ctx)` | `services/donor/controllers/auth.js` | Password hashing, JWT issue, account lookup, organizer invite gate, Turnstile check |
| `getProfile(ctx)` / `updateProfile(ctx)` / `getEligibility(ctx)` / `getDonations(ctx)` / `deleteAccount(ctx)` | `services/donor/controllers/donors.js` | Profile + eligibility + donation history, partial updates, guarded deletion |
| `eligibility(ctx)` / `recordDonation(ctx)` / `getDonor(ctx)` | `services/donor/controllers/internal.js` | Internal queries for Booking; idempotent donation recording |
| `evaluate(donor,date)` / `validateProfile(body,partial)` | `services/donor/services/eligibility.js` | 18–65 age, ≥50 kg, 56-day interval, deferral, next eligible date; profile validation |
| `hashPassword` / `verifyPassword` / `createToken` / `verifyToken` | `shared/crypto.js` | PBKDF2-SHA256 (60,000 iterations) and HS256 JWT using WebCrypto |
| `verifyTurnstile` / `check` | `shared/external/turnstile.js`, `services/donor/services/authRateLimit.js` | Bot verification and 8-per-10-minute attempt limit |

Function list is present in source and exercised by `npm test` / Floci smoke. Git evidence placeholder: `[EVIDENCE: function list linked to [PR_LINK_DONOR_AUTH], [COMMIT_HASH_DONOR_ELIGIBILITY]]`.

### 2. Frontend work

* `frontend/js/views/auth.js`: login form, registration form with role switch, donor fields (blood type, weight, birth year, optional phone), hidden organizer invite field, Turnstile widget loader and token collection, session storage through `api.js`.
* `frontend/js/views/donor.js`: profile screen with eligibility banner, editable donor details, donation timeline, delete-account button with confirmation.
* `frontend/js/views/drives.js` (detail page) renders the donor-only "Book seat" button, which is enabled only for `role === 'donor'`.

Evidence placeholder: `[EVIDENCE: screenshots of #/register, #/profile eligible and ineligible banners, #/bookings]`.

### 3. Backend/API work

Routes in `services/donor/routes.js` (12 total):

| Public | Auth / internal |
| --- | --- |
| `GET /api/health/donor`, `POST /api/auth/register`, `POST /api/auth/login` | `GET /api/auth/me`, `GET/PUT /api/donors/me`, `GET /api/donors/me/eligibility`, `GET /api/donors/me/donations`, `DELETE /api/donors/me`, `GET /internal/donors/:id/eligibility`, `POST /internal/donations`, `GET /internal/donors/:id` |

Runtime files mirror Habiba's service: `server.js` (:3002), `lambda.js`, `worker.js`.

Donor routes are verified by `npm test` / Floci smoke; capture placeholder: `[EVIDENCE: one request/response per donor endpoint; decoded JWT payload with passwordHash absent]`.

### 4. Data operations

| Table | Create | Read | Update | Delete | Search |
| --- | --- | --- | --- | --- | --- |
| `bdo_users` | `insert` in `register` (id = lower-cased email) | `get` in login/`me` | — | `remove` in `deleteAccount` | duplicate check by `get(email)` |
| `bdo_donors` | `put` alongside user | `get`, internal `get` | `update` profile and `lastDonationDate` | `remove` in `deleteAccount` | — |
| `bdo_donations` | `insert` in `recordDonation` (id = booking id on check-in) | `get` for idempotency | — | `remove` in `deleteAccount` | `search('bdo_donations','donorId')` sorted by date |

Evidence placeholder: `[EVIDENCE: SQL/DynamoDB rows after register, profile update, donation record and account deletion]`.

### 5. Input validation and error handling

* `emailField` lower-cases and validates format; `stringField` enforces name 2–80, password 8–128 for register (1–128 for login).
* `validateProfile`: blood type one of eight values, weight 30–300 kg, birth year 1900–current, phone ≤ 30 characters; partial mode for `PUT`.
* `evaluate` validates the date and returns a structured `eligible/reason/nextEligibleDate` result; missing profile is a valid `eligible:false` response.
* Turnstile: missing token → `401`, upstream unavailable → `502`; without a secret the code explicitly uses development mode.
* `authRateLimit.check` → `429 RATE_LIMIT`; duplicate email/bad invite → `409`; wrong password/no token → `401`; donor-only routes → `403`.

Verified by local + Floci smoke for 400/401/403/409 cases; the 429 branch is captured in `evidence/DON-14-rate-limit.txt` (attempts 1–8 = 401, attempt 9 = 429).

### 6. Tests

Automated cases DON-01–DON-16 are in `docs/testing.md`: valid registration/login, both roles, `me`, eligibility states, profile update, history, duplicate email, wrong password, missing token, role misuse, invalid profile, rate limit, deletion blocked by booking, Turnstile without token. Most are covered by `tests/donor-api.test.js` and `tests/integration.test.js`; DON-14 and the missing-token branch of DON-16 are now covered by `tests/pending-evidence.test.js` and captured in `evidence/DON-14-rate-limit.txt` and `evidence/DON-16-turnstile-missing-token.txt`. Validation with a real Turnstile widget token is still pending a live test key.

Verified by `npm test` (53/53 overall), local + Floci smoke (22/22 each) and the public Workers + Neon run in `evidence/PUBLIC-SMOKE.txt` (register, login, eligibility, 401/409 cases); keep captured output for report evidence.

### 7. Integration work

* Called by Booking: `GET /internal/donors/:id/eligibility?date=<drive date>` before a seat is held, and `POST /internal/donations` on `attended` check-in.
* Calls Booking `GET /internal/donors/:id/active-bookings` before allowing account deletion.
* JWT produced here is accepted by the other two services through the shared `verifyToken()` and `JWT_SECRET`; the router performs role checks.
* Turnstile is verified server-side on register/login while the public site key is injected into the client config.

Verified by local + Floci smoke: check-in `attended` records the donation; capture placeholder remains `[EVIDENCE: Booking request/response to donor service + donation row created after check-in]`.

### 8. Important technical decisions

1. **WebCrypto (PBKDF2 + HMAC)** instead of a Node-only crypto library so identical code works in Node 22 and Workers.
2. **Email as primary key** for users and donors, so JWT `id`, internal lookups and booking composite ids stay consistent.
3. **Default 56-day interval** via `DONATION_INTERVAL_DAYS`, with `nextEligibleDate` computed from `lastDonationDate` or `deferredUntil`.
4. **In-memory rate limiter** as a local stop-gap, with Cloudflare WAF rate limiting recommended for production.
5. **Turnstile development bypass** when no secret is configured, so the three-person team can test locally without paid keys.

Evidence placeholder: `[EVIDENCE: code links [COMMIT_HASH_DONOR_CRYPTO], [COMMIT_HASH_DONOR_RATE_LIMIT]]`.

### 9. Significant difficulties and fixes

1. **Worker CPU budget vs password hashing.** 60,000 PBKDF2 iterations are acceptable locally; register/login succeeded repeatedly on the deployed Worker during `evidence/PUBLIC-SMOKE.txt`, so no timeout was observed. Further load testing would still be needed before production (`docs/notes.md`).
2. **No real Turnstile secret locally.** The code returns `{mode:'development'}` when `TURNSTILE_SECRET` is unset; real evidence requires a test key in Worker secrets and a redacted screenshot.
3. **Eligibility edge cases (deferral vs interval vs age).** Solved by evaluating rules in a fixed order in `evaluate()` and returning a machine-readable `nextEligibleDate`, including `null` when age makes donation permanently ineligible.
4. **Deleting a donor with upcoming bookings would orphan booking rows.** Solved by calling Booking's active-bookings endpoint and returning `409` until the donor cancels.

Evidence placeholder: `[EVIDENCE: before/after eligibility JSON; 409 deletion response]`.

---

## Statement 3 — Hala: Booking and Reminder

### 1. Owned component and functions implemented

Owned component: **Booking and Reminder service** (`services/booking/`).

| Function | Source | What it does |
| --- | --- | --- |
| `createBooking(ctx)` | `services/booking/controllers/bookings.js` | Checks Drive + Donor, reserves seat, inserts booking, records confirmation |
| `myBookings(ctx)` / `driveBookings(ctx)` | same | Donor list and owner-filtered organizer list |
| `cancelBooking(ctx)` / `checkIn(ctx)` | same | CAS status transitions, seat release, donation recording, emails |
| `sendForDate(date,organizerId)` / `sendReminders(ctx)` / `listReminders(ctx)` | `services/booking/controllers/reminders.js` | Idempotent reminder run and organizer email log |
| `stats` / `cancelDriveBookings` / `activeBookings` / `dailyReminders` | `services/booking/controllers/internal.js` | Internal endpoints for Drive/Donor and the scheduler |
| `assertBookable` / `assertCanCancel` / `assertCanCheckIn` / `countStats` / `bookingKey` | `services/booking/services/bookingRules.js` | Core booking state machine and statistics |
| `notify(booking,template,type)` / `templates.js` | `services/booking/services/` | Persist every email attempt and render confirmation/reminder/cancellation HTML |

Function list is present in source and exercised by `npm test` / Floci smoke. Git evidence placeholder: `[EVIDENCE: function list linked to [PR_LINK_BOOKING_FLOW], [COMMIT_HASH_BOOKING_REMINDERS]]`.

### 2. Frontend work

* `frontend/js/views/drives.js`: slot table with live availability and donor "Book seat" action with confirmation dialog and error toast.
* `frontend/js/views/donor.js`: "My bookings" page with cancel button and status badges, refreshing seat availability after cancellation.
* `frontend/js/views/organizer.js`: Bookings tab (per-drive list, Attended/No-show buttons) and Emails tab (date picker, send button, reminder log table).

Evidence placeholder: `[EVIDENCE: screenshots of booking confirmation toast, My bookings page, organizer Bookings and Emails tabs]`.

### 3. Backend/API work

Routes in `services/booking/routes.js` (12 total):

| Public | Auth / internal |
| --- | --- |
| `GET /api/health/booking` | `POST /api/bookings`, `GET /api/bookings/mine`, `GET /api/bookings`, `POST /api/bookings/:id/cancel`, `PATCH /api/bookings/:id/check-in`, `POST /api/reminders/send`, `GET /api/reminders`, `GET /internal/drives/:id/stats`, `POST /internal/drives/:id/cancellations`, `GET /internal/donors/:id/active-bookings`, `POST /internal/reminders/daily` |

Runtime files: `server.js` (:3003), `lambda.js`, `worker.js`.

Booking routes are verified by `npm test` / Floci smoke; capture placeholder: `[EVIDENCE: one request/response per booking endpoint in docs/api.md section 4]`.

### 4. Data operations

| Table | Create | Read | Update | Delete | Search |
| --- | --- | --- | --- | --- | --- |
| `bdo_bookings` | `insert` with id `driveId__donorId` | `get`, `all` | `cas` to `cancelled/attended/no_show`, restore `confirmed` on retry path | none (status-based cancel) | `search('bdo_bookings','donorId')`, `search(...,'driveId')` |
| `bdo_reminders` | `put` for confirmation/cancellation/daily reminder | `get` for idempotency, `all` for organizer log | `update` status to `dev-log`/`sent`/`failed` with provider/message id | none (audit log retained) | in-memory filter by `organizerId` |

Statistics are computed in memory with `countStats()` from all booking rows for a drive.

Verified by local + Floci smoke: booking `201`, duplicate `409`, cancel/check-in, and reminder rows with 1 sent + 1 skipped; Floci report `storage:"s3"`.

### 5. Input validation and error handling

* `driveId`/`slotId` pattern check; `idParam` on path/query ids; `outcome` restricted to `attended`/`no_show`; reminder `date` must be `YYYY-MM-DD`.
* Business rules: drive must be `scheduled` and in the future, donor must be eligible for that date, slot must exist and have room, one booking per donor per drive.
* `409` for ineligible/full/duplicate/illegal state, `403` for non-owner check-in or cross-organizer listing/cancel, `400` for malformed ids/outcomes/dates, `502` when Drive/Donor/email upstream fails, `401` for missing internal key.
* Email errors are caught per message and stored as `status:'failed'` so a provider outage never fails the booking response.

Verified by local + Floci smoke for 400/401/403/409 cases; capture placeholder remains for `502` and response screenshots.

### 6. Tests

Automated cases BOK-01–BOK-19 are in `docs/testing.md`: normal booking/cancel/check-in, reminder idempotency, ineligible donor, full slot, double booking, unknown id, donor calling check-in, wrong outcome, wrong organizer, missing internal key, daily internal route. They are implemented in `tests/booking-api.test.js`, `tests/shared-rules.test.js` and `tests/integration.test.js`; the full suite is 53/53 PASS and both smoke runs are 22/22 PASS.

Verified by `npm test` (53/53), local + Floci smoke (22/22 each, report `storage:"s3"` on Floci) and the public Workers + Neon run in `evidence/PUBLIC-SMOKE.txt` (booking 201/409, reminders 1 sent + 1 skipped, check-in `attended`, donation recorded); keep captured output for report evidence.

### 7. Integration work

* Calls Drive internal GET / reserve / release for every booking and cancellation.
* Calls Donor internal eligibility before booking and donation recording on `attended` check-in.
* Is called by Drive for report stats and drive cancellation, and by Donor for active-bookings before account deletion.
* Sends email through `shared/external/email.js` (Resend in live mode, Brevo fallback, `EMAIL_MODE=log` locally) and exposes the same reminder logic to the organizer button, the internal route and both cloud schedulers.

Verified by local + Floci smoke for booking, check-in, donation recording and report stats; capture placeholder remains `[EVIDENCE: cross-service call log lines with request and response for one booking and one check-in]`.

### 8. Important technical decisions

1. **Deterministic booking id `driveId__donorId`** to make one-booking-per-donor-per-drive a storage property.
2. **Reserve-then-insert with compensating release** so two concurrent donors cannot take the last seat; the seat counter itself is an atomic conditional database update.
3. **CAS for status changes** (`expected:{status:'confirmed'}`) so cancel and check-in cannot overwrite each other.
4. **Idempotency key for reminders** (`bookingId#reminder#date`) so repeated cron/button runs do not resend.
5. **Every email attempt is a database row**, giving the report and the UI an auditable log even when no Resend key exists.

Evidence placeholder: `[EVIDENCE: code links [COMMIT_HASH_HALA_RESEAT], [COMMIT_HASH_HALA_REMINDERS]]`.

### 9. Significant difficulties and fixes

1. **Concurrent booking / overbooking risk.** Solved with guarded `reserveSeat()` writes (SQLite/Neon conditional update; DynamoDB read-compare-update with retry) and compensation if the booking insert throws. Residual crash-window documented in `docs/limitations.md`.
2. **Duplicate reminder emails.** Solved with the deterministic reminder id and a `get()` check before sending; the second run reports `skipped`.
3. **Scheduling on two clouds.** Floci's EventBridge event shape was solved with a `source === 'aws.events'` branch in `lambda.js`; Cloudflare declares a Cron Trigger `0 6 * * *` and exports `scheduled()` in `worker.js`. Both call `sendForDate()`; the organizer Emails button remains a manual fallback. On the public deployment the organizer button and `POST /internal/reminders/daily` were verified (`evidence/PUBLIC-SMOKE.txt`), but the temporary free account allows 0 cron triggers, so the scheduled execution itself could not be attached there.
4. **Free-tier email limits.** `EMAIL_MODE=log` locally avoids real sends; one controlled reminder run was performed with a git-ignored Resend key on the public Worker (`evidence/RESEND-LIVE-EMAIL.txt`). Resend testing mode delivers only to the account owner's address.
5. **Booking id separator.** `bookingKey()` uses `driveId__donorId`; `idParam()` accepts the `__` separator, and local + Floci smoke verify cancel/check-in with real ids.

Verified by local, Floci and public smoke: 1 reminder sent + 1 skipped on the second run in each; the public manual reminder route and organizer button are evidenced in `evidence/PUBLIC-SMOKE.txt`. The Cloudflare Cron Trigger itself could not be attached to the temporary preview account (0 cron triggers), so only its code path and manual equivalent are verified.
