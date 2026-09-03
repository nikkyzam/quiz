# Infrastructure

Two ways to stand the service up, both reproducible from this directory.

## Fly.io with Terraform

    cd infra/terraform
    export FLY_API_TOKEN=...
    terraform init
    terraform apply \
      -var admin_emails=you@example.com \
      -var data_key="$(head -c 32 /dev/urandom | base64)"

That creates the app, the 1 GB volume for SQLite at `/data`, public IPs, and
sets the secrets (`ADMIN_EMAILS`, `DATA_KEY`, encrypted scheduled backups).
Then ship code with `flyctl deploy --strategy bluegreen` or by merging to
`main`, which runs `.github/workflows/deploy.yml` once `FLY_API_TOKEN` is a
repository secret.

Keep `DATA_KEY` somewhere you can get it back — the database is unreadable
without it. To rotate: set `DATA_KEY` to the new key and `DATA_KEY_PREVIOUS`
to the old one, redeploy, then `POST /api/admin/jobs/rekey` as an admin and
drop `DATA_KEY_PREVIOUS`.

## Any Docker host with Compose

    DATA_KEY="$(head -c 32 /dev/urandom | base64)" ADMIN_EMAILS=you@example.com docker compose up -d --build

The database and backups live in the named volume `beastforge_data`.

## Operations

- `/health` — the process is up. `/ready` — the database is readable.
- `/metrics` — Prometheus text: request counts, latency buckets, error rate, uptime.
- `node tools/restore-drill.mjs` — restores the newest backup into a fresh
  server and proves it serves; run it on a schedule, not only after a disaster.
- `node tools/loadtest.mjs --base URL --users 200 --seconds 30` — throughput and
  latency percentiles under concurrency.
- `node tools/pentest.mjs --base URL` — the automated security probes.
