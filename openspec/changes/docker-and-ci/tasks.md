# Tasks

## 1. Constraint 2 in the suite

- [x] 1.1 Write `tests/degradation.mjs`: in-memory database with artists and stored releases, a release sweep and a cover pass whose `fetchImpl` fails every request; assert every event is still in `getFeed`, both sources are degraded or failing, and neither run reports complete. Verify with `node tests/run.mjs` green
- [x] 1.2 Verify the suite by mutation: make the sweep delete stored rows before fetching, confirm `tests/degradation.mjs` fails, restore
- [x] 1.4 Fix the release sweep reporting `complete` when every artist failed: save it as failed with the cursor cleared, so the next run retries every unstamped artist; verify the degradation suite's completion check passes, then re-break the fix and confirm it fails; `tests/releases.mjs` stays green
- [x] 1.5 Fix the cover pass resuming past a release it could not reach: a run after a failed pass starts from the beginning; verify the degradation suite's retry check passes, then re-break the fix and confirm it fails
- [x] 1.3 Update CLAUDE.md constraint 2 (the test is no longer "owed") and add the suite to the architecture listing and to the `docs/TESTING.md` suites table; verify `node tests/docs.mjs` passes

## 2. Container

- [x] 2.1 Add `.dockerignore` excluding `node_modules`, `.next`, `data`, `.env*` (keeping `.env.example`), `tests/shots` and `.git`; verify by listing the build context size is small and `.env` is absent from it
- [x] 2.2 Add `Dockerfile`: `node:24-slim`, `npm ci`, `npm run build`, `/app/data` created and owned by `node`, runs as `node`, `CMD` is `next start -H 0.0.0.0 -p 3000`; verified by the CI container job in group 3
- [x] 2.3 Add `docker-compose.yml`: service `web`, `env_file: .env`, `DATABASE_PATH=/app/data/bandelion.db`, named volume at `/app/data`, port `127.0.0.1:3000:3000`; verified by the CI container job in group 3
- [x] 2.4 Update CLAUDE.md commands (drop "not written yet"; add `docker compose exec web npm run ingest`) and the architecture listing for the three files; verify `node tests/docs.mjs` passes

## 3. CI

- [x] 3.1 Add `.github/workflows/verify.yml` job `verify`: Node 24, `npm ci`, `npm run verify` on push and pull request; verify it goes green on the PR
- [x] 3.2 Add job `container` after `verify`: write `.env` from `.env.example` with a generated key; assert `docker compose config` publishes on `127.0.0.1` only; `up -d --build`; poll `/` for the tagline; on failure print `docker compose logs`; verify it goes green on the PR
- [x] 3.3 In `container`, `exec` the seed, assert a seeded release title is in `/`, then `down` without `-v`, `up`, and assert the title survives; verify green on the PR, then break it once (assert a title that is not seeded), confirm red, restore
- [x] 3.4 Grep the workflow for any host other than the npm registry, GitHub and Docker Hub; verify none

## 4. Docs

- [x] 4.1 README setup: a Docker path next to `npm run dev`, with `.env`, `docker compose up`, `docker compose exec web npm run ingest`, and a note that the app is loopback-only and a VPS needs https on a real hostname for Spotify; verify `node tests/docs.mjs` passes
- [x] 4.2 README manual checklist for what CI cannot hold a Spotify app for: connect through the container, run `ingest`, restart, confirm still connected; mark the Docker path "verified in CI" and the checklist "not yet run" until someone runs it
- [x] 4.3 Append to `docs/DECISIONS.md` 015 the date CI first ran the container job, and a new decision for loopback-only publishing; verify the LIMITS→DECISIONS citation check still passes

## 5. Integration

- [x] 5.1 Run `npm run verify` once locally and capture the output; green
- [x] 5.2 Push, and confirm both CI jobs are green on the PR with the run URL in the report
