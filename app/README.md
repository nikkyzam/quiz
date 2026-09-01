# Math Quest — full-stack app

Real backend + React frontend, replacing the static HTML prototype.

## Run it

```bash
cd app/server && npm install && npm run dev   # API on :4000
cd app/web    && npm install && npm run dev   # UI  on :5180 (proxies /api)
```

## Why this shape

- **No native deps, no cloud accounts.** SQLite comes from Node 26's built-in
  `node:sqlite`; password hashing uses `node:crypto` scrypt. Nothing to sign up for.
- **The server grades answers.** Questions are sent without `a`/`ans`/`ansP`/`expl`,
  so correct answers never reach the browser. `POST /api/answer` decides.
- **Hints are server-gated** (`POST /api/hint`, levels 1-3) so the client can't read ahead.
- **Sessions are httpOnly cookies** backed by a `sessions` table, not JWTs in localStorage.

## Layout

    app/shared/     curriculum + question banks (ES modules, shared by server)
    app/server/     Express API, SQLite schema, auth, grading
    app/web/        React + Vite + TypeScript client

## Data model

`users` → `learners` → `progress` (best per topic+tier) and `runs` (history).
A learner belongs to a parent account, so one login follows several children
across devices. Every learner-scoped route checks ownership.

## Not yet built (from the BeastForge spec)

Adaptive engine (BKT/IRT), AI tutor, proof trainer, competition mode,
teacher/admin portals, LTI/Clever rostering, native apps, offline sync.
The AI tutor needs an LLM provider key and a billing decision.
