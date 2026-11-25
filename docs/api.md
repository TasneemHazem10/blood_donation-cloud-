# API reference

This document lists **every route defined in the three `routes.js` files**. It is derived from the source, not from a design sketch.

## 1. Conventions

### Base URLs

| Environment | Drive | Donor | Booking |
| --- | --- | --- | --- |
| Local (`npm run dev`) | `http://localhost:3001` | `http://localhost:3002` | `http://localhost:3003` |
| Floci | one API Gateway base URL from `infra/.state` (`API_URL`), routes dispatch by path | same | same |
| Cloudflare Workers | `https://bdo-drive.sumptuous-william.workers.dev` | `https://bdo-donor.sumptuous-william.workers.dev` | `https://bdo-booking.sumptuous-william.workers.dev` |

On Floci all three services share one front door; on Workers and locally each service has its own base URL configured through `DRIVE_SERVICE_URL`, `DONOR_SERVICE_URL`, `BOOKING_SERVICE_URL` (or `window.BDO.services` in the browser).

### Common request rules (`shared/router.js`, `shared/http.js`, `shared/validate.js`)

* JSON request bodies for `POST`, `PUT`, `PATCH`; body text is capped at **20 KB**. Invalid JSON → `400 VALIDATION_ERROR`.
* `Authorization: Bearer <JWT>` is required where **Auth** is marked. Roles are checked from the JWT payload (`role: donor | organizer`).
* `/internal/*` routes require **`x-internal-key: <INTERNAL_KEY>`**; a missing/wrong key → `401 UNAUTHORIZED`.
* `OPTIONS` any path → `204` with CORS headers. Unknown method/path → `404 NOT_FOUND`.
* Responses are JSON except `204`, which has an empty body. Standard security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`) are added by `corsHeaders()`.
* Error envelope: `{ "error": { "code": "...", "message": "..." } }`.

| HTTP status | Code | Meaning / typical cause |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing/invalid field, bad JSON, bad query filter, bad id |
| 401 | `UNAUTHORIZED` | No/invalid/expired JWT, wrong internal key, failed Turnstile |
| 403 | `FORBIDDEN` | Correct token but wrong role or wrong owner |
| 404 | `NOT_FOUND` | Unknown endpoint or missing record (some handlers use `409` instead — see rows) |
| 409 | `CONFLICT` | Duplicate email/booking, full slot, illegal state transition, ownership conflict |
| 429 | `RATE_LIMIT` | More than 8 login/register attempts in 10 minutes (Donor service only) |
| 502 | `UPSTREAM_ERROR` / `SERVICE_UNAVAILABLE` | Nominatim/Turnstile failed, or another service unreachable/erroring |
| 500 | `INTERNAL_ERROR` | Unhandled exception (logged server-side) |

### Validation helpers

`stringField` (length), `numberField`, `enumField`, `emailField`, `dateField` (`YYYY-MM-DD` real date), `isTime` (`HH:MM`, 24-hour), `idParam` (`^[A-Za-z0-9_.@+-]{1,200}$`). `idParam` accepts booking ids such as `drv_...__donor@example.org` because the regex includes `_`; the status codes and validation rules in this section remain in force. On Lambda, `serverless-http` Buffer bodies are normalized before JSON parsing so Express 5 receives a plain object. Service-specific rules live in `services/drive/services/driveRules.js`, `services/donor/services/eligibility.js` and `services/booking/services/bookingRules.js`.

---

## 2. Drive service — Habiba (`services/drive/routes.js`)

| Method & path | Access | Input | Validation / business rules | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health/drive` | Public | — | — | `200 { status:"ok", service:"drive", time:<ISO> }` | — |
| `GET /api/drives` | Public | Query: `city`, `status`, `dateFrom`, `dateTo`, `near`, `radius` | `city` substring (case-insensitive); `status` ∈ `scheduled/cancelled/completed`; dates valid; `near` geocoded by Nominatim then haversine filter; `radius` 1–500 km (default 25). Sorted by date, or by distance when `near` | `200 { count, drives:[DriveWithSlots] }`; each slot gains `available = max(0, capacity - booked)` | `400` bad filter/radius; `502` geocoder unavailable |
| `POST /api/drives` | Auth: `organizer` | Body: `title`, `venue`, `city`, `date`, `description?` | `title` 3–120, `venue` 3–160, `city` 2–80, valid date, `description` ≤ 1000; venue+city geocoded (failure tolerated, coordinates `null`) | `201 Drive` with `id:drv_<uuid>`, `organizerId`, `organizerName`, `status:"scheduled"`, `lat`, `lon`, `locationLabel`, `createdAt` | `401`, `403`, `400` |
| `GET /api/drives/:id` | Public | Path `id` | `idParam`; drive must exist | `200 DriveWithSlots` (slots sorted by `startTime`) | `400` bad id, `404` drive not found |
| `PUT /api/drives/:id` | Auth: `organizer` | Path `id`; body: any editable drive fields | Owner check (`organizerId === user.id`), drive must be `scheduled`, merged input revalidated as for create; address change re-geocodes | `200 Drive` | `401`, `403`, `409` not owner/not editable, `404`, `400` |
| `PATCH /api/drives/:id/status` | Auth: `organizer` | Path `id`; body: `{ status }` | `status` ∈ three values; owner; only from `scheduled`; cannot set `scheduled`; `completed` only on/before drive date; `cancelled` calls Booking cancellations and resets all slot `booked` to 0 | `200 Drive` with `status`, `statusChangedAt` | `401`, `403`, `404`, `400`, `409` invalid transition, `502` if Booking call fails |
| `DELETE /api/drives/:id` | Auth: `organizer` | Path `id` | Owner; Booking `GET /internal/drives/:id/stats` must report `booked === 0`; removes related slots and reports, then drive | `204` empty | `401`, `403`, `404`, `409` still has bookings, `502` |
| `POST /api/drives/:id/slots` | Auth: `organizer` | Path `id`; body: `{ startTime, endTime, capacity }` | Owner + editable; times `HH:MM`, `startTime < endTime`, integer capacity 1–200; no overlapping slot on the drive | `201 Slot` with `id:slt_<uuid>`, `driveId`, `booked:0`, `createdAt` | `401`, `403`, `404`, `400`, `409` overlap |
| `PUT /api/drives/:id/slots/:slotId` | Auth: `organizer` | Path `id`, `slotId`; body: slot fields | Owner + editable; slot must belong to drive (`409` otherwise); merged validation; capacity ≥ current `booked`; no overlap with other slots | `200 Slot` | `401`, `403`, `404`, `400`, `409` |
| `DELETE /api/drives/:id/slots/:slotId` | Auth: `organizer` | Path `id`, `slotId` | Owner + editable; slot belongs to drive; `booked === 0` | `204` empty | `401`, `403`, `404`, `409` booked > 0 |
| `GET /api/drives/:id/report` | Auth: `organizer` | Path `id` | Owner; pulls Booking stats; computes `capacity`, `booked`, `attended`, `noShow`, `cancelled`, `fillRate`, `turnoutRate`, `noShowRate`; saves snapshot (S3 when `REPORTS_BUCKET` set, otherwise `database`) in `bdo_reports` | `200 Report` with `id:rpt_<uuid>`, `generatedAt`, `storage`, `location` | `401`, `403`, `404`, `502` |
| `GET /api/drives/:id/reports` | Auth: `organizer` | Path `id` | Owner; list snapshots for drive sorted by `generatedAt` descending | `200 { count, reports:[...] }` | `401`, `403`, `404` |
| `GET /internal/drives/:id` | Internal | Path `id` | `idParam`; drive must exist; returns live slots with `available` | `200 DriveWithSlots` | `401` wrong key, `400`, `404` |
| `POST /internal/drives/:id/slots/:slotId/reservation` | Internal | Path `id`, `slotId`; empty body `{}` | Drive must be `scheduled`; slot belongs to drive; **atomic** `reserveSeat(+1)`, fails if `booked + 1 > capacity` | `200 Slot` with incremented `booked` | `401`, `404`, `409` drive closed / slot mismatch / full |
| `DELETE /internal/drives/:id/slots/:slotId/reservation` | Internal | Path `id`, `slotId` | Slot belongs to drive; **atomic** `reserveSeat(-1)`, fails below 0 | `200 Slot` with decremented `booked` | `401`, `404`, `409` |

