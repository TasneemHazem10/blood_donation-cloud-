# Finalization README — what is done, what I still need, and the exact manual steps

This file is the hand-over checklist for the **Blood Donation Drive Organizer** project.
Everything marked ✅ is already implemented, tested, evidenced and pushed to
**https://github.com/TasneemHazem10/blood_donation-cloud-.git**.
Everything marked ☐ cannot be completed from this workspace: it needs real accounts, real
identities, or a human-created artefact. Nothing below is claimed as done until you
perform it.

---

## 0. Current verified state (do not redo)

| Item | Status |
|---|---|
| Three services + SPA + shared modules + infra | ✅ pushed on `main` (`532fd3a`) |
| Branches `feature/s1-drive`, `feature/s2-donor`, `feature/s3-booking` | ✅ pushed (currently identical to `main`) |
| `npm test` | ✅ 53 tests, 53 pass, 0 fail |
| Local smoke / Floci smoke | ✅ 22/22 each; Floci `ALL CHECKS PASSED` |
| Evidence files | ✅ `evidence/DRV-05-live-geocode.txt`, `DON-14-rate-limit.txt`, `DON-16-turnstile-missing-token.txt`, `E2E-04-home.png`, `E2E-04-drives.png` |
| Report draft | ✅ `docs/report.md` sections 1–10 + appendix |
| Three 9-item statements | ✅ `docs/individual-statements.md` |

---

## 1. The minimum information I need from you

Copy this block, fill it, and send it back. **Do not put real secrets in a file that gets committed.**
For deployment you can either set the variables in your own shell and ask me to run the command,
or provide them here temporarily and I will never write them into the repository.

```text
# Identities (for real per-student commits and CODEOWNERS)
HABIBA_FULL_NAME=
HABIBA_REAL_EMAIL=
HABIBA_GITHUB_USERNAME=
HALA_FULL_NAME=
HALA_REAL_EMAIL=
HALA_GITHUB_USERNAME=

# Repository access
REPO_PUBLIC=yes/no          # if no, invite the module leader as collaborator

# Public deployment (Cloudflare Workers + Neon)
DATABASE_URL=               # Neon Postgres connection string
JWT_SECRET=                 # long random string
INTERNAL_KEY=               # another long random string
ORGANIZER_INVITE=           # organiser signup code, e.g. blood2026
DRIVE_WORKER_URL=           # https://bdo-drive.<account>.workers.dev
DONOR_WORKER_URL=           # https://bdo-donor.<account>.workers.dev
BOOKING_WORKER_URL=         # https://bdo-booking.<account>.workers.dev
FRONTEND_URL=               # e.g. https://bdo-organizer.pages.dev (or leave blank to detect)
TURNSTILE_SITE_KEY=         # public site key for the SPA (optional)
TURNSTILE_SECRET=           # secret for Worker/Lambda (optional)
BREVO_API_KEY=              # optional; without it EMAIL_MODE=log
EMAIL_FROM=                 # optional sender address

# Final artefacts
VIDEO_URL=                  # Google Drive / YouTube link, "anyone with the link can view"
```

If you do not want real Turnstile/Brevo keys, that is acceptable: the app explicitly runs in
development/log mode and the missing-token branch is already evidenced. The report must then say
the real-key path is untested.

---

## 2. GitHub ownership and history (must be done by the students)

Why: the brief requires **real per-student commits**, reviewed PRs, and a repository whose history
shows each member's contribution. The current commits are import/documentation commits by
Tasneem's configured Git identity — they are not proof that she wrote all three services.

1. Make the repository public, or invite the module leader:
   `https://github.com/TasneemHazem10/blood_donation-cloud-.git` → Settings → Collaborators.
2. Enable branch protection on `main` (require a PR and at least one approval).
3. Replace the remaining `REPLACE_WITH_HABIBA_GITHUB` / `REPLACE_WITH_HALA_GITHUB` entries in
   `.github/CODEOWNERS` with real handles.
