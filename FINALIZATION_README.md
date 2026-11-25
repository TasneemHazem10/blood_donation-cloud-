# Finalization README — what is done, what I still need, and the exact manual steps

This file is the hand-over checklist for the **Blood Donation Drive Organizer** project.
Everything marked ✅ is already implemented, tested, evidenced and pushed to
**https://github.com/TasneemHazem10/blood_donation-cloud-.git**, including the live public
Cloudflare Workers + Neon deployment. Everything marked ☐ cannot be completed from this
workspace: it needs real student identities/repo settings or a human-recorded video. Nothing
below is claimed as done until you perform it.

---

## 0. Current verified state (do not redo)

| Item | Status |
|---|---|
| Three services + SPA + shared modules + infra | ✅ pushed on `main` (see `git log -1`) |
| Branches `feature/s1-drive`, `feature/s2-donor`, `feature/s3-booking` | ✅ pushed (currently identical to `main`) |
| `npm test` | ✅ 53 tests, 53 pass, 0 fail |
| Local smoke / Floci smoke | ✅ 22/22 each; repo-owned Docker Compose Floci `ALL CHECKS PASSED` (`evidence/FLOCI-DOCKER.txt`, `evidence/FLOCI-SMOKE.txt`) |
| Public Cloudflare Workers + Neon | ✅ live at `https://bdo-organizer.separate-scowl.workers.dev`; public smoke 22/22 |
| Evidence files | ✅ `evidence/DRV-05-live-geocode.txt`, `DON-14-rate-limit.txt`, `DON-16-turnstile-missing-token.txt`, `E2E-04-*.png`, `FLOCI-DOCKER.txt`, `FLOCI-SMOKE.txt`, `PUBLIC-DEPLOYMENT.txt`, `PUBLIC-SMOKE.txt`, `PUBLIC-E2E-*.png` |
| Report draft | ✅ `docs/report.md` sections 1–10 + appendix |
| Three 9-item statements | ✅ `docs/individual-statements.md` |

---

## 1. The minimum information I need from you

The public deployment is already live, so **no database URL, JWT secret, internal key or invite
code is needed from you**. Only the following are still needed from the team:

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

# Final artefact
VIDEO_URL=                  # Google Drive / YouTube link, "anyone with the link can view"
```

Optional future upgrade: real Turnstile test keys. The missing-token branch is already
evidenced. The public deployment uses Resend live email with a git-ignored API key; local
development still uses `TEST_MODE=1` and `EMAIL_MODE=log`.

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

## 3. Public Cloudflare Workers + Neon deployment — DONE

Why: the brief requires a **public URL**. Floci is an emulator and cannot be the demonstration URL.

| Component | Live public URL |
|---|---|
| Website (Cloudflare Workers static assets) | **https://bdo-organizer.separate-scowl.workers.dev** |
| Drive Worker | https://bdo-drive.separate-scowl.workers.dev |
| Donor Worker | https://bdo-donor.separate-scowl.workers.dev |
| Booking Worker | https://bdo-booking.separate-scowl.workers.dev |

Verified 25 Nov 2026:

* All three health endpoints return HTTP 200 with `Access-Control-Allow-Origin` set to the website URL.
* The deployed `frontend/js/config.js` contains all three public Worker URLs.
* The supplied Neon database has the nine `bdo_*` tables and the rows created by the live smoke run.
* `npm run smoke` against the public Workers: **22/22 PASS**, including booking, duplicate rejection, reminders, check-in, donation record, report and 400/401/403/404/409 errors.
* Evidence: `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-home.png`, `evidence/PUBLIC-E2E-drives.png`.

Important deployment notes:

* The Workers use a **temporary Cloudflare preview account**. Claim it with the one-time link that was supplied outside the repository, or redeploy to your own account with `wrangler deploy --temporary`/`npx wrangler login`. If the claim expires, redeploy and update the public URLs in `frontend/js/config.js` and the docs.
* All three `wrangler.toml` files include `compatibility_flags = ["global_fetch_strictly_public"]`; without it Booking → Drive/Donor calls fail with Cloudflare error `1042`. Cross-service calls now use Cloudflare service bindings (`env.BOOKING` in Drive; `env.DRIVE` and `env.DONOR` in Booking), which also avoids a `522` from Worker-to-Worker public fetches on the preview account.
* The temporary free account has **0 cron triggers**, so the declared `0 6 * * *` trigger could not be attached. The manual Reminder button and `POST /internal/reminders/daily` are verified; attach the trigger on a permanent account if required.
* Turnstile remains unconfigured. Resend live email is enabled for the public Booking Worker with `EMAIL_MODE=live`; the key is a Worker secret and `evidence/RESEND-LIVE-EMAIL.txt` records a controlled `sent` result. No secret, claim token or invite code is stored in the repository.

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
| Email live | ✅ Done with `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_MODE=live`; controlled send captured in `evidence/RESEND-LIVE-EMAIL.txt` (`status:sent`, `provider:resend`, message id) | — |
| E2E-06 | DONE — full smoke flow run with `BDO_API_URL=''` and the three public `BDO_*_URL` values; output in `evidence/PUBLIC-SMOKE.txt` | Public deployed integration is required |
| Per-endpoint evidence | One `curl -i` or Postman request/response per row of `docs/api.md` | Report sections 3 and 9 |
| Frontend screenshots | `#/organizer` (create form, slots, Bookings, Emails, Report tabs), `#/register`, `#/profile`, `#/bookings` | Individual statements, items 2 |
| Error evidence | `400`, `401`, `403`, `404`, `409`, `429`, `502` responses | Brief explicitly asks for invalid cases |
| `npm test` + smoke output | Save terminal output/screenshots | Report section 9 |

**Redaction rule:** never include a real JWT, `JWT_SECRET`, `INTERNAL_KEY`, `RESEND_API_KEY`,
`BREVO_API_KEY`, `TURNSTILE_SECRET`, `DATABASE_URL` or invite code in a screenshot, log or report.

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
npm run deploy:cloudflare   # redeploy to your own Cloudflare/Neon account (optional)
git status --short --branch # must be clean before tagging
```
