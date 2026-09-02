# Requirements tracking

`register.json` is the single source of truth for what the specification asks
for and where each item stands. `checks.mjs` holds the automated verification.

    npm run status         # print the report
    npm run verify         # same, and write requirements/STATUS.txt
    npm run lint:content   # content quality checks

## The rule that makes this trustworthy

A requirement may only be marked `done` if it names an `evidence` check that
**passes**. `verify.mjs` exits non-zero otherwise, and GitHub Actions runs it on
every push. So "done" cannot drift into "I think I did that".

## Statuses

| status   | meaning |
|----------|---------|
| done     | implemented AND covered by a passing automated check |
| partial  | works in part; the gap is written in `notes` |
| todo     | not started |
| blocked  | needs an account, key or decision only the owner can supply |
| deferred | out of scope for now, by agreement |

`partial` is the expected state for most things and is not a failure. Marking
something done because it mostly works is how a register stops being worth
reading.

## Where things stand

Run `npm run status` for live numbers. At the last update: 124 requirements —
36 done, 55 partial, 21 todo, 11 blocked, 1 deferred, with 47 checks passing.

Two checks (`question-types`, `reliability`) run without being named as evidence
by any requirement, because the requirements they cover are `partial`. They
still guard against regression.

## Adding work

1. Implement the change.
2. Add a check to `checks.mjs` that would **fail without it**. A check that
   passes before the change proves nothing.
3. Flip the requirement to `done` with `"evidence": "check:<id>"`.
4. Run `npm run verify` — it must exit 0.
5. Commit.

## What is blocked, and why

Eleven requirements need something no amount of code supplies: an LLM provider
account for the AI tutor, SMTP for email, vendor approval for Clever/ClassLink
and LTI, paid developer accounts for the app stores, legal review for content
licensing, and real users for the adaptive engine's validation criterion.
These are held as `blocked` rather than worked around.
