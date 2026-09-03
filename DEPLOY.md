# Deploying BeastForge

The app is one container: the API serves the built client, so there is a single
port and a single URL. SQLite lives on a mounted volume, so it must be a host
that offers persistent disk — not a serverless platform that wipes local files.

## What only you can do

Deployment needs an account in your name. I can prepare everything else.

## Fly.io

```bash
fly auth login
fly launch --no-deploy            # reads fly.toml, do not let it overwrite
fly volumes create mathquest_data --size 1
fly secrets set ADMIN_EMAILS=you@example.com
fly deploy
```

## Render

Create a new Blueprint from this repository; `render.yaml` supplies the rest.
Set `ADMIN_EMAILS` in the dashboard.

## Railway

`railway init` then `railway up`. Add a volume mounted at `/data` and set
`DB_FILE=/data/mathquest.db`.

## After deploying

    curl https://<your-host>/ready        # {"ok":true,"users":N}

`/health` reports the process is alive; `/ready` reports the database is
readable. Point the platform's health check at `/ready`.

## Configuration reference

Everything is an environment variable. Only `ADMIN_EMAILS` and, in production,
`DATA_KEY` are required; the rest switch features on.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production` | Secure cookies, HSTS, and a hard requirement for `DATA_KEY`. |
| `PORT`, `PUBLIC_URL` | Listen port and the public origin (used in emails, LTI, OIDC and webhooks). |
| `DB_FILE`, `BACKUP_DIR` | SQLite file and backup directory; both belong on the persistent volume. |
| `ADMIN_EMAILS` | Comma-separated emails that receive the admin role. |
| `DATA_KEY` | 32 random bytes, base64. Encrypts personal fields at rest and seals backups. `head -c 32 /dev/urandom \| base64`. |
| `DATA_KEY_PREVIOUS` | The old key during rotation; every row is re-encrypted on boot, then drop it. |
| `BACKUP_ENCRYPT=1`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` | Sealed scheduled backups (the Dockerfile sets encryption on). `node tools/restore-drill.mjs` proves they restore. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS` | Outbound email (password resets, alerts, the weekly summary). `SMTP_TLS` is `starttls` (default), `tls` or `none`. Without a host, mail is written to the log. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push. Omit them and a key pair is generated once and stored in the database. |
| `ANTHROPIC_API_KEY`, `TUTOR_MODEL`, `TUTOR_TIMEOUT_MS`, `TUTOR_API_URL` | AI tutor. Without a key the tutor falls back to rule-based hints; the timeout (default 3000 ms) caps the wait either way. |
| `OIDC_PROVIDERS` | JSON array of `{ id, name, issuer, clientId, clientSecret, emailDomain?, defaultRole? }` for Google, Microsoft, Clever or ClassLink sign-in. Admins can also add providers at runtime. |
| `JOBS_INTERVAL_MS` | Background jobs (mastery decay, alerts, weekly digests, analytics roll-ups); `0` disables the scheduler. |
| `GLOBAL_LIMIT_PER_MINUTE`, `REGISTER_LIMIT_PER_HOUR` | Rate limits per IP. |
| `METRICS_TOKEN` | If set, `/metrics` (Prometheus) and `/metrics.json` require `Authorization: Bearer <token>`. |
| `CDN_BASE` (build time) | Prefix for the client's hashed assets when they are served from a CDN. |
| `FLY_API_TOKEN` (CI secret) | Lets `.github/workflows/deploy.yml` run the blue-green Fly deploy; see `infra/README.md`. |

LTI 1.3 platforms are registered by an admin through the API
(`POST /api/admin/lti/platforms`); the tool's JWKS is served at `/api/lti/jwks`
and its configuration at `/api/lti/config`.

## Things worth knowing

- `NODE_ENV=production` turns on the Secure cookie flag and HSTS. Do not run
  production without it.
- `ADMIN_EMAILS` is the only way to obtain the admin role; it cannot be
  self-assigned at signup.
- The registration rate limit defaults to 30/hour per IP. A school behind one
  NAT address may need `REGISTER_LIMIT_PER_HOUR` raised.
- SQLite on one node will not meet the spec's 50,000 concurrent users
  (requirement 10.2). That needs Postgres and horizontal scaling.