> `internalStats` and `internalCancellations` are exported from `services/drive/controllers/drives.js` but are **not registered in `routes.js`** and are not in `infra/gateway.sh`. They are not callable endpoints. Drive calls Booking's equivalents directly instead.

---

## 3. Donor service — Tasneem (`services/donor/routes.js`)

| Method & path | Access | Input | Validation / business rules | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health/donor` | Public | — | — | `200 { status:"ok", service:"donor", time:<ISO> }` | — |
| `POST /api/auth/register` | Public (Turnstile) | Body: `name`, `email`, `password`, `role?` (`donor` default / `organizer`), `inviteCode?` (organizer only), `bloodType`, `weightKg`, `birthYear`, `phone?` (donor) | Rate limit 8/10 min per IP; Turnstile when secret configured (skipped in `TEST_MODE`/development); email format; name 2–80; password 8–128; organizer invite must equal `ORGANIZER_INVITE`; donor profile: blood type ∈ 8 values, weight 30–300, birth year 1900–current, phone ≤ 30; email must be unused | `201 { token, user:{id,email,name,role,createdAt} }`; creates `bdo_users` (id = email) and `bdo_donors` | `400`, `401` bot check, `409` duplicate email/bad invite, `429`, `502` Turnstile |
| `POST /api/auth/login` | Public (Turnstile) | Body: `email`, `password`, `turnstileToken?` | Rate limit 8/10 min per email/IP; Turnstile; email format; password 1–128; PBKDF2-SHA256 verification of stored hash | `200 { token, user }`, JWT `HS256`, 7-day expiry | `400`, `401` bad credentials/bot check, `429`, `502` |
| `GET /api/auth/me` | Auth | — | Looks up user by JWT `id` | `200 { user }` | `401`, `404` account missing |
| `GET /api/donors/me` | Auth, role `donor` | — | Donor profile for JWT id; attaches `evaluate()` result | `200 { donor: {...profile, eligibility} }` | `401`, `403` organizer, `404` profile missing |
| `PUT /api/donors/me` | Auth, role `donor` | Body: any of `bloodType`, `weightKg`, `birthYear`, `phone` | Partial profile validation; at least one field must be supplied; stored via `update()` (adds `updatedAt`) | `200 { donor }` | `401`, `403`, `404`, `409` empty patch, `400` |
| `GET /api/donors/me/eligibility` | Auth, role `donor` | Query `date?` (default today) | Valid date; rules: age 18–65, weight ≥ 50 kg, ≥ `DONATION_INTERVAL_DAYS` (default 56) since last donation, not before `deferredUntil`; computes `nextEligibleDate` | `200 { eligible, reason, nextEligibleDate, evaluatedOn, age, weightKg, lastDonationDate, intervalDays }` (missing profile returns `eligible:false`, not 404) | `401`, `403`, `400` |
| `GET /api/donors/me/donations` | Auth, role `donor` | — | Search `bdo_donations` by `donorId`, sort by date descending | `200 { count, donations:[...] }` | `401`, `403` |
| `DELETE /api/donors/me` | Auth, role `donor` | — | Calls Booking `GET /internal/donors/:id/active-bookings`; refuses if `count > 0`; removes donations, donor profile and user record | `204` empty | `401`, `403`, `409` active bookings, `502` |
| `GET /internal/donors/:id/eligibility` | Internal | Path `id` (email); query `date?` | `idParam` + date validation; same eligibility rules | `200 { ...eligibility, donor:{id,name,email,bloodType} | null }` | `401`, `400` |
| `POST /internal/donations` | Internal | Body: `donorId`, `driveId`, `date`, `donationId?` | `idParam` on ids; valid date; existing `donationId` → idempotent `200 { donation, duplicate:true }`; donor must exist; stores donation and advances `lastDonationDate` when newer | `201 { donation, duplicate:false }` or `200` duplicate | `401`, `400`, `404`, `409` insert conflict |
| `GET /internal/donors/:id` | Internal | Path `id` | `idParam`; donor must exist | `200 { donor }` | `401`, `400`, `404` |

> Organizer accounts do not get a donor profile row. Booking falls back to the JWT name/email when `eligibility.donor` is `null`, but `assertBookable` still rejects an ineligible result, so organizers cannot book as donors in practice.

---

## 4. Booking service — Hala (`services/booking/routes.js`)

| Method & path | Access | Input | Validation / business rules | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health/booking` | Public | — | — | `200 { status:"ok", service:"booking", time:<ISO> }` | — |
| `POST /api/bookings` | Auth, role `donor` | Body: `driveId`, `slotId` | Ids match `^[A-Za-z0-9_.@+-]{1,160}$`; Drive internal GET; Donor internal eligibility on the drive date; drive `scheduled`, future date, donor eligible; slot exists; no `confirmed`/`attended` booking with id `driveId__donorId`; atomic seat reserve **before** insert; compensation releases seat if insert throws; confirmation email recorded | `201 { booking, message:"Seat reserved. Confirmation email recorded." }` | `401`, `403`, `400`, `409` ineligible/full/closed/duplicate, `502` upstream |
| `GET /api/bookings/mine` | Auth | — | Search by `donorId = user.id`; sort by `driveDate` | `200 { count, bookings:[...] }` | `401` |
| `GET /api/bookings` | Auth, role `organizer` | Query `driveId` (required) | `idParam` on `driveId`; role check; Drive internal GET and `drive.organizerId === user.id`; search by `driveId`, sort by `startTime` | `200 { count, bookings:[...] }` | `401`, `403`, `400`, `502` |
| `POST /api/bookings/:id/cancel` | Auth | Path `id`; body `{}` | Donor owner or organizer of the drive; status must be `confirmed`; compare-and-set to `cancelled`; release seat via Drive; cancellation email recorded | `200 { booking, message:"Booking cancelled and seat released." }` | `401`, `403`, `404` bad id, `409` not found/already cancelled/status changed, `502` |
| `PATCH /api/bookings/:id/check-in` | Auth, role `organizer` | Path `id`; body `{ outcome }` = `attended` \| `no_show` | Outcome enum; organizer must own the drive; status ∈ `confirmed/attended/no_show`; repeat same outcome is idempotent; `attended` first calls Donor `POST /internal/donations` with `donationId = booking.id`; then CAS booking status | `200 { booking, message:... }` | `401`, `403`, `400`, `404` bad id, `409` cancelled/changed, `502` |
| `POST /api/reminders/send` | Auth, role `organizer` | Body or query `date?` (default tomorrow) | Organizer role; date must be `YYYY-MM-DD`; selects `confirmed` bookings for that date owned by this organizer; idempotency key `bookingId#reminder#date`; records `bdo_reminders` rows and sends via Resend (Brevo fallback)/log | `200 { date, eligible, sent, skipped, failed, emailMode }` | `401`, `403`, `400` |
| `GET /api/reminders` | Auth, role `organizer` | — | Filters reminder log by `organizerId`, sorts by `scheduledFor` descending | `200 { count, reminders:[...] }` | `401`, `403` |
| `GET /internal/drives/:id/stats` | Internal | Path `id` | `idParam`; counts bookings for drive by status | `200 { booked, attended, noShow, cancelled, total }` (`booked` = `confirmed` count) | `401`, `400` |
| `POST /internal/drives/:id/cancellations` | Internal | Path `id`; body `{}` | CAS each `confirmed` booking to `cancelled` with `cancellationReason:"drive_cancelled"`; release each seat; send cancellation email; errors logged per booking, not fatal | `200 { driveId, cancelled, released }` | `401`, `400` |
| `GET /internal/donors/:id/active-bookings` | Internal | Path `id` | `idParam`; filters `status === confirmed` and `driveDate >= today` | `200 { count, bookings:[...] }` | `401`, `400` |
| `POST /internal/reminders/daily` | Internal | Body `date?` (default tomorrow) | Delegates to the same `sendForDate()` as the organizer button; date validated there | `200 { date, eligible, sent, skipped, failed, emailMode }` | `401`, `400` |

