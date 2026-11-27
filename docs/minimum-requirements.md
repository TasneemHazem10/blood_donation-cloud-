# Minimum requirements — per-student audit

Audit date: **27 Nov 2026**, updated after the live Turnstile run. Method: source/route inspection, `npm test` rerun today (**59 tests, 59 pass, 0 fail**), the existing local/Floci/public smoke evidence and a real-browser Turnstile validation on the public site. This document answers the brief's minimum checklist **for each owner**. It does not claim unrecorded student Git history or a demo video; those remain human artefacts listed in [`FINALIZATION_README.md`](../FINALIZATION_README.md).

Status legend: **MET** = implemented and evidenced; **MET (caveat)** = code is integrated but one live credential/artefact is still pending; **PENDING** = not done and not claimed.

---

## 0. Shared baseline for all three students

| Minimum requirement | How the whole project satisfies it | Evidence |
|---|---|---|
| Browser-based frontend connected to a real backend; no static/hard-coded data | Vanilla JS SPA in `frontend/js/views/` calls `frontend/js/api.js` → the three REST APIs. `frontend/js/config.js` contains **only service URLs/site key**, never records. The deployed config points to the three public Workers. | `evidence/E2E-04-*.png`, `evidence/PUBLIC-E2E-*.png`, `frontend/js/api.js`, `frontend/js/config.js` |
| 3 services/components with ≥3 related functions each | Drive Management, Donor/Eligibility, Booking/Reminder; each has 6–12 functions (details below). | `services/*/routes.js`, `docs/individual-statements.md` §1 |
| REST API with proper methods, validation and status codes | Shared router uses `GET/POST/PUT/PATCH/DELETE`, JWT/internal-key guards, JSON body limits and one error envelope (`400/401/403/404/409/413/429/500/502`). | `shared/router.js`, `shared/errors.js`, `docs/api.md`, `evidence/NPM-TEST.txt` |
| Persistent cloud database with CRUD | Nine `bdo_*` JSONB tables in Neon; SQLite locally/tests, DynamoDB on Floci through the same store interface. Create/read/update/delete/search are exercised across the services. | `infra/db/schema.sql`, `shared/store/`, `evidence/PUBLIC-SMOKE.txt` (22/22) |
| At least 2 user roles, enforced in the backend | `organizer` and `donor`. `shared/router.js` verifies the JWT and checks `roles` server-side; controllers add owner checks. Hiding UI buttons is not the access control. | `shared/router.js`, test cases DR03/DR05/DR09, DN03/DN05, BK02/BK05/BK07 |
| External API in a real workflow | Nominatim geocoding (Habiba), Cloudflare Turnstile (Tasneem), Resend/Brevo email (Hala), plus S3 report snapshots and cross-service calls. | `evidence/DRV-05-live-geocode.txt`, `evidence/DON-16-turnstile-missing-token.txt`, `evidence/TURNSTILE-LIVE-VALIDATION.txt`, `evidence/RESEND-LIVE-EMAIL.txt` |
| Cloud deployment, not localhost only | Three public Cloudflare Workers + static-asset SPA + Neon, free/educational tier. Floci/localhost is lab evidence only. | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, URLs in [`README.md`](../README.md) §6 |

---

## 1. Habiba — Drive Management

| Minimum requirement | What she owns | Verification |
|---|---|---|
| Frontend → real backend | Organizer dashboard in `frontend/js/views/organizer.js`: create drive, add/edit/delete slots, status changes, Bookings tab, Report tab, Emails tab. Every action calls a REST endpoint. | `evidence/E2E-04-*.png`, `evidence/PUBLIC-E2E-*.png` |
| ≥3 related functions | `createDrive`, `listDrives`, `getDrive`, `updateDrive`, `changeStatus`, `deleteDrive`, `createSlot`, `updateSlot`, `deleteSlot`, `getReport`, `listReports`, plus internal `reserveSeat`/`releaseSeat`. | `services/drive/controllers/drives.js`, `services/drive/routes.js` (15 routes) |
| REST API + validation/status | `POST/GET/PUT/PATCH/DELETE` on drives and slots; title/date/capacity/time/overlap/radius validation; `400/401/403/404/409/502`. | `services/drive/services/driveRules.js`, DR01–DR13 in [`docs/testing.md`](testing.md) |
| Persistent DB CRUD | `bdo_drives` (CRUD + city/status/date filter), `bdo_slots` (CRUD + atomic seat update), `bdo_reports` (create/list), `bdo_geocodes` (create/cache lookup). | `shared/store/`, `docs/data-model.md` |
| 2 roles enforced in backend | Organizer-only create/update/status/delete/slots/reports via `roles:['organizer']`; **owner check** in `assertOwner()` stops another organizer; donors can read listings only. | `services/drive/routes.js`, `services/drive/services/driveRules.js`, DR03/DR05/DR09 |
| External API in workflow | **OpenStreetMap Nominatim** geocodes venue/city during drive creation and `?near=` radius search; coordinates are cached in `bdo_geocodes`. S3 CSV snapshot on Floci. | **MET** — live capture `evidence/DRV-05-live-geocode.txt` (real coordinates, cached rows, `distanceKm`) |
| Cloud deployment | Drive Worker `https://bdo-drive.bdo-organizer.workers.dev` backed by Neon; same controller set runs on Express/Lambda/Worker. | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt` |

**Verdict: MET.** This service is the strongest single-service example of the full checklist.

---

## 2. Tasneem — Donor and Eligibility

| Minimum requirement | What she owns | Verification |
|---|---|---|
| Frontend → real backend | `frontend/js/views/auth.js` (login/register, role switch, Turnstile field) and `frontend/js/views/donor.js` (profile, eligibility banner, donation timeline, delete account). All state comes from the API. | `evidence/E2E-04-*.png`, `evidence/PUBLIC-E2E-*.png` |
| ≥3 related functions | `register`, `login`, `me`, `getProfile`, `updateProfile`, `getEligibility`, `getDonations`, `deleteAccount`, plus internal `eligibility`, `recordDonation`, `getDonor`. | `services/donor/controllers/auth.js`, `services/donor/controllers/donors.js`, `services/donor/routes.js` (12 routes) |
| REST API + validation/status | `POST/GET/PUT/DELETE`; email/password/profile/date validation; PBKDF2+HS256 JWT; `400/401/403/409/429/502`. | `services/donor/services/eligibility.js`, `shared/crypto.js`, DON01–DON16 in [`docs/testing.md`](testing.md) |
| Persistent DB CRUD | `bdo_users` (create/read/delete), `bdo_donors` (create/read/update/delete), `bdo_donations` (create/read/search/delete on account removal). | `docs/individual-statements.md` §2.4, `shared/store/` |
| 2 roles enforced in backend | Organizer registration requires the server-side invite (`409` without it); donor-only profile/eligibility/donation/delete endpoints call `requireDonor()` and return `403` for an organizer token. Role is read from the verified JWT, not the request body. | `services/donor/controllers/auth.js`, `services/donor/controllers/donors.js`, DN03/DN05 |
| External API in workflow | **Cloudflare Turnstile** `siteverify` is called inside register/login before an account/token is issued. Missing token with a configured secret returns `401`; upstream failure returns `502`. | **MET** — `evidence/DON-16-turnstile-missing-token.txt` proves the guarded branch and `evidence/TURNSTILE-LIVE-VALIDATION.txt` proves the live browser token was accepted on registration (201) and login (200). Cloudflare's free published dummy keys were used, not paid/production keys. |
| Cloud deployment | Donor Worker `https://bdo-donor.bdo-organizer.workers.dev` backed by Neon; shared crypto works in Node 22 and Workers. | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt` |

