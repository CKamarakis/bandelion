# Proposal

## Why

`CLAUDE.md` defines the artifact as `docker compose up`, and there is no
`Dockerfile` or compose file in the repo or its history — `DECISIONS.md` 015
says they were written, and they were not. Docker is not installed on the
development machine, so nothing has ever run the artifact. The repo has also
been public since its first commit (016) with no CI, so `npm run verify` runs
only when someone remembers.

Separately, constraint 2 promises "a test that disables an adapter and asserts
the feed still renders and `adapter_health` shows degraded". A grep finds
health-status unit tests (`tests/db.mjs`, `tests/roster.mjs`) but not that
test. The promise is the whole architecture, and untested it is a wish.

## What Changes

- **`Dockerfile`**: Node 22.5+ (for `node:sqlite` and strip-types), builds the
  Next app, runs `next start`.
- **`docker-compose.yml`**: the web service, a named volume for `data/` so
  the SQLite file survives a rebuild, `.env` passed through.
- **Running ingest in the container**, e.g. `docker compose run web npm run
  ingest`. The scheduler itself is out of scope — see Non-goals.
- **OAuth redirect under Docker**: the loopback redirect URI (017) must still
  work when the app runs inside a container. To be verified, not assumed.
- **GitHub Actions workflow** running `npm run verify` on push and pull
  request, plus a job that builds the image and brings up compose until the
  home page answers with a string only the app serves.
- **The missing constraint-2 test**: disable one adapter, render the feed,
  assert it is non-empty and `getHealth` reports that source degraded.
- **`DECISIONS.md` 015 corrected**, and `README.md` setup gains the Docker
  path, marked verified only once CI has run it.

## Non-goals

- The scheduler (L08). Its own change; this one only makes ingest runnable
  inside the container.
- Publishing an image to a registry.
- Screenshots in CI (`npm run shots` needs Chrome over DevTools; revisit
  separately).

## Capabilities

### New Capabilities

- `deployment`: what `docker compose up` guarantees — the app serves, the
  database persists across rebuilds, and ingest runs inside the container.

### Modified Capabilities

- `source-health`: gains the scenario that one disabled adapter leaves the
  feed rendering. It is written by `docs-to-specs`, so this change lands after
  that one. If it lands first, the scenario moves into a new spec here.

## Impact

- New files: `Dockerfile`, `docker-compose.yml`, `.dockerignore`,
  `.github/workflows/verify.yml`, one new test suite.
- `CLAUDE.md` architecture listing and commands updated (`tests/docs.mjs`
  enforces this).
- The first verification happens in CI, not locally, because Docker is not
  installed on this machine.