> Booking ids are `driveId__donorId`; `idParam()` accepts the `__` separator, so `POST /api/bookings/:id/cancel` and `PATCH /api/bookings/:id/check-in` work end to end. Standard status codes and validation remain as listed above; both smoke runs verify cancel/check-in with real ids.

> Daily reminders are wired on both clouds: Floci's EventBridge rule invokes the Booking Lambda, whose handler branches on `source === 'aws.events'` and calls `sendForDate()` directly; Cloudflare's Cron Trigger `0 6 * * *` calls `scheduled()` in `worker.js`. Both reuse the same idempotent logic as `POST /api/reminders/send` and `POST /internal/reminders/daily`. Execution evidence still needs to be captured from a deployed Worker.

---

## 5. Internal cross-service call map

| Caller | Callee | Endpoint | Purpose |
| --- | --- | --- | --- |
| Booking | Drive | `GET /internal/drives/:id` | Check status, organizer, venue/date and slot list before booking or listing |
| Booking | Drive | `POST /internal/drives/:id/slots/:slotId/reservation` | Atomically hold one seat |
| Booking | Drive | `DELETE /internal/drives/:id/slots/:slotId/reservation` | Release one seat on cancel / failed insert / drive cancellation |
| Booking | Donor | `GET /internal/donors/:id/eligibility?date=…` | Enforce eligibility on the drive date |
| Booking | Donor | `POST /internal/donations` | Record donation and update `lastDonationDate` on `attended` check-in |
| Drive | Booking | `GET /internal/drives/:id/stats` | Fill/turnout/no-show rates for the report |
| Drive | Booking | `POST /internal/drives/:id/cancellations` | Cancel all bookings and release seats when a drive is cancelled |
| Donor | Booking | `GET /internal/donors/:id/active-bookings` | Block account deletion while upcoming bookings exist |

