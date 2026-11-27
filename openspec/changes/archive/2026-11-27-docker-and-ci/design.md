# Design

## Context

See `proposal.md` for why. What shapes the approach:

- No native modules: SQLite is `node:sqlite` (decision 012), so the image needs
  no build toolchain. The dev machine runs Node 24.15 with no `--experimental-
  sqlite` flag and `npm run verify` is green there. Which 22.x release dropped
  the flag is not verified here, which is one reason to pin 24.
- Ingest and seed run `src/` directly under `--experimental-strip-types`, so the
  image must keep the TypeScript sources and `tests/` (seed and its fixtures),
  not only the Next build output.
- The home page reads stored events (`getFeed`) and never reads
  `adapter_health`. It renders the feed whenever a token is stored, and
  `npm run seed -- --force` writes one.
- Adapters and jobs take an injectable `fetchImpl`, so a whole-run outage can
  be simulated in a suite without the network.
- The app has no login. Whoever reaches port 3000 is the owner.
- Spotify accepts plain http only on a loopback redirect URI (decision 017).

## Goals / Non-Goals

**Goals:**
- `docker compose up` works from a fresh clone plus `.env`, and CI proves it on
  every push.
- Constraint 2 is asserted, not promised.

**Non-Goals:**
- HTTPS, a reverse proxy, or any VPS recipe beyond a documented note. A VPS
  instance needs https on a real hostname for Spotify, which is setup outside
  this repo.
- Shrinking the image. Correct first; size later if it ever matters.

## Decisions

### 1. `node:24-slim`, single stage, dev dependencies kept
Node 24 is the only version `verify` has passed on. Single stage because the
runtime needs the sources anyway (decision above), so a multi-stage split saves
little. Dev dependencies stay because `next start` with a `tsconfig.json`
present may look for TypeScript, and a pruned image that fails at start is
worse than a larger one. *Alternative:* `output: 'standalone'` — rejected, it
drops `src/` and `tests/`, which ingest and seed need.

### 2. Loopback-only port, `next start -H 0.0.0.0` inside
Inside the container the server must listen on all interfaces or the published
port reaches nothing. On the host, compose publishes `127.0.0.1:3000:3000`, so
the app is reachable from the host only, and the default redirect URI
`http://127.0.0.1:3000/...` works unchanged. *Alternative:* publish on all
interfaces — rejected: an app with no login would be open to the whole network.

### 3. Named volume at `/app/data`, owned by `node`
`DATABASE_PATH=/app/data/bandelion.db` is set in compose `environment`, which
overrides `.env`. The Dockerfile creates `/app/data` owned by the unprivileged
`node` user before declaring it, so a fresh named volume inherits that owner
and the app never runs as root. *Alternative:* a bind mount to `./data` —
workable for a laptop, but it breaks on file ownership as soon as the host user
id differs from the container's.

### 4. `.env` reaches the container through `env_file`
`.env` is in `.dockerignore`, so no secret is baked into an image layer.
Compose injects it at run time. `loadDotEnv` already treats a missing `.env` as
normal, so the CLI entry points read the injected environment unchanged.

### 5. Ingest with `docker compose exec`
`docker compose exec web npm run ingest [job]` runs in the live container
against the same volume. SQLite in WAL mode already serves the app while a job
writes (decision 001). `docker compose run` also works, but starts a second
container for no benefit.

### 6. Constraint 2 is proved in two places, because it has two halves
- **`tests/degradation.mjs`** (in the suite): seed an in-memory database with
  artists and releases, run a release sweep and a cover pass whose `fetchImpl`
  fails every request, then assert every event is still returned by `getFeed`,
  health for each source is degraded or failing, and neither run reports
  complete. Verified by mutation: make the sweep delete rows before it fetches,
  confirm the suite fails, restore.
- **The container smoke job** (in CI): seed the database inside the running
  container and assert a seeded release title appears in the HTML of `/`. That
  is the "feed still renders" half, by rendering, not by reading.

The page does not read `adapter_health`, so rendering against a degraded row
would prove nothing extra. Showing health in the UI is a product change, not
part of this one.

**Added during apply:** the suite reproduced two bugs, fixed here because the
constraint-2 test cannot be green without them (decided by the owner):

- *Release sweep:* when every artist failed, the end-of-roster rewind found
  nothing (failed artists are excluded so the next run retries them) and saved
  `complete`. Now a sweep where every artist failed is saved `failed`, cursor
  cleared, and returns not complete. A sweep with some failures still completes,
  as `tests/releases.mjs` expects: the failed artists stay unstamped for the
  next run.
- *Cover pass:* a failed pass saved its cursor past the release it could not
  reach, and the next run resumed after it and reported complete having asked
  nothing — the forward-only cursor of decision 036. Now only an `idle` or
  interrupted run resumes; a run after `failed` starts from the beginning.

### 7. CI: two jobs, no live API
- **`verify`**: `actions/setup-node` with Node 24, `npm ci`, `npm run verify`.
- **`container`**: after `verify` passes. Write a `.env` from `.env.example`
  with a generated `TOKEN_ENCRYPTION_KEY` and placeholder Spotify values;
  assert `docker compose config` publishes on `127.0.0.1` only;
  `docker compose up -d --build`; poll `/` for the tagline string, which only
  the app serves (a 200 alone is not enough); `exec` the seed; assert a seeded
  release title is in `/`; `down` without `-v`, `up` again, and assert the title
  is still there.

Every CI step is offline beyond pulling the base image and npm packages.

## Risks / Trade-offs

- [Docker cannot run on the dev machine, so CI is the first run] → The
  container job is written to fail loudly with `docker compose logs` on error;
  expect a few iterations on the first PR.
- [The OAuth flow through the container is not automated] → A manual
  checklist in the README: connect, import, refresh. It needs a real Spotify
  app, which CI must not hold.
- [Image carries dev dependencies and tests] → Accepted; see decision 1.
- [A live `npm run ingest` inside the container is not exercised in CI] → The
  seed exec proves strip-types and the shared database in the container; the
  live jobs are the manual checklist.

## Migration Plan

Additive: new files, and doc updates. `npm run dev` stays the local path until
someone with Docker confirms the manual checklist; README says which path is
verified by what.

## Open Questions

- Whether `next start` really needs TypeScript at runtime. It only decides
  whether a later change can prune dev dependencies; it changes nothing here.