**Verdict: MET — exceeds minimum.** The external API is integrated into the auth workflow and the live widget-token round trip is now evidenced end-to-end in a real browser on the public Cloudflare site, using free published dummy test keys. The separate missing-token branch remains evidenced too.

---

## 3. Hala — Booking and Reminder

| Minimum requirement | What she owns | Verification |
|---|---|---|
| Frontend → real backend | Donor "Book seat" and "My bookings"/Cancel in `frontend/js/views/drives.js` and `frontend/js/views/donor.js`; organizer Bookings and Emails tabs in `frontend/js/views/organizer.js`. | `evidence/E2E-04-*.png`, `evidence/PUBLIC-E2E-*.png` |
| ≥3 related functions | `createBooking`, `myBookings`, `driveBookings`, `cancelBooking`, `checkIn`, `sendReminders`, `listReminders`, `stats`, `cancelDriveBookings`, `activeBookings`, `dailyReminders`. | `services/booking/controllers/bookings.js`, `services/booking/controllers/reminders.js`, `services/booking/routes.js` (12 routes) |
| REST API + validation/status | `POST/GET/PATCH`; id/outcome/date validation; eligibility + capacity + one-booking-per-donor rules; `400/401/403/404/409/502`. | `services/booking/services/bookingRules.js`, BOK01–BOK19 in [`docs/testing.md`](testing.md) |
| Persistent DB CRUD | `bdo_bookings` (create/read/update via CAS state transitions; cancel is an auditable status change rather than hard delete), `bdo_reminders` (create/read/update/search by organizer); stats computed from rows. | `docs/individual-statements.md` §3.4, `shared/store/` |
| 2 roles enforced in backend | Donor creates/cancels **only own** booking; organizer lists drive bookings, checks in, sends/reads reminders and can cancel own-drive bookings. `assertCanCancel()`/`assertCanCheckIn()` and route `roles` enforce it server-side. | `services/booking/routes.js`, `services/booking/services/bookingRules.js`, BK02/BK05/BK07/BK15/BK17 |
| External API in workflow | **Resend** transactional email on confirm/cancel/reminder, with Brevo fallback. Every attempt is persisted in `bdo_reminders`; failures never break the booking response. | **MET** — live controlled send `evidence/RESEND-LIVE-EMAIL.txt`; idempotent 1-sent/1-skipped in `evidence/PUBLIC-SMOKE.txt` |
| Cloud deployment | Booking Worker `https://bdo-booking.bdo-organizer.workers.dev` backed by Neon; Cloudflare Cron Trigger and Floci EventBridge declared, manual route verified. | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt` |

**Verdict: MET.** Cron scheduling is declared but a separate scheduled firing was not captured; the manual reminder route and organizer button were verified instead.

---

## 4. Honest caveats to keep in the submission

1. **Tasneem / Turnstile:** live validation is now PASS, but state the exact truth: Cloudflare's published **dummy test keys** were used. The widget token was generated in a real browser and accepted by the Donor Worker through Cloudflare `siteverify`; no paid plan or production widget key was used.
2. **Hala / cron:** do not write “scheduled run captured”. The trigger exists and the manual equivalent is PASS.
3. **All three / individual Git history:** the repository has real code and branches, but no fabricated per-student commits/PRs/reviews. Each student must create their own from their own Git identity.
4. **All three / demo video:** ≤5-minute recording from the public URL is still a human-created artefact.

See [`TESTING_README.md`](../TESTING_README.md) §9 for the same pending list with commands, and [`docs/report.md`](report.md) §8 for the report placeholder.
