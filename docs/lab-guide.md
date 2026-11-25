# Cloud Labs → Blood Donation Drive Organizer: tool-by-tool guide

This project is **not** a copy of the lab's `cloud-issue-tracker` app. It is the Blood Donation Drive Organizer (BDO), but every lab tool and deployment step has an equivalent here. This guide is the short path through the work using the same tools and order as the PDFs in `C:\Users\Alshuruq Comapny\OneDrive\Desktop\Senior year\Cloud Labs`.

> Honesty note: where the lab PDFs specify a check such as “13 passed” or “22 passed”, our scripts print a BDO-specific result with the same count shape. These are BDO checks, not claims about the lab app.

## Tools and versions

| Lab tool | Where it is used in BDO | Check command |
|---|---|---|
| Git Bash | All `infra/*.sh` scripts | `git --version` |
| Docker Desktop / Docker Compose | Floci emulator in `infra/floci/docker-compose.yml` | `docker --version` |
| AWS CLI with `floci` profile | DynamoDB, Lambda, IAM, S3, CloudWatch, API Gateway, EventBridge | `aws --version` then `aws sts get-caller-identity --profile floci --query Account --output text` → `000000000000` |
| Node.js / npm | Express services, bundlers, tests | `node --version`, `npm --version` |
| Lambda Node.js 24 / `lambda.handler` | `infra/scripts/zip-lambda.js` and `infra/services/*.sh` | `aws lambda get-function --function-name bdo-drive-service --query 'Configuration.[Runtime,Handler]' --output text` |
| Postman Desktop | `evidence/lab-04-postman-collection.json` | Import collection, set `baseUrl` |
| REST Client `.http` | `docs/requests.http`, `docs/aws-api-tests.http` | Open in VS Code and “Send Request” |
| k6 | `k6/bdo-load-test.js`, `k6/bdo-rps-capacity-test.js` | `k6 version` |
| Neon Postgres | Live public database, nine `bdo_*` JSONB tables | `docs/deployment.md` |
| Cloudflare Workers | Live public website and three APIs | `npm run deploy:cloudflare` |
| Vercel-style headers | `frontend/vercel.json`, Cloudflare-style `frontend/_headers` | `curl -I` after deployment |

Install k6 if it is missing:

```powershell
winget install k6 --source winget
```

On this machine k6 is installed at `C:\Program Files\k6\k6.exe`. In PowerShell run it with:

```powershell
& 'C:\Program Files\k6\k6.exe' run k6/bdo-load-test.js
```

In Git Bash the same binary is `/c/Program Files/k6/k6.exe`.

## One-time workspace setup

These are the lab's Docker/Git Bash/AWS commands adapted to BDO. Run them once in **Git Bash**:

```bash
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
echo 'export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1' >> ~/.bashrc
source ~/.bashrc

docker compose -f infra/floci/docker-compose.yml up -d
aws sts get-caller-identity --query Account --output text
```

Expected account: `000000000000`. Dashboard: <http://localhost:4566/_floci/ui>. Health: <http://localhost:4566/_floci/health>.

`infra/config.sh` now honours `AWS_PROFILE=floci`, sets `MSYS_NO_PATHCONV=1`, and falls back to dummy credentials when no profile exists.

## Lab 1–2: workspace, Node, npm

```bash
npm install
npm test
npm run dev
npm run browser:check
```

Website: <http://localhost:8090>. APIs: 3001/3002/3003. The lab app uses 8080/3000; BDO uses separate ports for its three services. `browser:check` verifies that a slow API response cannot overwrite a newer screen (Chrome/Chromium required).

## Lab 3: REST design and data services

- Architecture: `docs/architecture.md`
- API contract and error envelope: `docs/api.md`
- Data model: `docs/data-model.md`
- Move on to Lab 4 with `docs/requests.http`.

## Lab 4: Express API + Postman

1. Start the APIs: `npm run dev`.
2. Import `evidence/lab-04-postman-collection.json` into **Postman Desktop**.
3. Set collection variable `baseUrl` to `http://localhost:3001` (or 3002/3003).
4. Run T01–T08. The collection checks health, list, validation errors, unknown routes, CORS, malformed JSON, donor register validation and auth protection.
5. The same requests are available as REST Client files: `docs/requests.http` and `docs/aws-api-tests.http`.

## Lab 5: frontend + database deployment

