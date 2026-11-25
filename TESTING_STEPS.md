# Testing steps — Blood Donation Drive Organizer

Follow these steps in order. They use the **real APIs** (no hard-coded frontend data), so every
screen and status code can be reproduced from the command line. Commands are written for
**Windows PowerShell**; `curl.exe` is used explicitly because PowerShell's `curl` alias is
`Invoke-WebRequest`.

Use a fresh email address each time you repeat the whole run (the examples use a timestamp).
Local `TEST_MODE=1` skips Turnstile and `EMAIL_MODE=log` records emails instead of sending them.

---

## Step 1 — Base checks (2 minutes)

```powershell
node --version          # must be 22 or newer
npm install
npm test                # expect: 59 tests, 59 pass, 0 fail
npm run dev             # starts APIs on 3001/3002/3003 and SPA on 8090
```

In a second terminal:

```powershell
curl.exe -i http://localhost:3001/api/health/drive
curl.exe -i http://localhost:3002/api/health/donor
curl.exe -i http://localhost:3003/api/health/booking
curl.exe -i http://localhost:8090/
```

Expected: four `HTTP/1.1 200` responses; health bodies contain
`{"status":"ok","service":"drive|donor|booking",...}`.

Create demo data (prints the logins and drive ID — save them):

```powershell
npm run seed
```

Open **http://localhost:8090** and confirm the footer says **3/3 services online**.

---

## Step 2 — Manual API journey (10 minutes)

Set shortcuts once per terminal session:

```powershell
$DRIVE   = 'http://localhost:3001'
$DONOR   = 'http://localhost:3002'
$BOOKING = 'http://localhost:3003'
$INVITE  = 'blood2026'
$stamp   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString().Substring(7)
$orgMail = "org$stamp@demo.org"
$dnrMail = "donor$stamp@demo.org"
$password = 'DemoPass123!'
$driveDate = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
```

### 2.1 Register an organizer and a donor

```powershell
$org = curl.exe -s -X POST "$DONOR/api/auth/register" -H 'Content-Type: application/json' `
  --data-raw "{`"name`":`"Test Organizer`",`"email`":`"org$stamp@demo.org`",`"password`":`"$password`",`"role`":`"organizer`",`"inviteCode`":`"$INVITE`"}" | ConvertFrom-Json
$orgToken = $org.token
$org.user.role        # organizer

$dnr = curl.exe -s -X POST "$DONOR/api/auth/register" -H 'Content-Type: application/json' `
  --data-raw "{`"name`":`"Test Donor`",`"email`":`"donor$stamp@demo.org`",`"password`":`"$password`",`"role`":`"donor`",`"bloodType`":`"O+`",`"weightKg`":68,`"birthYear`":1998}" | ConvertFrom-Json
$donorToken = $dnr.token
$dnr.user.role        # donor
```

Expected: both `201` with a JWT. Check `GET $DONOR/api/auth/me` with each token; the user object
must **not** contain `passwordHash`.

### 2.2 Create a drive and slots (Habiba)

```powershell
$driveBody = @{ title='API Test Drive'; venue='Kuwait City'; city='Kuwait'; date=$driveDate; description='Created by curl' } | ConvertTo-Json -Compress
$drive = curl.exe -s -X POST "$DRIVE/api/drives" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $driveBody | ConvertFrom-Json
$drive.id; $drive.status        # drv_... , scheduled

$slot = curl.exe -s -X POST "$DRIVE/api/drives/$($drive.id)/slots" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" `
  --data-raw '{"startTime":"09:00","endTime":"11:00","capacity":2}' | ConvertFrom-Json
$slot.id; $slot.booked          # slt_... , 0

curl.exe -s "$DRIVE/api/drives?city=kuwait&status=scheduled"
curl.exe -s "$DRIVE/api/drives?near=Kuwait%20City&radius=25"
```

Expected: the drive appears in both list responses; the `near` result includes `distanceKm`.

### 2.3 Eligibility (Tasneem)

```powershell
curl.exe -s "$DONOR/api/donors/me/eligibility?date=$driveDate" -H "Authorization: Bearer $donorToken"
```

Expected: `eligible: true` for a 1998-born, 68 kg donor with no previous donations.

### 2.4 Book, duplicate, list (Hala)

```powershell
$bookBody = @{ driveId=$drive.id; slotId=$slot.id } | ConvertTo-Json -Compress
$booking = curl.exe -s -X POST "$BOOKING/api/bookings" -H 'Content-Type: application/json' -H "Authorization: Bearer $donorToken" --data-raw $bookBody | ConvertFrom-Json
$booking.booking.id             # drv_...__donor...__@
$booking.booking.status         # confirmed

# second booking for the same donor/drive must fail
curl.exe -i -X POST "$BOOKING/api/bookings" -H 'Content-Type: application/json' -H "Authorization: Bearer $donorToken" --data-raw $bookBody

