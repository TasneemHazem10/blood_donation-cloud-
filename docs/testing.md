# Test plan and results

## 1. Test approach

| Level | How | Notes |
| --- | --- | --- |
| Unit | `node --test` on pure rule modules: `driveRules`, `eligibility`, `bookingRules`, `templates`, `crypto`, `validate` | `TEST_MODE=1` gives deterministic geocoding; `setClock()` can freeze `now()` |
| API | Supertest against the three Express apps with `setServiceFetch()` stubs for cross-service calls | Same controllers and route tables as production |
| Integration | Real HTTP calls across all three services on local ports 3001/3002/3003 | Shared SQLite file through `shared/context.js` |
| Deployed system | Smoke flow against the Floci API Gateway with real JWTs and DynamoDB; same script against the three public Cloudflare Workers with Neon | Selected with `BDO_API_URL` (Floci) or `BDO_DRIVE_URL`/`BDO_DONOR_URL`/`BDO_BOOKING_URL` (public) |
| End-to-end | Organizer creates drive → donor registers/books → email recorded → organizer checks in → report updates | Run locally, on Floci and on the public Cloudflare + Neon deployment (22/22 each) |

Commands:

```bash
npm install
npm test                          # 53 tests, 53 pass, 0 fail
npm run evidence:capture          # writes evidence/DRV-05, DON-14, DON-16 files
node infra/scripts/dev-all.js     # or npm run dev
npm run smoke                     # local: 22 PASS
BDO_API_URL=http://4f503503dd.execute-api.localhost.floci.io:4566 \
  ORGANIZER_INVITE=<from infra/secrets.env> npm run smoke           # Floci: 22 PASS
# Cloudflare Workers (separate URLs):
BDO_API_URL='' BDO_DRIVE_URL=https://bdo-drive.<account>.workers.dev \
  BDO_DONOR_URL=https://bdo-donor.<account>.workers.dev \
  BDO_BOOKING_URL=https://bdo-booking.<account>.workers.dev npm run smoke
bash infra/deploy-all.sh          # Git Bash; ends with ALL CHECKS PASSED
```

**Verified on 25 Nov 2026**

| Check | Result |
| --- | --- |
| `npm test` | **53 tests, 53 pass, 0 fail** (`tests/booking-api.test.js`, `donor-api.test.js`, `drive-api.test.js`, `integration.test.js`, `pending-evidence.test.js`, `shared-rules.test.js`) |
| Evidence capture | `npm run evidence:capture` wrote `evidence/DON-14-rate-limit.txt`, `evidence/DON-16-turnstile-missing-token.txt` and `evidence/DRV-05-live-geocode.txt` |
| Local smoke | **22/22 PASS**; report `{"booked":1,"attended":1,"turnout":100,"storage":"database"}` |
| Floci deployment | **ALL CHECKS PASSED**: drive/donor/booking health, drive list, website object, Floci dashboard |
| Floci smoke | **22/22 PASS** through the API Gateway; report `storage:"s3"` |

`booking.id` uses the `__` separator (for example `drv_abc__donor@example.org`); cancel and check-in accept it. The former `::` validator blocker (L23) is resolved and covered by BK06/BK07 and the smoke flow.

## 2. Drive service — Habiba

| ID | Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| DRV-01 | `GET /api/health/drive` | `200 {status:"ok", service:"drive"}` | 200 locally and on Floci | PASS | health curl + Floci check output |
| DRV-02 | Create valid drive as organizer | `201`, id starts `drv_`, `organizerId` = JWT id | 201 in DR02, smoke and Floci smoke | PASS | request/response + `bdo_drives` row |
| DRV-03 | Add slot 09:00–11:00 capacity 10 | `201`, `booked:0` | 201 in DR06 and both smoke runs | PASS | response + `bdo_slots` row |
| DRV-04 | List drives filtered by `city`, `status`, `dateFrom/dateTo` | `200`, only matching drives | 200 with filters in SR05 | PASS | query URL + response |
| DRV-05 | `GET /api/drives?near=<place>&radius=25` | `200`, drives have `distanceKm`, geocode cached | Live Nominatim call returned `29.3796532,47.9734174` for `Kuwait City`; drive created with coordinates and near search returned `count:1, distanceKm:0`; two rows cached in `bdo_geocodes` | PASS | `evidence/DRV-05-live-geocode.txt` |
| DRV-06 | Report after booking + check-in | `200`, rates, `bdo_reports` row, `database` local / `s3` Floci | `booked:1, attended:1, turnout:100`, storage as expected in both smoke runs | PASS | report JSON + S3 object key |
| DRV-07 | Create drive missing `title` | `400 VALIDATION_ERROR` | 400 in DR04 and smoke | PASS | `curl -i` output |
| DRV-08 | `GET /api/drives/drv_unknown` | `404 NOT_FOUND` | 404 in DR11 and smoke | PASS | `curl -i` output |
| DRV-09 | Organizer B tries `PUT /api/drives/:id` | `409 CONFLICT` | 409 in DR05 | PASS | two JWTs + response |
| DRV-10 | Two overlapping slots | second `409 CONFLICT` | 409 in DR06 | PASS | response + slot list |
| DRV-11 | Reserve a full slot twice via internal endpoint | first `200`, second `409`; `booked` ≤ `capacity` | Verified in DR08; DynamoDB arithmetic condition fixed with read-compare-update retry | PASS | responses + slot row before/after |
| DRV-12 | Cancel drive after bookings | bookings cancelled, seats reset; delete blocked while bookings active | DR10/DR12 and IN01 | PASS | booking/slot rows + responses |
| DRV-13 | PATCH `completed` on a future drive | `409 CONFLICT` | 409 in DR10 | PASS | response |

