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

## Things worth knowing

- `NODE_ENV=production` turns on the Secure cookie flag and HSTS. Do not run
  production without it.
- `ADMIN_EMAILS` is the only way to obtain the admin role; it cannot be
  self-assigned at signup.
- The registration rate limit defaults to 30/hour per IP. A school behind one
  NAT address may need `REGISTER_LIMIT_PER_HOUR` raised.
- SQLite on one node will not meet the spec's 50,000 concurrent users
  (requirement 10.2). That needs Postgres and horizontal scaling.