curl.exe -s "$BOOKING/api/bookings/mine" -H "Authorization: Bearer $donorToken"
curl.exe -s "$BOOKING/api/bookings?driveId=$($drive.id)" -H "Authorization: Bearer $orgToken"
```

Expected: first `201`, second `409 CONFLICT`, both lists show one booking. Verify the slot now has
`booked:1` via `GET $DRIVE/api/drives/$($drive.id)`.

### 2.5 Reminder idempotency

```powershell
$dateBody = @{ date=$driveDate } | ConvertTo-Json -Compress
curl.exe -s -X POST "$BOOKING/api/reminders/send" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $dateBody
curl.exe -s -X POST "$BOOKING/api/reminders/send" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw $dateBody
curl.exe -s "$BOOKING/api/reminders" -H "Authorization: Bearer $orgToken"
```

Expected: first run `sent:1, skipped:0`; second run `sent:0, skipped:1`; log shows two rows with
different ids and the same dedup key.

### 2.6 Check-in → donation → report

```powershell
$bookingId = "$($drive.id)__$dnrMail"
curl.exe -s -X PATCH "$BOOKING/api/bookings/$bookingId/check-in" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw '{"outcome":"attended"}'
curl.exe -s -X PATCH "$BOOKING/api/bookings/$bookingId/check-in" -H 'Content-Type: application/json' -H "Authorization: Bearer $orgToken" --data-raw '{"outcome":"attended"}'
curl.exe -s "$DONOR/api/donors/me/donations" -H "Authorization: Bearer $donorToken"
curl.exe -s "$DRIVE/api/drives/$($drive.id)/report" -H "Authorization: Bearer $orgToken"
curl.exe -s "$DRIVE/api/drives/$($drive.id)/reports" -H "Authorization: Bearer $orgToken"
```

Expected: first check-in `200`, repeat `200 "already recorded"` with **one** donation row; report
has `booked:1, attended:1, turnoutRate:100`, `storage:"database"` locally (`"s3"` on Floci).

### 2.7 Cancel flow (use a second donor/drive or repeat from 2.1)

1. Register a new donor, book a seat.
2. `POST $BOOKING/api/bookings/<id>/cancel` with the donor token → `200`, seat released.
3. `DELETE $DRIVE/api/drives/$($drive.id)/slots/$($slot.id)` → `204` only when `booked:0`.
4. `PATCH $DRIVE/api/drives/$($drive.id)/status` with `{"status":"cancelled"}` → related bookings
   cancelled and seats reset.
5. `DELETE $DRIVE/api/drives/$($drive.id)` → `409` while a booking is active, `204` after cancellation.

---

## Step 3 — Error cases (5 minutes)

| Test | Command (abbreviated) | Expected |
|---|---|---|
| Missing field | `POST $DRIVE/api/drives` with `{}` + org token | `400 VALIDATION_ERROR` |
| Unknown drive | `GET $DRIVE/api/drives/drv_unknown` | `404 NOT_FOUND` |
| Wrong owner | Organizer B `PUT $DRIVE/api/drives/{id}` | `409 CONFLICT` |
| Overlap | second slot `09:30–10:30` | `409 CONFLICT` |
| Full slot | capacity 1, two different donors | second `409` |
| Ineligible donor | donor with `weightKg:40` books | `409` with eligibility reason |
| No token | `GET $DONOR/api/donors/me` | `401 UNAUTHORIZED` |
| Wrong role | donor `PATCH .../check-in` | `403 FORBIDDEN` |
| Duplicate email | register same email twice | `409 CONFLICT` |
| Wrong password | login with wrong password | `401 UNAUTHORIZED` |
| Bad outcome | check-in with `{"outcome":"maybe"}` | `400 VALIDATION_ERROR` |
| Missing internal key | `GET $BOOKING/internal/drives/{id}/stats` without header | `401 UNAUTHORIZED` |
| Rate limit | 9 logins from one IP in 10 min | 8×`401`, 9th `429 RATE_LIMIT` |
| Turnstile missing token | with secret configured, register without token | `401` bot-check message |

The last two are already captured in `evidence/DON-14-rate-limit.txt` and
`evidence/DON-16-turnstile-missing-token.txt`; regenerate them with `npm run evidence:capture`.

---

## Step 4 — Browser UI (5 minutes)

1. Open http://localhost:8090 — footer must show **3/3 services online**.
2. Log in with the seeded organizer → **Organizer dashboard**: create a drive, add two slots.
3. Open **Report** and **Emails** tabs; generate a report and send a reminder twice.
4. Log out, log in as the seeded donor → **Find a donation drive** → open the drive → **Book seat**.
5. **My bookings** shows the confirmed booking and a working **Cancel** button.
6. Organizer → **Bookings** tab → **Attended** / **No-show** buttons update the row.
7. Log in as donor → **Profile** shows eligibility banner, donation timeline and edit form.
8. Take screenshots of each screen for the individual statements.

---

## Step 5 — Database rows (2 minutes)

```powershell
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('.data/bdo.sqlite');for(const t of ['bdo_users','bdo_donors','bdo_drives','bdo_slots','bdo_bookings','bdo_reminders','bdo_donations','bdo_reports','bdo_geocodes']){console.log('\n'+t, db.prepare('select count(*) c from '+t).get().c);console.log(db.prepare('select data from '+t+' limit 1').all())}"
```

Check that a booking row changed from `confirmed` to `attended`, a donation row was created, a
reminder row exists for each send attempt, and `bdo_geocodes` contains the live Nominatim rows.

---

## Step 6 — Automated/repeatable full journeys

```powershell
npm run smoke                                         # local: expect 22/22 PASS
# Floci (after deployment), API URL is in infra/.state:
$env:BDO_API_URL='http://079d67cedb.execute-api.localhost.floci.io:4566'
npm run smoke                                         # expect 22/22 PASS, storage:"s3"
bash infra/check.sh                                   # expect all PASS / ALL CHECKS PASSED