`shared/serviceClient.js` adds `x-internal-key`, uses a 10 s timeout, and converts network failures to `502 SERVICE_UNAVAILABLE`. It propagates the upstream status, message and code.

---

## 6. Examples

Replace `<...>` placeholders with real local/dev values. `TEST_MODE=1` and `EMAIL_MODE=log` are set by `npm run dev`, so no Turnstile token or Resend key is needed locally.

### 6.1 Health and public drive search

```bash
curl -s http://localhost:3001/api/health/drive
curl -s 'http://localhost:3001/api/drives?city=Kuwait&status=scheduled&dateFrom=2026-11-01'
curl -s 'http://localhost:3001/api/drives?near=Salmiya&radius=25'
```

### 6.2 Register an organizer and a donor

```bash
curl -s -X POST http://localhost:3002/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Organizer","email":"organizer@example.org","password":"DemoPass123!","role":"organizer","inviteCode":"<ORGANIZER_INVITE>"}'

curl -s -X POST http://localhost:3002/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Donor","email":"donor@example.org","password":"DemoPass123!","role":"donor","bloodType":"O+","weightKg":68,"birthYear":1998}'
```

Both return `{ "token": "<JWT>", "user": {...} }`. Store the JWTs as shell variables:

```bash
ORG_JWT='<organizer-token>'
DONOR_JWT='<donor-token>'
```

