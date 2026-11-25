# Technical notes (chronological)

These are the build notes and difficulties encountered while assembling the rebuilt project. Real calendar dates were not recorded in the source tree, so entries are ordered by development phase; add dates from team chat/history when completing the report. Each entry states what was observed, what was changed and the current status.

---

### Entry 1 — Requirement reconciliation (foundation)

* **Observation:** the requirements sample lab uses a local AWS emulator, while the final-phase plan asks for a public Cloudflare URL. The repository must support both.
* **Decision:** keep one set of controllers and swap only the entry point and store: Express + SQLite locally, Express/serverless-http + DynamoDB on Floci, Workers + Neon in production. `shared/context.js` injects the store; `shared/config.js` reads env or Worker bindings.
* **Status:** implemented in code. Instructor confirmation of Cloudflare + Neon is still an evidence screenshot to collect.

### Entry 2 — Service ports and the 8080 → 8090 conflict

* **Problem:** the website was initially intended for `http://localhost:8080`, but port 8080 was already occupied on the development machine, so the static server could not start.
* **Fix:** `infra/scripts/dev-all.js` now listens on **http://localhost:8090** and prints the new URL. The three APIs stayed on **3001 (drive), 3002 (donor), 3003 (booking)**, and `CORS_ORIGINS` was set to `http://localhost:8090` in `dev-all.js` and `.env.example`. `frontend/js/config.js` records `localWebsite: 'http://localhost:8090'`.
* **Status:** fixed; `infra/scripts/seed.js` now also prints 8090.

### Entry 3 — SQLite WAL locking with three processes

* **Problem:** running drive, donor and booking simultaneously against `.data/bdo.sqlite` produced intermittent `database is locked` errors while each process created its tables at startup.
* **Observation:** three `DatabaseSync` connections initialised `CREATE TABLE IF NOT EXISTS` at nearly the same moment; the rollback journal serialised writers too aggressively.
* **Fix:** in `shared/store/sqlite.js`:

  ```js
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  ```

  WAL lets readers and initialising writers coexist; the busy timeout absorbs short contention.
* **Status:** fixed locally; confirmed by health endpoints and the full smoke flow. WAL does not make `get + put` updates atomic (see L11).

### Entry 4 — One router contract for Express and Workers