The lab uses two Vercel projects plus Neon. The assignment also requires **public Cloudflare Workers URLs**, so BDO deploys the website and three APIs as Workers (still backed by Neon). The lab-style security files are present:

- `frontend/vercel.json` — Vercel `headers` with CSP and security headers.
- `frontend/_headers` — equivalent Cloudflare Pages/Workers static-asset headers.

Deploy the public site:

```bash
npm run workers:bundle
npm run deploy:cloudflare
```

Check headers after deployment:

```bash
curl -I https://bdo-organizer.bdo-organizer.workers.dev
```

Never put a Neon password, API token or `.dev.vars` file into the repository or evidence.

## Lab 6/7: Floci, DynamoDB, IAM, Lambda, API Gateway, S3

Run the base setup in Git Bash:

```bash
bash infra/setup-all.sh
```

This verifies Docker/AWS/Node/Git/k6, starts Floci, bundles each Lambda as `dist/lambda/<service>/lambda.js` (handler `lambda.handler`, runtime `nodejs24.x`), creates DynamoDB tables, IAM roles, CloudWatch log groups, API Gateway routes and three Lambdas.

Then finish the lab-7 equivalent:

```bash
bash infra/setup-lab7.sh
```

It republishes API Gateway routes, redeploys the services with the gateway URL, uploads the website to `s3://bdo-web`, saves `API_ID`/`API_URL`, and runs 13 checks. To restore only the variables:

```bash
source infra/lab7-vars.sh
```

To capture evidence:

```bash
bash infra/check-lab7.sh | tee evidence/LAB-07-CHECK.txt
```

BDO names corresponding to the lab names:

| Lab item | BDO equivalent |
|---|---|
| `CloudIssues` table | `bdo_drives`, `bdo_slots`, `bdo_reports`, `bdo_geocodes`, `bdo_users`, `bdo_donors`, `bdo_donations`, `bdo_bookings`, `bdo_reminders` |
| `cloud-issue-api` Lambda | `bdo-drive-service`, `bdo-donor-service`, `bdo-booking-service` |
| `cloud-issue-web` bucket | `bdo-web` |
| `GET/POST/PATCH /api/issues` | drive, donor, booking and internal routes listed in `infra/gateway.sh` |
| `lambda.handler` / `nodejs24.x` | same handler/runtime used by all three BDO Lambdas |

## Lab 8: scale, secure, observe

Start the local app stack (three Express APIs + website):

```bash
bash infra/run-floci.sh
bash infra/run-floci.sh status
```

Run the scale scenarios:

```bash
bash infra/reset-data.sh
bash infra/scale-test.sh vertical
bash infra/scale-test.sh horizontal 3
bash infra/scale-test.sh status
bash infra/scale-test.sh kill 2
bash infra/scale-test.sh stop
```

Run k6 against the baseline stack:

```bash
bash infra/scale-test.sh load
# or
K6_BASE_URL=http://localhost:3001 /c/Program\ Files/k6/k6.exe run k6/bdo-load-test.js
```

The k6 thresholds match the lab: `p(95) < 500 ms` and `http_req_failed < 5%`.

Run the 22 security/deployment checks:

```bash
bash infra/check-lab8.sh | tee evidence/LAB-08-CHECK.txt
```

Security checks are implemented in `shared/http.js` (`X-Content-Type-Options`, `X-Frame-Options`, CSP, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS) and in `frontend/vercel.json` / `frontend/_headers`.

## Evidence files

| Lab step | Evidence file to create |
|---|---|
| Lab 4 Postman | `evidence/lab-04-postman-collection.json` |
| Lab 7 deployment | `evidence/LAB-07-CHECK.txt` |
| Lab 8 k6 | `evidence/LAB-08-K6.txt` |
| Lab 8 checks | `evidence/LAB-08-CHECK.txt` |
| Unit and local smoke | `evidence/NPM-TEST.txt`, `evidence/LOCAL-SMOKE.txt` |
| Browser render regression | `evidence/BROWSER-RENDER-REGRESSION.txt` |
| Public deployment | `evidence/PUBLIC-DEPLOYMENT.txt`, `evidence/PUBLIC-SMOKE.txt`, `evidence/PUBLIC-E2E-CAPTURE.txt` |

Do not paste claim URLs, API tokens, Neon connection strings or `.dev.vars` into these files.