### 6.3 Create a drive, add a slot, read availability

```bash
curl -s -X POST http://localhost:3001/api/drives \
  -H "authorization: Bearer $ORG_JWT" -H 'content-type: application/json' \
  -d '{"title":"Community Blood Drive","venue":"City Health Centre","city":"Kuwait City","date":"2026-12-01","description":"Demo"}'
# -> 201; copy the returned id into DRIVE_ID

curl -s -X POST "http://localhost:3001/api/drives/$DRIVE_ID/slots" \
  -H "authorization: Bearer $ORG_JWT" -H 'content-type: application/json' \
  -d '{"startTime":"09:00","endTime":"11:00","capacity":10}'
# -> 201; copy the returned id into SLOT_ID

curl -s "http://localhost:3001/api/drives/$DRIVE_ID" | jq '.slots'
```

### 6.4 Donor eligibility and booking

```bash
curl -s http://localhost:3002/api/donors/me/eligibility -H "authorization: Bearer $DONOR_JWT"

curl -s -X POST http://localhost:3003/api/bookings \
  -H "authorization: Bearer $DONOR_JWT" -H 'content-type: application/json' \
  -d "{\"driveId\":\"$DRIVE_ID\",\"slotId\":\"$SLOT_ID\"}"
# -> 201 { booking: { id: "drv_...__donor@example.org", status: "confirmed" }, message: ... }

curl -s http://localhost:3003/api/bookings/mine -H "authorization: Bearer $DONOR_JWT"
```