4. Each student commits a **real change** to their own service from their own Git account:

   ```bash
   # Habiba
   git checkout feature/s1-drive
   git config user.name  "<HABIBA_FULL_NAME>"
   git config user.email "<HABIBA_REAL_EMAIL>"
   # edit something under services/drive/ (a genuine fix, refactor or doc update)
   git add services/drive/
   git commit -m "Drive service: <what was actually changed>"
   git push origin feature/s1-drive

   # Tasneem (identity already configured on this machine)
   git checkout feature/s2-donor
   # edit something under services/donor/
   git add services/donor/
   git commit -m "Donor service: <what was actually changed>"
   git push origin feature/s2-donor

   # Hala
   git checkout feature/s3-booking
   git config user.name  "<HALA_FULL_NAME>"
   git config user.email "<HALA_REAL_EMAIL>"
   # edit something under services/booking/
   git add services/booking/
   git commit -m "Booking service: <what was actually changed>"
   git push origin feature/s3-booking
   ```

   Do **not** use `--author` to fake someone else's identity.
5. Open three PRs (`feature/s1-*`, `s2-*`, `s3-*` → `main`), have another student approve, merge.
6. Copy each PR URL and its merge commit hash into
   `docs/individual-statements.md` and `docs/report.md` section 7.

---

## 3. Public Cloudflare Workers + Neon deployment

Why: the brief requires a **public URL**. Floci is an emulator and cannot be the demonstration URL.

### One-time account setup

1. `npx wrangler login` (Cloudflare).
2. Create a Neon project → copy the Postgres connection string.
3. Create a Cloudflare Turnstile widget if you want real bot protection (site key + secret).
4. Create a Brevo API key if you want real emails; otherwise leave it empty and keep log mode.
5. Decide the three Worker names; their URLs are the three `*_WORKER_URL` values above.

### Deploy

In PowerShell (from the project root), set the variables from section 1, then:

```powershell
$env:DATABASE_URL='postgresql://...'
$env:JWT_SECRET='...'
$env:INTERNAL_KEY='...'
$env:ORGANIZER_INVITE='...'
$env:DRIVE_WORKER_URL='https://bdo-drive.<account>.workers.dev'
$env:DONOR_WORKER_URL='https://bdo-donor.<account>.workers.dev'
$env:BOOKING_WORKER_URL='https://bdo-booking.<account>.workers.dev'
$env:FRONTEND_URL='https://bdo-organizer.pages.dev'
# optional: TURNSTILE_SITE_KEY, TURNSTILE_SECRET, BREVO_API_KEY, EMAIL_FROM

npm run deploy:cloudflare
```

The script bundles the Workers, applies `infra/db/schema.sql` to Neon, sets secrets, deploys the
Workers, writes the public URLs into `frontend/js/config.js`, deploys Pages, sets CORS and checks
all three health endpoints. It ends with `CLOUDFLARE DEPLOYMENT VERIFIED`. URLs are saved to
`.data/cloudflare-urls.json` (git-ignored).

### After deployment — capture evidence

```bash
curl https://<drive-worker>/api/health/drive
curl https://<donor-worker>/api/health/donor
curl https://<booking-worker>/api/health/booking
```

* Open the Pages URL on a laptop **and a phone**; screenshot `3/3 services online`.
* Repeat the manual end-to-end scenario in `README.md` section 3 from the public URL.
* Take Neon SQL-editor screenshots after register, booking, check-in and report.
* Take Cloudflare dashboard screenshots: three Workers, Pages deployment, Cron Trigger
  `0 6 * * *`, and one `wrangler tail` log excerpt.
* Paste the public URL into `docs/report.md` section 6 and replace `[DEPLOYED_URL]` in
  `docs/individual-statements.md`.

---

## 4. Demo video