# Public Cloudflare Workers (separate URLs):
$env:BDO_API_URL=''
$env:BDO_DRIVE_URL='https://bdo-drive.<account>.workers.dev'
$env:BDO_DONOR_URL='https://bdo-donor.<account>.workers.dev'
$env:BDO_BOOKING_URL='https://bdo-booking.<account>.workers.dev'
npm run smoke                                         # expect 22/22 PASS
```

---

## Step 7 — Deployed public system

The public deployment is already live (see `FINALIZATION_README.md` section 3):

```text
Website: https://bdo-organizer.sumptuous-william.workers.dev
Drive:   https://bdo-drive.sumptuous-william.workers.dev
Donor:   https://bdo-donor.sumptuous-william.workers.dev
Booking: https://bdo-booking.sumptuous-william.workers.dev
```

```powershell
curl.exe -i https://bdo-drive.sumptuous-william.workers.dev/api/health/drive
curl.exe -i https://bdo-donor.sumptuous-william.workers.dev/api/health/donor
curl.exe -i https://bdo-booking.sumptuous-william.workers.dev/api/health/booking
```

Expected: HTTP 200 for all three, with `Access-Control-Allow-Origin: https://bdo-organizer.sumptuous-william.workers.dev`.

Run the whole automated public journey (already captured in `evidence/PUBLIC-SMOKE.txt`):

```powershell
$env:BDO_API_URL=''
$env:BDO_DRIVE_URL='https://bdo-drive.sumptuous-william.workers.dev'
$env:BDO_DONOR_URL='https://bdo-donor.sumptuous-william.workers.dev'
$env:BDO_BOOKING_URL='https://bdo-booking.sumptuous-william.workers.dev'
$env:ORGANIZER_INVITE='blood2026'
npm run smoke
```

Expected: `SMOKE: 22/22 PASS`. Then repeat **Steps 2, 4 and 5** in the browser at the public website
(already captured on the home/drives pages in `evidence/PUBLIC-E2E-*.png`), confirm on a phone, and
capture Neon SQL screenshots. The temporary Cloudflare account must be claimed with the one-time
link supplied outside the repository, or the public URLs may expire.

---

## Step 8 — Evidence to save

| Folder/file | Content |
|---|---|
| `evidence/` | already generated geocode, 429, Turnstile and browser screenshots |
| `evidence/API-*.txt` | one request + response per endpoint from Steps 2–3 |
| Screenshots | Organizer tabs, register/profile/bookings screens, footer 3/3, Neon rows, Floci dashboard, Cloudflare Workers/Pages/Cron |
| Terminal output | `npm test`, both smoke runs, `bash infra/check.sh`, `npm run deploy:cloudflare` |
| GitHub | PR links, merge commit hashes, `v1.0` tag |

Redact JWTs, `INTERNAL_KEY`, `DATABASE_URL`, `RESEND_API_KEY`/`BREVO_API_KEY`, `TURNSTILE_SECRET` and invite codes
from every screenshot before adding it to the report.

---

## Quick pass/fail checklist

- [ ] `npm test` → 59/59
- [ ] Local smoke → 22/22
- [ ] Floci smoke → 22/22, `storage:"s3"`
- [ ] All health endpoints → 200
- [ ] Full journey: drive → slot → book → reminder → check-in → report
- [ ] Every error row in Step 3 returns the expected status
- [ ] Browser footer → 3/3 and screens match API state
- [ ] Public URL works from laptop and phone
- [ ] No secret appears in any evidence file
