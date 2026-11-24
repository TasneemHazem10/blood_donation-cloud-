# Git workflow and ownership evidence

## Current local state (25 Nov 2026)

The workspace now contains a real local Git repository:

* `main` has one import commit: `2139745c54024bc98d58454a3fe07a8da2871db7`
  (`Initial project import: three services, SPA, infra, docs, tests and captured evidence`).
  It was made with the machine's configured identity, **Tasneem Hazem <tasneemhazem27@gmail.com>**.
  It is an *import* commit, not a claim that Tasneem wrote all three services.
* Three local branches exist from that commit: `feature/s1-drive`, `feature/s2-donor`, `feature/s3-booking`.
* There is **no remote repository, no pull request, no review, no `v1.0` tag and no per-student commit yet**.
  `.github/CODEOWNERS` still contains placeholder GitHub handles.

## Required next steps (must be done by the students)

1. Create a GitHub repository (public, or invite the module leader) and add it as `origin`:

   ```bash
   git remote add origin https://github.com/<TEAM_OR_OWNER>/<REPO>.git
   git push -u origin main
   ```

2. Replace the `@REPLACE_WITH_*_GITHUB` entries in `.github/CODEOWNERS` with real handles,
   commit that change, and enable branch protection on `main`.

3. Each student makes a **real change** to their own service on their own branch, with their own
   Git identity. Example commands (replace the bracketed values; Habiba's and Hala's real
   email addresses were not available in this workspace):

   ```bash
   # Habiba - Drive Management
   git checkout feature/s1-drive
   git config user.name  "<HABIBA_FULL_NAME>"
   git config user.email "<HABIBA_REAL_EMAIL>"
   # edit a file under services/drive/ or its documentation, then:
   git add services/drive/
   git commit -m "Drive service: implement and verify drive/slot/report rules"
   git push -u origin feature/s1-drive

   # Tasneem - Donor and Eligibility (identity already configured on this machine)
   git checkout feature/s2-donor
   # edit a file under services/donor/, then:
   git add services/donor/
   git commit -m "Donor service: implement and verify auth and eligibility rules"
   git push -u origin feature/s2-donor

   # Hala - Booking and Reminder
   git checkout feature/s3-booking
   git config user.name  "<HALA_FULL_NAME>"
   git config user.email "<HALA_REAL_EMAIL>"
   # edit a file under services/booking/, then:
   git add services/booking/
   git commit -m "Booking service: implement and verify booking/reminder flow"
   git push -u origin feature/s3-booking
   ```

   Do not use `--author` to invent someone else's identity; commit from the student's own
   configured Git account so the GitHub contribution graph and commit signature agree.

4. Open three pull requests into `main`, have another student review/approve each one, and merge.
   Copy the three PR links and commit hashes into `docs/individual-statements.md` and `docs/report.md`.

5. Freeze and submit the demonstrated version:

   ```bash
   git checkout main
   git pull
   git tag v1.0
   git archive --format=zip --output=bdo-organizer-v1.0.zip v1.0
   ```

   The ZIP must be built from the same tag that produced the public URL and the demo video.

## What still needs a human decision

* Habiba's and Hala's real Git names/emails and GitHub handles.
* The team repository URL and whether it is public or the examiner is invited.
* Which student pushes the protected `main` branch and creates the tag.