### 6.5 Organizer check-in, report and reminders

```bash
BOOKING_ID="$DRIVE_ID__donor@example.org"

curl -s -X PATCH "http://localhost:3003/api/bookings/$BOOKING_ID/check-in" \
  -H "authorization: Bearer $ORG_JWT" -H 'content-type: application/json' \
  -d '{"outcome":"attended"}'

curl -s "http://localhost:3001/api/drives/$DRIVE_ID/report" -H "authorization: Bearer $ORG_JWT"
curl -s -X POST http://localhost:3003/api/reminders/send \
  -H "authorization: Bearer $ORG_JWT" -H 'content-type: application/json' \
  -d '{"date":"2026-11-30"}'
curl -s http://localhost:3003/api/reminders -H "authorization: Bearer $ORG_JWT"
```

### 6.6 Internal calls (server-to-server) with `fetch`

```js
const INTERNAL_KEY = '<internal-key>';

const drive = await fetch(`http://localhost:3001/internal/drives/${driveId}`, {
  headers: { 'x-internal-key': INTERNAL_KEY }
}).then((r) => r.json());

await fetch(
  `http://localhost:3001/internal/drives/${driveId}/slots/${slotId}/reservation`,
  { method: 'POST', headers: { 'x-internal-key': INTERNAL_KEY }, body: '{}' }
);

const stats = await fetch(`http://localhost:3003/internal/drives/${driveId}/stats`, {
  headers: { 'x-internal-key': INTERNAL_KEY }
}).then((r) => r.json());
```

### 6.7 Invalid cases worth capturing as evidence

```bash
# 400: missing title
curl -i -X POST http://localhost:3001/api/drives -H "authorization: Bearer $ORG_JWT" \
  -H 'content-type: application/json' -d '{"venue":"Hall","city":"Kuwait City","date":"2026-12-01"}'

# 401: no token
curl -i http://localhost:3002/api/donors/me

# 403: donor trying to create a drive
curl -i -X POST http://localhost:3001/api/drives -H "authorization: Bearer $DONOR_JWT" \
  -H 'content-type: application/json' -d '{}'

# 404: unknown drive
curl -i http://localhost:3001/api/drives/drv_does-not-exist

# 409: full slot / duplicate email / double booking -> see service rule tables above
```

A machine-readable summary of these routes is in [`openapi.yaml`](openapi.yaml).
