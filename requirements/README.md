# Requirements tracking

`register.json` is the single source of truth for what the BeastForge spec asks
for and where each item stands. `checks.mjs` holds automated verification.

    npm run status    # print the report
    npm run verify    # same, and write requirements/STATUS.txt

## The rule that makes this trustworthy

A requirement may only be marked `done` if it names an `evidence` check that
**passes**. `verify.mjs` exits non-zero otherwise, and CI runs it on every push.
So "done" cannot drift into "I think I did that".

## Statuses

| status   | meaning |
|----------|---------|
| done     | implemented AND covered by a passing automated check |
| partial  | implemented in part; the gap is written in `notes` |
| todo     | not started |
| blocked  | needs something only the account owner can supply (keys, vendor accounts, legal) |
| deferred | out of scope for now, by agreement |

## Adding work

1. Implement the change.
2. Add a check to `checks.mjs` that would fail without it.
3. Flip the requirement to `done` with `"evidence": "check:<id>"`.
4. Run `npm run verify` — it must exit 0.
