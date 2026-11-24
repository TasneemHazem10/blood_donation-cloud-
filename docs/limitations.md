# Limitations, assumptions and improvements

This page is intentionally candid. It separates design trade-offs acceptable for a class project from work that still has to be completed before submission.

## 1. Assumptions

| Assumption | Consequence |
| --- | --- |
| Three students, one service each; shared `shared/` code changed only by PR | Each service is independently deployable, but all depend on the same store/router contract |
| Cloudflare + Neon are accepted by the instructor in place of the sample AWS lab | Keep the instructor's written confirmation as evidence (report section 6) |
| Class-sized data (tens of drives/bookings) | Full-table scans and in-memory filtering are acceptable; no indexes or pagination were added |
| Local demo uses development-only secrets | `TEST_MODE=1`, `EMAIL_MODE=log`, development JWT/internal keys and invite `blood2026` are set by `infra/scripts/dev-all.js`; they are not production-safe |
| Eligibility is a simplified rule set (age 18–65, ≥50 kg, 56-day interval, deferral date) | It is not medical advice and does not check haemoglobin, travel, medication or blood-type matching |
| Email addresses are stable user ids | Simplifies joins and JWT identity but exposes PII in records and booking ids (`driveId__donorId` contains the email) |

## 2. Open limitations

| # | Limitation / issue | Why it exists | Impact | Proposed improvement | Owner |
| --- | --- | --- | --- | --- | --- |
| L1 | **Local Git repository exists but has no remote, PRs, reviews, `v1.0` tag or per-student commits** (import commit `2139745` only) | Real GitHub handles/emails for Habiba and Hala were not available; the source tree was supplied without `.git` | Report section 7 and the individual statements cannot yet prove ownership; zip/video version cannot be tied to a tag | Add remote, protected `main`, one real commit per student on their `feature/*` branch, PR review, `git tag v1.0`, build zip and video from that tag; commands in `docs/git-workflow.md` | Habiba (lead) + all |
| L3 | **No real Cloudflare/Neon credentials, deployed URL or public proof yet** | No account keys are stored locally by design | Report section 6 has only placeholders; demo video cannot yet use a cloud URL | Create accounts, apply `infra/db/schema.sql`, set secrets with `wrangler secret put`, run `npm run deploy:cloudflare`, capture screenshots | Habiba + Hala |
| L6 | **No real Turnstile or Brevo credentials locally**; `TURNSTILE_SECRET` absent → development bypass, `EMAIL_MODE=log` → `EMAIL_DEV_LOG` only | Free-tier sign-up and keys must be created by a person; secrets must not live in the repo | No real bot-check or delivered email evidence from localhost | Create test keys, set Worker/Lambda secrets, switch `EMAIL_MODE` to a live value for one controlled reminder run, redact keys in evidence | Tasneem + Hala |
| L7 | **Free-tier delays/limits**: Neon compute can pause (cold start), Workers CPU budget is small, Nominatim asks for low request rates, Brevo free tier caps daily sends | Provider policies; no payment card used | First demo request may be slow; 60,000 PBKDF2 iterations could exceed Worker CPU in some accounts; high-volume tests are unsafe | Wake Neon before demo; measure PBKDF2 on the deployed Worker and lower `ITERATIONS` in `shared/crypto.js` if needed (stored hashes record their own count); rely on `bdo_geocodes` cache; do not loop-test email | All |
| L10 | **Booking is a saga, not a transaction**: seat reserve and booking insert are separate calls; compensation only on a thrown insert error | No distributed transaction across services | An instance crash between the two calls can leave an over-reserved slot until the drive is cancelled (which resets `booked` to 0) | Add a reconciliation job comparing `bdo_slots.booked` with confirmed bookings; or move seat counts into Booking | Hala |
| L11 | `store().update()` in SQLite/DynamoDB is read-then-write; the SQLite `cas()` implementation also reads before comparing | Simplicity of the document store interface | Concurrent edits could lose a patch; WAL prevents corruption, not lost updates | Use native conditional SQL/`UpdateExpression` for all `cas()` paths and add `version` fields | All |
| L12 | **Rate limiting is an in-memory `Map`** in `services/donor/services/authRateLimit.js` | No Redis/KV was added | Each Worker/Lambda instance has its own counter; limits are not global | Use Cloudflare WAF rate limiting or Upstash/Cloudflare KV | Tasneem |
| L13 | JWTs cannot be revoked before `exp` (7 days); logout only clears browser `localStorage` | Stateless HMAC tokens | Deleted/compromised tokens remain valid until expiry | Shorten lifetime, add token version per user, or introduce a revocation list | Tasneem |
| L14 | `GET /api/bookings/mine` only requires authentication, not the `donor` role | Router marks it `auth: true` | An organizer calling it receives an empty list rather than `403` | Add `roles:['donor']` to the route | Hala |
| L15 | `internalStats` and `internalCancellations` are exported but not routed in Drive | Leftover helpers after integration moved to Booking | Dead code; calling those paths yields `404` | Remove them or register them deliberately with internal-key protection | Habiba |
| L16 | `REMINDER_DAYS_AHEAD` is read in `shared/config.js` but unused; reminders always use “tomorrow” | Simplified implementation | Config value has no effect | Use it in `bookingRules.tomorrow()`/`sendForDate()` default | Hala |
| L20 | No pagination or indexes; DynamoDB `search()` is `Scan` + JS filter | Document-model simplicity | Slow and costly at scale | Add GSI/columns for `driveId`, `donorId`, `status`, `date`; paginate list endpoints | All |
| L21 | Personal data (email, name, phone, blood type) is stored in plain JSON documents | Class prototype, provider-managed encryption only | Not suitable for real medical use without consent, retention and access-control design | Minimise fields, add field-level encryption and documented retention policy | Tasneem |
| L22 | Demo video, submission code zip and repository link do not exist yet | Final phase not complete | Sections 7–8 of the report cannot be filled | Freeze code, tag `v1.0`, zip that tag, record ≤5-minute video from the public URL | Tasneem (video) + Habiba (repo/zip) |
| L25 | Browser-level frontend evidence (`3/3 services online`, live counts) is not captured | Smoke tests call APIs, not the DOM | E2E-04 is PENDING | Take a browser screenshot from the deployed URL after the public deployment | All |