## 3. Donor service — Tasneem

| ID | Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| DON-01 | Register a donor with valid profile | `201`, JWT, `bdo_users` + `bdo_donors` rows | 201 in DN01, smoke and Floci smoke | PASS | response + rows |
| DON-02 | Register organizer with correct invite | `201`, role `organizer` | 201 in DN03 and both smoke runs | PASS | response + user row |
| DON-03 | Login with correct password | `200`, JWT verifies | 200 in DN04 and both smoke runs | PASS | decoded token + response (redacted in evidence) |
| DON-04 | `GET /api/auth/me` with JWT | `200 {user}` without passwordHash | 200 in DN04 | PASS | response |
| DON-05 | Eligibility for adult, 68 kg, no donations | `eligible:true` | 200 and `eligible:true` in DN06 and both smoke runs | PASS | response |
| DON-06 | Eligibility 20 days after last donation | `eligible:false`, 56-day reason | 200 with 56-day rule in DN06 | PASS | response with `?date=` |
| DON-07 | Update donor profile | `200`, `updatedAt`, eligibility recalculated | 200 in DN05 | PASS | before/after rows + response |
| DON-08 | Donation history after check-in | `200`, count ≥ 1 | `count:1` in both smoke runs | PASS | response + `bdo_donations` row |
| DON-09 | Duplicate email registration | `409 CONFLICT` | 409 in DN02 and both smoke runs | PASS | two responses |
| DON-10 | Wrong password login | `401 UNAUTHORIZED` | 401 in DN04 | PASS | `curl -i` output |
| DON-11 | No token on `GET /api/donors/me` | `401 UNAUTHORIZED` | 401 in DN05 | PASS | `curl -i` output |
| DON-12 | Donor tries organizer-only route | `403 FORBIDDEN` | 403 in BK02/DR03 and smoke | PASS | response with donor JWT |
| DON-13 | Invalid profile: weight 40 kg or blood type `Z+` | `400 VALIDATION_ERROR` | 400 in DN02/DN05 and SR13 | PASS | request + response |
| DON-14 | More than 8 logins in 10 minutes | `429 RATE_LIMIT` | Attempts 1–8 returned `401`, attempt 9 returned `429 RATE_LIMIT` | PASS | `evidence/DON-14-rate-limit.txt`, `tests/pending-evidence.test.js` |
| DON-15 | Delete account with active booking | `409 CONFLICT` | 409 in DN09 | PASS | response + booking row |
| DON-16 | Turnstile configured but token missing | `401 UNAUTHORIZED` with bot-check message | With `TEST_MODE` off and a dummy secret (the branch returns before any Cloudflare call), register without token returned `401` and created no user | PASS for missing-token branch; real widget-token validation still needs a live Turnstile key | `evidence/DON-16-turnstile-missing-token.txt`, `tests/pending-evidence.test.js` |

## 4. Booking service — Hala