* **Problem:** writing controllers twice (once for `req/res`, once for Workers' `Request`) would drift.
* **Fix:** `shared/router.js` defines `route(method, path, handler, options)`; controllers receive a plain `ctx` (`params`, `query`, `body`, `headers`, `ip`, `user`) and return `{ status, body }`. `mountExpress()` adapts Express; `workerFetch()` adapts Workers. Both apply the same auth/internal-key checks, CORS/security headers, 20 KB body limit and error envelope.
* **Status:** implemented; all three services' `routes.js` files are the single source of truth for `docs/api.md` and `docs/openapi.yaml`.

### Entry 5 — Cross-service base URLs and internal key

* **Problem:** services need to find each other differently in each environment (localhost ports, one API Gateway, or three Worker URLs).
* **Fix:** `shared/serviceClient.js` reads `DRIVE_SERVICE_URL`, `DONOR_SERVICE_URL`, `BOOKING_SERVICE_URL` from `shared/config.js`, appends the path, adds `x-internal-key`, applies a 10-second `AbortSignal.timeout`, and converts network errors into `502 SERVICE_UNAVAILABLE`. A earlier bug resolved the base from an undefined `BASES[service]` lookup; it now calls the resolver with `config()`. `shared/router.js` rejects a missing/wrong internal key with `401`.
* **Status:** implemented and verified locally and on Floci (drive → booking stats, booking → drive reservation, booking → donor eligibility/donation).

### Entry 6 — Seat reservation needed a real atomic guard

* **Problem:** a naive "read slot → check capacity → write slot" sequence would let two concurrent bookings take the last seat.
* **Fix:** `reserveSeat(slotKey, delta)` exists in all three stores. SQLite and Neon use a single conditional SQL update; DynamoDB initially used `ConditionExpression: booked + :d BETWEEN :zero AND capacity`, which DynamoDB rejects because arithmetic is not allowed in conditions. It now reads the current count, checks capacity locally and writes `SET booked = :next` only while `booked = :expected`, retrying up to five times on a conditional failure.
* **Status:** implemented; double-booking returns `409` locally and on Floci. The crash window between reserve and insert remains a documented saga limitation (L10).

### Entry 7 — Password hashing and JWT on two runtimes

* **Problem:** common Node crypto packages are not available unchanged in Cloudflare Workers; CPU time on the free plan is limited.
* **Fix:** `shared/crypto.js` uses WebCrypto PBKDF2-SHA256 with 60,000 iterations and a random 16-byte salt (`pbkdf2$60000$<salt>$<hash>`), constant-time comparison, and HMAC-SHA256 JWTs with `iat`/`exp` (7 days). The same module runs in Node 22 and Workers.
* **Status:** implemented and exercised by registration/login tests and local, Floci and public smoke runs. Register/login succeeded repeatedly on the deployed Worker, so no CPU timeout was observed; formal load measurement is still pending (L7).

### Entry 8 — Geocoding with a public API

* **Problem:** Nominatim is public, rate-sensitive and can be unavailable; the app still needs drives to be creatable.
* **Fix:** `shared/external/geo.js` normalises the place into a cache key, checks `bdo_geocodes`, calls Nominatim only on a miss with a descriptive User-Agent and 7-second timeout, caches success, and returns `null` on failure. `createDrive` tolerates `null`; `GET /api/drives?near=` turns `null` into `502`. `TEST_MODE=1` uses deterministic fake coordinates.
* **Status:** implemented; `bdo_geocodes` now exists on Floci. Live Nominatim evidence remains pending (L24).

### Entry 9 — Turnstile and email without local credentials

* **Problem:** no real Cloudflare Turnstile or Resend keys exist locally, and secrets must never be committed.
* **Fix:** `verifyTurnstile()` returns development mode when no secret is configured and test mode when `TEST_MODE=1`; with a secret it posts to `siteverify` and maps failures to `401`/`502`. `sendEmail()` logs `EMAIL_DEV_LOG` and returns `{status:'dev-log'}` in test/log/no-key mode; Resend is preferred when `RESEND_API_KEY` is set (Brevo is the fallback via `BREVO_API_KEY`), and only when `EMAIL_MODE` is not `log`. Every attempt is stored in `bdo_reminders`.
* **Status:** dev behaviour verified locally; public Booking Worker uses Resend with `EMAIL_MODE=live` and a controlled `sent` result is captured in `evidence/RESEND-LIVE-EMAIL.txt`. Real Turnstile key evidence remains pending (L6).

### Entry 10 — Bundling for Lambda and Workers

* **Problem:** uploading `node_modules` into three Lambdas is slow and error-prone; Workers need ESM bundles.
* **Fix:** `infra/scripts/zip-lambda.js` uses esbuild to produce `dist/lambda/<service>/index.js` (CJS, `node22`) and zips it as `dist/lambda/<service>.zip` with handler `index.handler`. `infra/scripts/bundle-workers.js` emits `services/<service>/dist/worker.js` (ESM, `es2022`) matching each `wrangler.toml` `main`. `dist/` and `*.zip` are git-ignored; `.env`/`.dev.vars` are never bundled.
* **Status:** implemented; both commands run from `npm run zip:all` / `npm run workers:bundle` and succeed.

### Entry 11 — Frontend configuration differs per deployment

* **Problem:** the SPA needs the API base URLs at load time; secrets cannot be in the browser.
* **Fix:** `frontend/js/api.js` reads `window.BDO.services` from `frontend/js/config.js`. `infra/frontend.sh` rewrites it for Floci and uploads it to `s3://bdo-web/js/config.js`. `infra/scripts/configure-cloudflare.js` generates the same file for Cloudflare from env vars via `npm run deploy:cloudflare`; no secrets are written to the browser config.
* **Status:** Floci verified (`http://localhost:4566/bdo-web/index.html` → 200); Cloudflare verified at `https://bdo-organizer.separate-scowl.workers.dev/js/config.js`, which contains the three public Worker URLs (see `evidence/PUBLIC-DEPLOYMENT.txt`).

### Entry 12 — Reminder scheduling differs per deployment

* **Problem:** the daily reminder should be automatic, but Floci and Cloudflare expose different scheduler mechanisms.
* **Fix:** Floci `infra/services/booking.sh` creates EventBridge rule `bdo-daily-reminders` (`cron(0 6 * * ? *)`) targeting the Booking Lambda; `lambda.js` detects `source: 'aws.events'` and calls `sendForDate()` directly. Cloudflare `services/booking/wrangler.toml` declares `[triggers] crons = ["0 6 * * *"]` and `worker.js` exports `scheduled()`, which sets the Neon store and reuses the same function. The internal route and organizer button use the same idempotent reminder id.
* **Status:** implemented on both platforms; public manual reminder route and organizer button verified on Cloudflare. The temporary preview account allows 0 cron triggers, so the declared `0 6 * * *` trigger could not be attached there; attach it on a permanent account to observe a scheduled run.

### Entry 13 — Testability features

* **Problem:** tests must not call real Nominatim, Turnstile or email providers, and date-dependent rules need stable inputs.
* **Fix:** `TEST_MODE=1` makes geocoding deterministic and skips Turnstile; `EMAIL_MODE=log` records email rows locally; `shared/context.js` exposes `setClock()`; `shared/serviceClient.js` exposes `setServiceFetch()`. `npm test` uses `--test-concurrency=1` to avoid SQLite contention.
* **Status:** 53 tests written under `tests/`; `npm test` → 53 pass, 0 fail. `scripts/smoke.mjs` creates fresh accounts each run and accepts `BDO_API_URL` for Floci; both local and Floci runs are 22/22 PASS.

### Entry 14 — Evidence and ownership gap

* **Problem:** generated commits cannot prove which student wrote which service.
* **Fix required:** protect `main`, keep one `feature/*` branch per student, require one teammate review per PR, tag `v1.0`, and make the zip and demo video from that tag. Real GitHub usernames are still needed for `.github/CODEOWNERS`.
* **Status:** repository, branches and pushed history exist at `https://github.com/TasneemHazem10/blood_donation-cloud-.git`; real per-student commits/PRs, tag, zip and video are still not done, so those references in `docs/individual-statements.md` remain explicit placeholders.

### Entry 15 — Documentation rebuild

* **Observation:** documentation files were missing while the source, infra scripts and port facts were present.
* **Action:** wrote `docs/architecture.md`, `api.md`, `data-model.md`, `deployment.md`, `testing.md`, `limitations.md`, `individual-statements.md`, `notes.md`, `openapi.yaml` and `FULL_PROJECT_GUIDE.md` from the actual source, then reconciled them after the fixes below.
* **Status:** complete; open items are recorded in `docs/limitations.md`.

### Entry 16 — Validator found while writing the API reference

* **Problem:** `bookingKey()` originally created ids like `drv_123::donor@example.org`, but `idParam()` did not permit `:`. Cancel/check-in returned `400 INVALID id` before any business logic ran.
* **Fix:** changed the separator to `__` (`drv_123__donor@example.org`), which the existing validator accepts, and added regression coverage in BK06/BK07 plus the smoke flow.
* **Status:** fixed; all API docs and examples now use `__`.

### Entry 17 — Windows paths broke Floci uploads

* **Problem:** `aws lambda create-function --zip-file fileb:///c/Users/Alshuruq Comapny/.../drive.zip` failed because the AWS CLI parsed the space in the absolute path; the same happened with `aws s3 cp` for frontend files.
* **Fix:** each service and frontend script now `cd`s to the project root and passes relative paths (`fileb://dist/lambda/<service>.zip`, `frontend/index.html`, `.data/deploy-config.js`).
* **Status:** fixed; `bash infra/deploy-all.sh` completes on Windows Git Bash.

### Entry 18 — Floci Lambdas could not reach the emulator

* **Problem:** health endpoints passed but data endpoints returned 500. Logs showed `ECONNREFUSED 127.0.0.1:4566` from inside the Lambda container — `localhost` there is the Lambda, not Floci.
* **Fix:** added `AWS_ENDPOINT_LAMBDA=http://floci:4566` in `infra/config.sh` and used it for Lambda `AWS_ENDPOINT_URL`. Docker DNS resolves the compose service name `floci` to the emulator container; API Gateway hostnames also resolve from the Lambda network.
* **Status:** fixed; all six Floci checks pass.

### Entry 19 — Lambda bodies were Buffers, not JSON

* **Problem:** Floci register/login returned `400 email is required`. The API Gateway event body was valid JSON, but `serverless-http` marks the request complete and hands Express a `Buffer`; Express 5’s body-parser skips completed requests.
* **Fix:** `normalizeServerlessBody()` in `shared/router.js` parses a Buffer body before `express.json()` and returns a `400 VALIDATION_ERROR` for malformed JSON. It is mounted in all three `app.js` files.
* **Status:** fixed; Floci register/login/drive/booking all return the expected statuses.

### Entry 20 — S3 report upload used virtual-host addressing

* **Problem:** reports failed on Floci with `getaddrinfo ENOTFOUND bdo-drive-reports.floci` because the S3 SDK defaulted to virtual-host style against a custom endpoint.
* **Fix:** `services/drive/services/s3.js` sets `forcePathStyle: Boolean(settings.awsEndpoint)`.
* **Status:** fixed; Floci report returns `storage:"s3"` with a `reports/<driveId>/<reportId>.csv` key.

### Entry 21 — Evidence captured

* **Observation:** documentation previously described tests, cron, config generation and Floci deployment as missing.
* **Action:** ran `npm test` (53/53 after adding `tests/pending-evidence.test.js`), local smoke (22/22), `bash infra/deploy-all.sh` (ALL CHECKS PASSED), Floci smoke (22/22) and `npm run evidence:capture` (live Nominatim, 429 and Turnstile missing-token captures); reconciled all Markdown files with those results.
* **Status:** complete for local/Floci and public Cloudflare/Neon (`evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-*.png`). Git PR history, zip and video remain to be produced.

### Entry 22 — Worker-to-Worker fetch failed with error 1042

* **Problem:** after a successful public deployment, `POST /api/bookings` returned `404 {"error":{"code":"E404","message":"error code: 1042\n"}}`. `wrangler tail` on Booking showed the failing call was `GET https://bdo-drive.../internal/drives/...`; the same URL returned 200 from Node, proving the internal route, key and Neon data were correct.
* **Fix:** Cloudflare rejects a Worker fetching another Worker on the same zone unless `global_fetch_strictly_public` is enabled. Added `compatibility_flags = ["global_fetch_strictly_public"]` to all three `wrangler.toml` files, rebundled and redeployed; the public smoke then passed 22/22.
* **Status:** fixed; documented in `README.md` troubleshooting and `evidence/PUBLIC-DEPLOYMENT.txt`.

### Entry 23 — Missing DATABASE_URL secret on first public deployment

* **Problem:** all three health endpoints returned 500 after the first deploy; `wrangler tail` reported `DATABASE_URL is required for the Neon data layer`. The generated `.data/worker-secrets.json` had been written before `infra/secrets.env` was created, so `DATABASE_URL` was empty.
* **Fix:** regenerated the secrets file from the git-ignored `infra/secrets.env` (pooled Neon connection string) and redeployed the three Workers.
* **Status:** fixed; all three health checks returned 200 afterwards.

### Entry 24 — Worker-to-Worker public fetch returned 522 on the preview account

* **Problem:** after redeploying to a new temporary Cloudflare account, the Drive report endpoint (`GET /api/drives/:id/report`) returned `522` although its internal Booking stats call returned 200 when called directly from Node. `wrangler tail` showed the Drive request became a 522 response with no exception in the caller.
* **Fix:** replaced public `workers.dev` fetches with Cloudflare service bindings. `shared/serviceClient.js` gained `setServiceBindings()` and uses `binding.fetch()` when a binding exists; Drive binds `BOOKING`, Booking binds `DRIVE` and `DONOR`. Local and Floci modes still use HTTP.
* **Status:** fixed; the public smoke passes 22/22 including the report step. Documented in `docs/architecture.md`, `docs/deployment.md` and `evidence/PUBLIC-DEPLOYMENT.txt`.

### Entry 25 — Live transactional email with Resend

* **Problem:** reminder emails were only evidenced in `EMAIL_MODE=log`; a real provider send was required, and Brevo was the original default.
* **Fix:** `shared/external/email.js` now prefers Resend (`https://api.resend.com/emails`) when `RESEND_API_KEY` is set, keeps Brevo as a fallback, and still logs in test/log/no-key modes. `infra/scripts/configure-cloudflare.js` sets `EMAIL_MODE=live` when a key exists. Secrets stay in git-ignored files.
* **Status:** verified from the public Booking Worker: a controlled send to the Resend account owner returned `status=sent`, `provider=resend`, with two message ids recorded in `evidence/RESEND-LIVE-EMAIL.txt`. Resend free testing mode rejects other recipients with 403; those failures are stored as `failed` rows and do not break the flow. Also fixed a date-dependent `SR11` assertion by using fixed dates relative to `2026-11-24`.

### Entry 26 — Floci config drift after secrets.env was updated

* **Problem:** a Floci smoke run failed at organizer registration with `409 "Organizer invite code is not correct"` because the deployed Donor Lambda still had the older random invite `blood-a38385`, while the git-ignored `infra/secrets.env` had been updated to `blood2026`. In addition, `source infra/secrets.env` failed in Git Bash because the file had a UTF-8 BOM and unquoted values containing `<` and `&`.
* **Fix:** normalised the git-ignored secrets file (BOM removed, every value quoted), rebuilt the Lambda zips from current code, and redeployed with `bash infra/deploy-all.sh` so all three Lambdas use the current secrets.
* **Status:** redeploy ends with `ALL CHECKS PASSED`; the Floci smoke is **22/22 PASS** with report `storage:"s3"`, captured in `evidence/FLOCI-SMOKE.txt`. This was configuration drift, not a code defect.