1. Record **≤5 minutes** from the **public Cloudflare URL** (never localhost or Floci).
2. Order:
   1. Full journey: create drive + slot → donor registers → books → reminder log → check-in → report.
   2. Habiba: drive/slot/report screens and API.
   3. Tasneem: register/login, eligibility, profile, donation history.
   4. Hala: booking, cancel/check-in, reminder idempotency, cron log.
3. Upload to YouTube or Google Drive, set **“anyone with the link can view”**.
4. Put the link in `docs/report.md` section 8 (`[VIDEO_URL]`) and in the final submission form.
   No commentary is required.

---

## 5. Remaining tests / evidence to capture

| ID | What to do | Why |
|---|---|---|
| DON-16 live | Add a real Turnstile test key as a Worker secret, load the SPA, complete the widget, register once | The missing-token branch is evidenced; real widget validation is not |
| Email live | Set `BREVO_API_KEY` and `EMAIL_FROM`, send **one** controlled reminder, capture `status:"sent"` and the provider message id | Log mode is currently the only email evidence |
| E2E-06 | Repeat the full smoke flow with `BDO_API_URL=''`, `BDO_DRIVE_URL`, `BDO_DONOR_URL` and `BDO_BOOKING_URL` set to the public Workers, then `npm run smoke` | Public deployed integration is required |
| Per-endpoint evidence | One `curl -i` or Postman request/response per row of `docs/api.md` | Report sections 3 and 9 |
| Frontend screenshots | `#/organizer` (create form, slots, Bookings, Emails, Report tabs), `#/register`, `#/profile`, `#/bookings` | Individual statements, items 2 |
| Error evidence | `400`, `401`, `403`, `404`, `409`, `429`, `502` responses | Brief explicitly asks for invalid cases |
| `npm test` + smoke output | Save terminal output/screenshots | Report section 9 |

**Redaction rule:** never include a real JWT, `JWT_SECRET`, `INTERNAL_KEY`, `BREVO_API_KEY`,
`TURNSTILE_SECRET`, `DATABASE_URL` or invite code in a screenshot, log or report.

---

## 6. Freeze, tag and package

Only after sections 2–5 are complete and the demo is recorded:

```bash
git checkout main
git pull
git tag v1.0
git push origin v1.0
git archive --format=zip --output=bdo-organizer-v1.0.zip v1.0
```

* The ZIP must contain the exact version that produced the public URL and video.
* Verify the ZIP opens and contains `README.md`, `services/`, `frontend/`, `shared/`, `infra/`,
  `tests/`, `docs/` and `evidence/` — and **no** `.env`, `.dev.vars`, `infra/secrets.env`,
  `.data/` or `dist/`.
* Upload the ZIP and a PDF of `docs/report.md` (sections 1–10 + the three statements) to the
  submission portal.

---

## 7. Final placeholder sweep

Before submitting, search the repository for `PLACEHOLDER`, `[REPO_URL]`, `[PR_LINK`,
`[COMMIT_HASH`, `[DEPLOYED_URL]`, `[VIDEO_URL]`, `PENDING` and `REPLACE_WITH_`. Replace each with a
real artefact or a truthful “not implemented / not tested” note. Do not leave a placeholder for
something that was actually done.

```bash
# Windows PowerShell
Select-String -Path *.md,docs/*.md -Pattern 'PLACEHOLDER|REPLACE_WITH|PENDING|DEPLOYED_URL|VIDEO_URL'
```

---

## 8. Quick command reference

```bash
npm install
npm run dev                 # local: SPA :8090, APIs :3001/:3002/:3003
npm test                    # 53 tests
npm run seed                # demo accounts (invite blood2026)
npm run evidence:capture    # regenerate DRV-05 / DON-14 / DON-16 evidence
npm run zip:all             # Lambda zips for Floci
npm run workers:bundle      # Worker bundles for Cloudflare
bash infra/deploy-all.sh    # Floci (Git Bash on Windows)
npm run deploy:cloudflare   # public deployment (needs section 1 values)
git status --short --branch # must be clean before tagging
```