## 3. Resolved during the rebuild

| # | Former issue | Resolution |
| --- | --- | --- |
| L2 | `infra/scripts/configure-cloudflare.js` missing | Script added; `npm run deploy:cloudflare` generates the frontend config from env vars |
| L4 | Cloudflare cron not implemented | `services/booking/wrangler.toml` has `[triggers] crons = ["0 6 * * *"]` and `worker.js` exports `scheduled()` |
| L5 | EventBridge event not handled by Booking Lambda | `lambda.js` branches on `source === 'aws.events'` and runs `sendForDate()` |
| L8 | `bdo_geocodes` table missing on Floci | Added to the drive service table loop |
| L9 | Missing `lambda:InvokeFunction` in IAM | Added to Drive and Donor policies |
| L17 | Seed printed port 8080 | Message updated to **8090** |
| L18 | No automated tests | `tests/` contains 53 tests; `npm test` → 53 pass, 0 fail |
| L19 | Cloudflare config/CORS manual or hard-coded | Generated config script added; set the real hostname/CORS origins when credentials exist |
| L23 | Booking ids with `::` rejected by `idParam()` | Separator changed to `__`, validator accepts it, cancel/check-in verified in BK06/BK07 and both smoke runs |
| L24 | Live `?near=<place>` geocoding was only tested with `TEST_MODE=1` | `npm run evidence:capture` calls Nominatim outside test mode, creates a drive with real coordinates and captures `?near=Kuwait City&radius=25` plus two cached rows in `evidence/DRV-05-live-geocode.txt` |
| L26 | Windows spaces broke `fileb://` and `s3 cp` paths | Service/frontend scripts `cd` to the project root and use relative paths |
| L27 | Floci Lambdas used `localhost:4566` for AWS SDK calls | `AWS_ENDPOINT_LAMBDA=http://floci:4566` uses Docker DNS; verification passes |
| L28 | Express 5 did not parse Lambda bodies supplied as Buffers | `normalizeServerlessBody()` in `shared/router.js`; Floci register/login/booking verified |
| L29 | DynamoDB rejected arithmetic in a condition expression | `reserveSeat()` now reads, checks capacity and updates with a compare condition and retry |
| L30 | S3 report upload used virtual-host addressing on Floci | `forcePathStyle: true` when a custom endpoint is set; Floci report shows `storage:"s3"` |

## 4. Explicitly out of scope

* Real blood-bank/clinical eligibility verification, blood-type matching or medical records integration.
* Payments, SMS notifications, mobile app, multi-language UI, admin audit dashboard.
* Production-grade secrets management (vault), mTLS between services, or a full observability stack beyond logs.
* Automated cloud provisioning for Cloudflare (no Terraform/Pulumi; `wrangler` + manual dashboard steps only).

## 5. Priority order before submission

1. **L1 and L22** — Git ownership evidence, `v1.0` tag, submission zip and demo video (required by the brief).
2. **L3 and L6** — Cloudflare/Neon public deployment plus real Turnstile/Brevo keys when available.
3. **L24/L25** — capture the live geocode response and browser screenshots.
4. **L10/L11** — reconciliation job and atomic `cas()` paths if time allows.
5. Note L12–L21, L7 honestly in report section 10; none blocks the local/Floci demo.