| ID | Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| BOK-01 | `GET /api/health/booking` | `200 {status:"ok", service:"booking"}` | 200 locally and on Floci | PASS | health curl + Floci check output |
| BOK-02 | Eligible donor books an open slot | `201`, id `driveId__donorId`, status `confirmed`, seat +1, email row | 201 in BK01, IN01 and both smoke runs | PASS | responses + booking/slot/reminder rows |
| BOK-03 | `GET /api/bookings/mine` | `200`, sorted by drive date | 200 in BK04 and both smoke runs | PASS | response |
| BOK-04 | Organizer `GET /api/bookings?driveId=…` | `200`, only that drive’s bookings | 200 in BK05 and both smoke runs | PASS | response |
| BOK-05 | Donor cancels booking | `200`, status `cancelled`, seat released, email logged | 200 in BK06, IN01 | PASS | before/after rows + response |
| BOK-06 | Organizer check-in `attended` | `200`, donation created, donor date updated | 200 in BK07, IN01 and both smoke runs | PASS | booking + donation + donor rows |
| BOK-07 | Organizer check-in `no_show` | `200`, status `no_show`, no donation | 200 in BK07 | PASS | response + DB query |
| BOK-08 | Repeat same check-in outcome | `200 "already recorded"`, no duplicate donation | 200 in BK07 | PASS | two responses + donation count |
| BOK-09 | Send reminders for a date | second run increases `skipped`, `sent` stays 0 | `1 sent, 1 skipped on repeat` in both smoke runs; BK08 | PASS | two responses + reminder rows |
| BOK-10 | `GET /api/reminders` as organizer | `200`, log filtered to own drive | 200 in BK08 | PASS | response |
| BOK-11 | Ineligible donor books | `409` with eligibility reason, no seat reserved | 409 in BK03 and SR11/SR15 | PASS | responses + rows |
| BOK-12 | Full slot booking | `409 "This slot is full"` | 409 in BK03 | PASS | responses + slot row |
| BOK-13 | Double booking for the same drive | second `409` | 409 in BK01 and both smoke runs | PASS | two responses |
| BOK-14 | Unknown booking id on cancel | `400` for bad id / `409` for unknown valid id | 400/409 in BK06 | PASS | `curl -i` output |
| BOK-15 | Donor calls organizer check-in | `403 FORBIDDEN` | 403 in BK07 | PASS | response with donor JWT |
| BOK-16 | Wrong `outcome` value | `400 VALIDATION_ERROR` | 400 in BK07 | PASS | response |
| BOK-17 | Organizer B views organizer A’s bookings | `403 FORBIDDEN` | 403 in BK05 | PASS | response |
| BOK-18 | Internal endpoint without `x-internal-key` | `401 UNAUTHORIZED` | 401 in BK09 | PASS | `curl -i` output |
| BOK-19 | Daily internal reminder route with key | `200` counts, idempotent | 200 in BK09; EventBridge rule and Worker cron wired | PASS | response + rows |

## 5. End-to-end (all three services)

| ID | Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| E2E-01 | Drive + slots → register → book → email → check-in → report | Full journey, consistent seat/donation/report | IN01 plus 22/22 local, 22/22 Floci and 22/22 public Cloudflare/Neon smoke | PASS | API responses + DB rows; `evidence/PUBLIC-SMOKE.txt` |
| E2E-02 | Remove JWT mid-journey before booking | `401`, no booking or seat change | 401 in IN02 and both smoke runs | PASS | response + seat count |
| E2E-03 | Cancel drive after a booking | booking `cancelled`, seat `booked:0`, email logged | DR10/DR12 + IN01/BK06 | PASS | three service responses + rows |
| E2E-04 | Frontend shows `3/3 services online` and live counts | Green footer, counts change after booking | Headless Chrome rendered `3/3 services online` in green on the home and `#/drives` pages; the drives page displays a live API drive with `20 seats`. Seat-count changes after booking are covered by BOK-02 and the smoke runs | PASS | `evidence/E2E-04-home.png`, `evidence/E2E-04-drives.png`; DOM excerpt `<span id="systemStatus" style="color: var(--green);">3/3 services online</span>` |
| E2E-05 | Reminder run for drive date | first `sent`/`dev-log`, second `skipped` | 1 sent + 1 skipped in both smoke runs | PASS | responses + reminder log |
| E2E-06 | Repeat E2E-01 on public Cloudflare URL | Same result with Worker URLs and Neon rows | 22/22 PASS against the three public Workers with Neon; booking 201/409, reminders 1 sent + 1 skipped, check-in `attended`, donation + report rows; report `storage:"database"` | PASS | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png` |

## 6. Evidence guidance for the report

* Generated request/response evidence for DRV-05, DON-14 and DON-16 is committed under [`evidence/`](evidence/); regenerate it with `npm run evidence:capture`. Public deployment, public smoke and public browser evidence are `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt` and `evidence/PUBLIC-E2E-*.png`.
* Put one request and one response per endpoint into the relevant individual statement; use `curl -i` or Postman’s “Copy as cURL”.
* Save screenshots/JSON files named with the test ID, e.g. `evidence/BOK-06-checkin.png`.
* Mark a row PASS only from an observed result; `PENDING` above means the capability exists but evidence has not been captured.
* Keep invalid-case evidence for `400`, `401`, `403`, `404`, `409`, `429` and `502` as required by the brief.
* Do not include real `JWT_SECRET`, `INTERNAL_KEY`, `RESEND_API_KEY`/`BREVO_API_KEY`, `TURNSTILE_SECRET` or a real JWT in a screenshot. Redact tokens after capturing the status code.
