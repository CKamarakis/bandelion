# Tech Debt Audit: bandlelion (package `bandelion` 0.1.0)

Generated: 2026-11-20. Protocol: `_tools/tech-debt-skill/SKILL.md` (Phase 1 orient, Phase 2 nine dimensions, Phase 3 deliverable).
Scope: whole repo at `temp/audit-1120/bandlelion` (55 commits, 2026-08-31 to 2026-09-25). Static reading plus tool output from `bandlelion-tools/` (npm audit, knip, madge, jscpd, tsc, build, coverage, churn). I did not run the app in a browser. Findings about screen behaviour come from reading the code and are marked that way.

---

## For the product manager (no code)

### Traffic light: AMBER

The product is carefully built. 92% of its code lines run under tests, the build and type check are clean, it has no circular dependencies, and almost no code is copy-pasted. But five problems are things a user would actually notice, and two of them sit right where the next feature (gigs) will be built. None of them needs a rewrite. Most are fixes of a day or less.

### The top 5 risks, in plain words

| # | Risk | What it means for users / the product | Fix before more features? |
|---|---|---|---|
| 1 | **Known security holes in the web framework, and the non-Docker setup is open to the whole network** | The framework version (Next.js 15.5.25) has 7 published security advisories, one rated critical. Separately, the README says the app only answers on your own computer. That is true with Docker, but `npm run dev` / `npm start` answer to everyone on the same Wi-Fi. The app has no login, so anyone on the café network could see your feed, change your marks, or disconnect your Spotify. | **Yes.** The network fix is one line. The framework upgrade needs a test pass. |
| 2 | **Announced releases never get updated** | Once a release is stored, it never changes. If MusicBrainz first says "2027" and later "14 March 2027", or moves the date, the feed keeps the old one forever. "Coming soon" records are the reason people use the app, and they are exactly the ones whose dates change. | **Yes.** Gigs will reuse the same storage pattern, and gig dates and sale status change even more. |
| 3 | **An import can get stuck at "running" forever** | If the app restarts in the middle of an import (a Docker restart, a crash, Ctrl-C at the wrong moment), the screen keeps saying "importing" and the Import button stays blocked. Only a terminal command fixes it, and no message says so. | **Yes.** Cheap, and every future data source runs as one of these jobs. |
| 4 | **One band with two Spotify profiles gets stuck with a misleading message** | When two Spotify artist pages belong to the same band (it happens), the second one can never be matched. Each run reports "MusicBrainz was busy, will retry", which is not true, so it fails forever. The test meant to stop two bands being merged into one cannot actually fail, so it gives false confidence. | Yes, but small. Fix the message and the test first. Merging the two profiles is a product decision (see open questions). |
| 5 | **"Adding other people" in the README does not work as described** | The README says you can add up to four more people. The app has room for only one account. When a second person connects, they replace the owner's Spotify connection, and their artists land in the owner's lists. | **Fix the README now.** Whether to build real multi-user support is a product decision. |

Also needed **before the gig sources** (not urgent today): the per-source health status ("is a scraper broken?") is recorded but never shown on any screen. The design depends on it, because gig scrapers are the parts that will break.

### Fix order recommendation
1. Before any new feature: risks 1, 3 and 5 (all small), then 2.
2. Before gigs specifically: risk 2, the health display (F11), and the shared job runner (F13), so the new sources do not copy today's three slightly different versions.
3. The planned `split-db-module` change is fine to do whenever. It is not urgent.

---

## Executive summary (engineering)

- **0 Critical, 6 High, 16 Medium, 20 Low** (42 findings). Debt is concentrated in **job orchestration** (`src/jobs/*`: stale locks, duplicated resume logic, abort handling) and **write-once event storage** (`src/db/index.ts:755-776`).
- **F01/F02:** `next@15.5.25` has 7 advisories (1 critical per npm audit). `next dev`/`next start` bind `0.0.0.0` by default (verified in `node_modules/next/dist/bin/next`), which contradicts README's loopback promise for the non-Docker path.
- **F07:** `insertReleaseEvent` is `ON CONFLICT DO NOTHING`. Date refinements, postponements and retitles from MusicBrainz never land. This is the core value (upcoming records) and it is the pattern gigs will inherit.
- **F06/F14:** `job_state.status='running'` has no heartbeat or expiry. A restart mid-run blocks `POST /api/roster` and leaves the UI polling forever. The CLI ignores the lock entirely.
- **F08/F09:** `artists.mbid UNIQUE` violations are caught as "transient MusicBrainz failures". The anti-merge test passes no matter what triage does.
- **F10:** README "Adding other people" vs `LOCAL_USER_ID = 1` everywhere: a second login overwrites the owner's tokens.
- **F11/F12:** The adapter contract (`SourceAdapter.fetch`, `adapter_health` "surfaced in the UI") is ceremonial. No production code calls `.fetch()`, the `registry.ts` it refers to doesn't exist, and `getHealth` has no UI consumer.
- **F22:** `npm test` fails on a Windows checkout with `core.autocrlf=true` (`tests/docs.mjs:173`, `.` doesn't match `\r`). Confirmed in the tool run (`tests-cov.log:448`). The maintainer works on Windows.
- Test debt is lower than the scenario scanner suggests. Of 12 "missing" scenarios, **only 2 are really untested**. The real gaps are `jobs/liked.ts` (38% lines), the cover-art success path, and the token refresh path.
- Healthy fundamentals: tsc clean, build clean, madge no cycles, jscpd 0.77% duplication, AES-GCM token storage, CI that boots the real container.

---

## Architectural mental model

Bandelion is a single-user, self-hosted Next.js 15 App Router app over a synchronous `node:sqlite` database (`src/db/index.ts`, one 1,201-line module holding every query plus an append-only `PRAGMA user_version` migration list). Data enters only through **CLI jobs** (`src/jobs/cli.ts`: `roster`, `liked`, `resolve`, `releases`, `covers`) and one web-triggered job (`POST /api/roster` runs `importRoster` detached in the server process). Each job is a hand-written checkpoint loop over `job_state` (cursor + status), calling thin HTTP helpers in `src/adapters/*` (Spotify `/me/following` + `/me/tracks`, MusicBrainz url/search/browse with 8-try backoff, Cover Art Archive). Identity resolution goes Spotify-URL join → name search → `triage()` rules → `match_queue` for a human (`/review`). The UI is three server-rendered pages (feed, playlist, favs) plus review. All filtering and paging happen client-side in `Feed.tsx` over the whole feed (up to 5,000 rows) shipped in the HTML. Flags (`queued/listened/favorited`) are written per-key via `POST /api/events/[id]/state`. Auth is Spotify PKCE with AES-256-GCM tokens at rest, for exactly one local user (`LOCAL_USER_ID = 1`). There is no app login. Safety relies on the loopback-only Docker port, which CI asserts.

**Where this contradicts the docs (itself a finding):**
- (a) `src/adapters/types.ts` and CLAUDE.md describe a `SourceAdapter` registry with `fetch()` as the integration point and "health surfaced in the UI". In reality jobs bypass `fetch()`, no registry exists, and health is never rendered.
- (b) The README says the non-Docker run is "the same address", but it binds all interfaces.
- (c) The README implies multi-user. The code is single-user.
- (d) `.env.example` documents `BANDELION_TIMEZONE` as driving "this week"; nothing reads it.

Churn (`bandlelion-tools/churn.txt`) concentrates in UI (`globals.css` 21, `Feed.tsx` 16, `page.tsx` 15) and `db/index.ts` (14). The intersection of largest and most-changed is `globals.css`, `db/index.ts` and `Feed.tsx`. Only `db/index.ts` carries real structural debt (and it already has a proposal: `openspec/changes/split-db-module/proposal.md`).

---

## Findings

Severity is impact on this repo. Effort: S < ½ day, M ≤ 2 days, L > 2 days.

| ID | Category | File:Line | Sev | Eff | Description | Recommendation |
|---|---|---|---|---|---|---|
| F01 | Dependency | package.json:16 (lock: next 15.5.25) | High | M | npm audit: `next` critical, 7 advisories (e.g. GHSA-2464-fhr4-w9xw Image Optimization RCE with SVG, GHSA-mcj8-r9mp-w47p cache poisoning, GHSA-pc58-hwjq-p385 response injection). Applicability is partly reduced: no `next.config`, no `next/image`, every page is `force-dynamic`. **Unverified** which advisories reach this app. | Upgrade to the patched line (`fixAvailable: true`; may be a major bump, so **unverified**). Run `npm run verify` and the CI container job. |
| F02 | Security / Doc drift | package.json:7,9; README.md (Setup §3, "Without Docker…") | High | S | `next dev`/`next start` default to `0.0.0.0` (verified: `node_modules/next/dist/bin/next` option text). README promises "the same address" (loopback). The app has no auth, so on a LAN anyone can read the feed, toggle flags, start imports and disconnect Spotify. | `"dev": "next dev -H 127.0.0.1"`, `"start": "next start -H 127.0.0.1"`. The Dockerfile already overrides with `-H 0.0.0.0` inside the container, so it is unaffected. |
| F03 | Security | src/app/api/auth/disconnect/route.ts:20; src/app/api/events/[id]/state/route.ts:33; src/app/api/review/[id]/route.ts:42; src/app/api/roster/route.ts:22 | Medium | S | No Origin/CSRF check on any state-changing POST. `request.json()` accepts a cross-site `text/plain` body, and disconnect needs no body at all. The disconnect comment (route.ts:4-5) claims POST alone stops "any page on the internet". It doesn't stop a cross-site form POST. Browser local-network protections may mitigate this (**unverified**). | Reject when `Origin` ≠ `new URL(cfg.spotify.redirectUri).origin`. One shared helper for the 4 routes. |
| F04 | Security | src/auth/spotify.ts:19-31 | Low | S | `user-top-read` is requested but never used (grep: no `/me/top`). The comment claims a "fallback" that does not exist. | Drop the scope, or build the fallback. Least privilege. |
| F05 | Dependency | package-lock.json (postcss, sharp, zod, source-map-js) | Low | S | 4 transitive highs, mostly build-time or reached via next. | Resolved by F01's upgrade. Re-run `npm audit`. |
| F06 | Error handling | src/app/api/roster/route.ts:27; src/jobs/roster.ts:123-128; src/app/RosterImport.tsx:61-80 | High | S | `status='running'` is the lock, with no heartbeat or expiry. A process killed mid-run leaves it set: POST returns the stale status forever, and the UI shows "running" and polls every 2 s indefinitely. `cli.ts:316` ignores the lock, so CLI and web can run the same job concurrently. | Treat `running` with `updated_at` older than N minutes as stale. Or reset `running → idle` in `openDatabase`, since one process owns the DB. Have the CLI check the lock too. |
| F07 | Architectural / Correctness | src/db/index.ts:755-776 | High | M | `ON CONFLICT (source, source_event_id) DO NOTHING`: a release's `event_date`, `date_precision`, `title`, `release_type` are frozen at first sight. Year→day refinements and postponements never land. Removed release-groups are never removed. | `DO UPDATE SET title, event_date` (and `release_details` precision/type) while keeping `first_seen_at`. Add a test: re-sweep with a refined date. Decide removal separately. |
| F08 | Error handling | src/jobs/resolve.ts:218-224, 295, 338; src/db/index.ts:680, 961; src/db/schema.sql:24 | High | S | `artists.mbid UNIQUE`: two roster rows that resolve to one MBID (two Spotify profiles for one act) throw in `setArtistMbid`. The throw is caught as a *transient* failure and the CLI prints "could not be reached… will be retried" (cli.ts:121-125) every run, forever. In the review route, `confirmReviewMatch` (unguarded `UPDATE`) surfaces as a generic 500 `write_failed`. | Detect `UNIQUE constraint failed: artists.mbid` and record a distinct outcome ("already assigned to artist X"). Queue it for a human. Return 409 from the review route. |
| F09 | Test debt | tests/resolve.mjs:303-353 | Medium | S | "Two bands with one name never merge" cannot fail. If triage mapped both WITCHes to one MBID, the UNIQUE constraint plus the transient catch (F08) would leave one row null, and both assertions (`distinct mbids`, `WITCH ≠ Witch`) still pass. | Also assert `result.transientFailures === 0` and each row's expected MBID from the fixture. Break triage once to prove it fails (the project's own rule). |
| F10 | Doc drift / Product | README.md:174-182; src/auth/session.ts:15; src/app/api/auth/callback/spotify/route.ts:139 | High | S (doc) / L (feature) | README invites up to four more people. Every token, list and flag uses `LOCAL_USER_ID = 1`, so a second person's login overwrites the owner's tokens, and their imports set `followed/liked` on user 1. `getFeed`/`getFlaggedEvents` also join `user_artists` without `user_id` (src/db/index.ts:500, 618). | Now: README says one Spotify account per instance, and that others should run their own copy. Later, if wanted: per-session user id. |
| F11 | Observability | src/db/index.ts:1033-1085; src/adapters/types.ts:31-34; openspec/specs/source-health/spec.md:6 | Medium | M | `adapter_health` is written by every job, but `getHealth` has no consumer (knip). The comments and spec purpose say "user-visible… an empty feed must be able to say WHY". The constraint-2 promise is half met. | A small health strip in the Masthead (status + `lastError`) when any source is not `ok`. Do it before gig scrapers. |
| F12 | Architectural decay | src/adapters/spotify.ts:392-411; src/adapters/musicbrainz.ts:493-519; src/adapters/types.ts:5 | Medium | M | The `SourceAdapter.fetch()` implementations are stubs returning `complete:false`. Production never calls them (knip: unused exports). `registry.ts` does not exist. The real helpers throw (musicbrainz.ts:134,163,169), and the never-throws rule is enforced only by job try/catch. `spotifyAdapter.kind` still lists `'release'` (spotify.ts:394) after decisions 032/039. | Before gigs: either make jobs consume adapters through `fetch()`, or rewrite `types.ts` to describe the real pattern (helpers + job-level containment). Delete the stubs or the registry claim. |
| F13 | Architectural decay | src/jobs/resolve.ts:161-254; src/jobs/releases.ts:175-256; src/jobs/covers.ts:118-186; src/jobs/liked.ts:133-243 vs roster.ts:130-200 | Medium | M | 3 near-identical checkpoint/rewind/handled/health loops with diverging semantics. Covers restarts after `failed` (covers.ts:118); resolve/releases resume. The decision-036 forward-cursor bug had to be found and fixed in each one separately. liked/roster are a jscpd clone pair. | Extract `runCheckpointed({ select, handle, onHealth })` with one rewind policy. Port one job per change. |
| F14 | Error handling | src/adapters/coverart.ts:80; src/jobs/covers.ts:90-187; src/jobs/cli.ts:224 | Medium | S | Ctrl-C during a cover request rethrows the abort out of `importCovers` (no try/catch). The CLI has no catch, so you get a stack trace and the job is left `running` (feeds F06). In resolve, an abort is counted as a transient failure (resolve.ts:220-224). | Wrap `importCovers` like the other jobs. Treat `AbortError` as a clean stop everywhere. |
| F15 | Consistency / Doc drift | .env.example:20-21; src/config.ts:44; src/app/page.tsx:96; src/db/index.ts:544-546 | Medium | S | `BANDELION_TIMEZONE` is parsed but never used. "Today" is UTC everywhere. Between 00:00 and 01:00/02:00 Berlin time, "This Week", "Coming/Out now" and countdowns are a day off (by reading). | Compute `today` with `Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone })` in one helper. Use it in page, db and jobs. |
| F16 | Error handling | src/db/index.ts:141-173 (166-168) | Medium | S | `migrate()` swallows `no such table`, then bumps `user_version`. A typo in a future migration's table name is skipped permanently with no error. | Accept only `duplicate column name`. Have the partial-DB test build the tables it needs. |
| F17 | Architectural decay | src/db/index.ts (1,201 LOC, ~35 exports) | Medium | M | God module across 8 areas. Already proposed in `openspec/changes/split-db-module/proposal.md`. | Proceed as proposed (barrel kept). Do it before gigs add a second event type. |
| F18 | Architectural decay | src/app/Feed.tsx (839 LOC) | Medium | M | One client component owns 7 filter states, month packing, paging, scroll and render. Second-highest churn (16 commits). | Extract `useFeedFilters` (state + memo chain) and `MonthPager`. Keep markup. |
| F19 | Test debt | src/jobs/liked.ts:100-243 (cov 38% lines / 22% branches) | Medium | S | `importLiked` resume, token failure, page failure and the short-read check (liked.ts:207-218) are unexecuted. `tests/liked*.mjs` cover the adapter and DB, not the job. | Mirror `tests/roster.mjs` job tests against `spotify-liked.json`. |
| F20 | Test debt | src/adapters/coverart.ts:61-117 (cov 33% funcs, 42% branches); tests/fixtures/ | Medium | S | No Cover Art Archive fixture. CLAUDE.md constraint 1 says "every adapter ships with a captured fixture". The success path (redirect → `res.url` stored) is never exercised; only the 5xx path is (degradation.mjs). | Record one 307→image fixture. Test "Cover exists" and "No art (404)". |
| F21 | Test debt | src/auth/session.ts:53-97 (cov 60%) | Medium | S | The `getAccessToken` refresh branch (expired → refresh → re-encrypt → save) is not run in-process. This is the path every long ingest relies on. | Inject `fetchImpl` into `refreshAccessToken` via session, and test expired → refreshed. |
| F22 | Test debt / Tooling | tests/docs.mjs:173; (no .gitattributes) | Medium | S | The regex `\|.*\n` fails on CRLF (`.` excludes `\r`). Fresh Windows clone with autocrlf → `npm test` red (`bandlelion-tools/tests-cov.log:448`, verified README is CRLF). | Add `.gitattributes` (`* text=auto eol=lf`) **or** use `\r?\n` in the test. |
| F23 | Error handling / UX | src/app/page.tsx:181; src/app/api/auth/disconnect/route.ts:20-22 | Medium | S | The Disconnect button is a native form POST, and the route returns JSON, so the user lands on a raw `{"connected":false}` page (by reading; not run in a browser). | `NextResponse.redirect(new URL('/', req.url), 303)` for form posts. Keep JSON for `fetch`. |
| F24 | Doc drift | docs/LIMITS.md:270-296 | Medium | S | L10 says the fallback "does not search the alias field". The code does (`src/adapters/musicbrainz.ts:225-226`). The limit is half-lifted but reads as open, so the improvement queue is wrong. | Update L10 (what is lifted, what remains: renames and normalisation). |
| F25 | Consistency | src/jobs/resolve.ts:302-314 vs 343-353 | Low | S | Link-fetch block duplicated verbatim inside `resolveOne`. | `storeLinks(db, artistId, mbid, client)`. |
| F26 | Dead code | src/db/index.ts:513 (`getListCounts`), 1025 (`getAliases`), 650 (`getRoster`); src/auth/session.ts:99 (`isConnected`) | Low | S | Unused in production (knip). `getListCounts` became dead when the nav counts went (Masthead.tsx:22). | Delete, or mark test-only. |
| F27 | Dead code | src/app/page.tsx:294-305; src/jobs/resolve.ts:290,296,370; src/db/index.ts:383-387 | Low | S | Unused styles `actions/meta/metaKey/metaVal` (moved to RosterImport). `method` variable kept alive with `void method`. `followArtist(source)` wrapper that throws for anything but `'spotify'`. | Remove. |
| F28 | Doc drift | src/db/index.ts:719-741, 778; src/app/page.tsx:1-8, 37 | Low | S | `queueForReview`'s docblock sits above `ReleaseEventRow`. Orphan "Stamp when an artist was last swept" sits above `setCoverArt`, and `markReleaseCheck` has none. The page header says "The connect screen" but it is the feed home. | Move or fix the comments. |
| F29 | Architectural | src/db/index.ts:964; src/jobs/resolve.ts:339; src/matcher/match.ts | Low | S | Aliases are write-only. Triage and review write `artist_aliases` "so the next source matches without asking", but no production path reads them. Re-asking is actually prevented by `mbid IS NOT NULL`. | Fine until gigs. Note in LIMITS so nobody assumes it works. |
| F30 | Correctness | src/app/api/review/[id]/route.ts:70; src/db/index.ts:874 | Low | S | The route finds a row by scanning `getReviewQueue(…, limit=500)`. Past 500 pending rows, later rows return 404 `unknown_or_decided`. Measured queue is 264, so this is latent. | `getReviewRow(db, queueId)` with a `WHERE q.id = ?`. |
| F31 | Correctness | src/app/Feed.tsx:429-434 | Low | S | The "showing the newest N" truncation label checks 4 filters but not `week`. | Add `week === 'all'`. |
| F32 | Performance | src/db/index.ts:620-622 | Low | S | Server ORDER BY uses the stale `is_upcoming` snapshot that readers no longer trust (db:551-567). The client re-sorts (`Feed.tsx` `.sort(byDate(sort))`), so the effect is limited to the 5,000-row cap choosing by stale order. | Order by `event_date > date('now')`. |
| F33 | Performance | src/app/page.tsx:124 | Low | S | The whole feed (≤5,000 rows) is serialized into every home render. This is fine at 599 rows, but it grows without bound because releases never leave (F07). | Revisit with the F07 removal policy. Server-page if more than ~2k. |
| F34 | Consistency | src/jobs/cli.ts:49-55,139-145,198-205, 99,168,226 | Low | S | MUSICBRAINZ_CONTACT check ×3 and the UA string `Bandelion/0.1 ( … )` ×3, with the version hardcoded (package.json says 0.1.0). | One `mbContact(cfg)` helper. Read the version from package.json. |
| F35 | Consistency | src/adapters/musicbrainz.ts:44, 93; src/adapters/coverart.ts:31, 119; src/adapters/spotify.ts:380 | Low | S | `MIN_INTERVAL_MS` ×2 and the error-text helper ×3. | `src/adapters/http.ts`. |
| F36 | Type debt | src/adapters/types.ts:16-22; src/jobs/covers.ts:170,185; src/db/index.ts:1037,1056 | Low | S | Health is recorded under `'coverartarchive'`, which is not in `SourceId`. `recordSuccess/Failure(source: string)`. | Add it to the union and type the parameter as `SourceId`. |
| F37 | Consistency | src/db/index.ts:795-799 vs schema `datetime('now')` | Low | S | Two timestamp formats: JS ISO `…T…Z` (`last_release_check_at`) vs SQLite `YYYY-MM-DD HH:MM:SS` (every other `*_at`). These are only compared within one column today, but they misorder as soon as they are compared across columns. | Pick one. Use `datetime('now')`, or ISO everywhere. |
| F38 | Config | src/config.ts:28-30, 66-71; .env.example:27-41 | Low | S | `TICKETMASTER_API_KEY`, `ENABLE_*` are parsed and documented, but nothing reads them (gigs are unbuilt). | Comment "not read yet" in .env.example, or drop until L07. |
| F39 | Error handling | src/app/RosterImport.tsx:84-92 | Low | S | A failed start (409 `not_connected`, 500) just resets the button, with no message. The route carefully returns a `detail` (roster/route.ts:37). | Show `detail` in the panel's error line. |
| F40 | Correctness | src/matcher/triage.ts:174-175 | Low | S | A sole candidate in another script is accepted with reason `'sole-exact-match'`, so the alias `source` (`triage:sole-exact-match`) misdescribes a non-exact acceptance. That is the audit trail the comments say matters (db:1005-1012). | New reason `'sole-uncomparable'`. |
| F41 | Performance | src/adapters/coverart.ts:73-113 | Low | S | Follows the redirect and downloads the image body only to read `res.url`. The body is never consumed, which wastes bandwidth and holds the socket until GC. | `redirect: 'manual'` and read `Location`, or `res.body?.cancel()`. |
| F42 | Error handling | src/auth/session.ts:61-97 | Low | S | Concurrent callers (web import + CLI) can both refresh an expired token. Harmless unless Spotify rotates refresh tokens (**unverified**). | In-process promise memo. Acceptable to defer. |

Counts (from the table): **Critical 0 · High 6 (F01, F02, F06, F07, F08, F10) · Medium 16 · Low 20 = 42.** F11 (health not shown) and F12 (adapter contract) are Medium today but become High once gig scrapers exist.

---

## Top 5: if you fix nothing else, fix these

### 1. F02 + F01: bind loopback, then upgrade Next
```diff
- "dev": "next dev",
- "start": "next start",
+ "dev": "next dev -H 127.0.0.1",
+ "start": "next start -H 127.0.0.1",
```
The Dockerfile CMD keeps `-H 0.0.0.0` (needed inside the container). Then bump `next` to the advisory-fixed release, run `npm run verify` plus the CI container job, and re-run `npm audit`. If the fix is Next 16, read its upgrade notes first.

### 2. F07: let a re-sighting refresh the facts, not the novelty
```sql
INSERT INTO events (...) VALUES (...)
ON CONFLICT (source, source_event_id) DO UPDATE SET
  title = excluded.title,
  event_date = excluded.event_date,
  payload_json = excluded.payload_json
  -- first_seen_at deliberately untouched: it is "new to you"
```
Then `UPDATE release_details SET date_precision = ?, release_type = ? WHERE event_id = (SELECT id FROM events WHERE source='musicbrainz' AND source_event_id=?)`. Return `{ written, updated }` so the CLI can say "2 dates changed". Test: sweep once with `"2027"`, then re-sweep with a fixture saying `"2027-03-14"`, and assert the feed shows `14 Mar`. Removal of vanished release-groups is a separate decision.

### 3. F06 + F14: make "running" expire
In `openDatabase` (single process owns the DB file):
```ts
db.prepare(`UPDATE job_state SET status='idle', last_error='interrupted'
             WHERE status='running' AND updated_at < datetime('now','-10 minutes')`).run();
```
Plus: in `POST /api/roster`, treat `running` as stale when `updated_at` is old. Make the CLI check `loadJob(...).status` before starting. Wrap `importCovers` in try/catch so an abort saves `idle`. Note: `saveJob` already bumps `updated_at` per page or artist, so it works as a heartbeat for free. The CLI and web server are separate processes, so the reset must use the age test, never "reset all on open".

### 4. F08 + F09: name the collision, and make the anti-merge test bite
```ts
// resolve.ts, inside the per-artist catch
const msg = err instanceof Error ? err.message : String(err);
if (/UNIQUE constraint failed: artists\.mbid/.test(msg)) { collisions++; queueCollision(db, artist, mbid); }
else { transientFailures++; lastTransientError = msg; }
```
The CLI prints "N artist(s) share a MusicBrainz identity with another row: decide in Review". Review route: catch the same message and return 409 `already_assigned`. In `tests/resolve.mjs:336-353`, add `check(result.transientFailures === 0)` and fixture-expected MBIDs for both rows. Then break the spelling rule once and confirm the test goes red.

### 5. F10: make the README true today
Replace "Adding other people" with: "One Spotify account per instance. Anyone else who connects replaces you. Friends should run their own copy (five-minute setup); the 5-user allowlist is Spotify's limit per *app*, and each copy has its own app." If multi-user is wanted later, the schema already carries `user_id`. The work is a session→user mapping plus `user_id` on the `user_artists` joins (db:500, 618).

---

## Quick wins (Low effort × Medium+ severity)
- [ ] F02: `-H 127.0.0.1` on `dev`/`start`
- [ ] F03: shared Origin check on the 4 POST routes
- [ ] F06: stale-`running` age test in roster route + `openDatabase`
- [ ] F08: distinguish UNIQUE(mbid) from transient. 409 in the review route
- [ ] F09: tighten the anti-merge assertions
- [ ] F10: README "Adding other people" rewrite
- [ ] F14: try/catch + abort-as-stop in `importCovers`
- [ ] F15: one timezone-aware `today()` helper
- [ ] F16: only swallow `duplicate column name` in `migrate`
- [ ] F19/F20/F21: liked job tests, cover-art fixture, refresh-path test
- [ ] F22: `.gitattributes` or `\r?\n` in `tests/docs.mjs:173`
- [ ] F23: 303 redirect from disconnect for form posts
- [ ] F24: update LIMITS L10

---

## Test debt detail and scenario calibration

Tool numbers (`bandlelion-tools/coverage/coverage-summary.json`): 92.5% lines, 83.5% branches, 92.8% functions. The weakest are `use-event-flags.ts` 38% (client hook, expected), `jobs/liked.ts` 38%, `auth/session.ts` 60%, `jobs/covers.ts` 80% lines / 47% branches, and `adapters/coverart.ts` 33% functions. `tests-cov` exited 1 only because of `docs.mjs` (F22).

**Scanner calibration** (`bandlelion-scenarios.json`: 78 scenarios, 28 named / 9 maybe / 41 missing).

12 "missing" checked by reading `tests/*.mjs`:

| Scenario (cap) | Verdict | Evidence |
|---|---|---|
| Cover exists (cover-art) | **Untested** | No CAA success fixture. `coverart.ts` success branch not covered |
| Archive unreachable (cover-art) | Tested | `degradation.mjs:114-138` (503 for whole pass, left unchecked, retried). Socket-error variant not exercised |
| Web mode click (artist-links) | **Untested** (manual checklist only) | `artist-link.mjs:66-76` is a hand-run comment. Only the mode/URL is asserted |
| Exact spelling breaks a tie (identity) | Tested | `triage.mjs:86-95` (The IronY at 99 beats The Irony at 100), `:43-44` |
| Two same-named acts in the roster (identity) | Tested, but weak | `resolve.mjs:303-353`. The assertion cannot fail (F09) |
| Links recorded (identity) | Tested | `resolve.mjs:273-276` (stored, no spotify), `:539-541` (once each) |
| Year-precision record (release-feed) | Tested (formatter level) | `feed.mjs:30, 59-62`. Not a rendered card |
| Re-running the sweep (release-sweep) | Tested | `releases.mjs:362, 448` (`second.written === 0`) |
| Deciding twice (review-queue) | Tested (status only) | `review.mjs:136-138` asserts 404. "Nothing is written" is implied by surrounding count checks |
| Same name, different Spotify ids (roster) | Tested | `roster.mjs:487-510`, `db.mjs:160+` (WITCH/Witch, 2× Pentagram) |
| Rate limited (source-health) | Tested | `spotify.mjs:117-122` (429 + retry-after 30) |
| Tampered or wrongly keyed ciphertext (spotify-auth) | Tested | `auth.mjs:89-99` |

**Result: 2 of 12 "missing" are really untested (17%). 10 are tested under another name.** The scanner overcounts "missing" by roughly 5×. The ~41 "missing" probably means about 7-10 truly untested (an extrapolation, not checked).

5 "named" checked:

| Scenario | Named file | Does it test the behaviour? |
|---|---|---|
| Unknown value (artist-links) | artist-link.mjs | Yes, at config level (`:47-48`, `'desktop'` → app). Click behaviour not exercised |
| Partial write (event-flags) | state.mjs | Yes (`:200-215`, listened then favorited, queued survives) |
| Future release (release-sweep) | state.mjs | **Wrong file.** state.mjs tests the *feed's* derived upcoming (`:344`). The sweep behaviour is really tested in `releases.mjs:191-198, 247` |
| Before any import (roster-import) | record-fixture.mjs | **Wrong file.** It's a hand-run script excluded from the suite (`run.mjs:26`), and the match is a code comment (`:35`). Really tested in `roster.mjs:440-444` |
| Count agrees with the list (review-queue) | review.mjs | Yes (`:96, 119, 128, 180, 201`) |

**Result: 3 of 5 named files really test the behaviour. 2 of 5 are false matches on words, but the behaviour is tested elsewhere. 0 of 5 are untested.** Treat "named" as a pointer, not proof.

---

## Things that look bad but are actually fine

- **Comment density (often more comment than code).** This is a stated convention (CLAUDE.md "Comments explain why"), and most comments carry measured evidence (row counts, dates, decision numbers) that would otherwise be lost. Drift exists (F24, F28) but is local.
- **`globals.css` at 1,286 lines, the top churn file.** It is the design system, with hex values asserted against `docs/DESIGN.md` by `tests/contrast.mjs`. Size reflects the flyer aesthetic, not tangled logic.
- **SQL string interpolation** in `setEventFlags` (db:456-462) and `getFlaggedEvents` (db:501). Both interpolate only whitelisted literals (closed tuple or literal union). There is no path from request input. Parameter values are bound.
- **Manual `BEGIN/COMMIT/ROLLBACK`** in 4 places. `node:sqlite`'s `DatabaseSync` has no `.transaction()` helper. The pattern is correct and short.
- **Migrations not wrapped in a transaction.** Every statement is an idempotent `ADD COLUMN`/`CREATE INDEX IF NOT EXISTS`/backfill, so a crash mid-migration re-runs cleanly. (The `no such table` swallow is flagged separately, F16.)
- **knip's 31 "unused exports" and 23 "unused files".** There's no `knip.json`, so the test files aren't treated as entries. `classifyLink`, `datePrecision`, `triage` helpers, `JOB_NAME`s and `*Error` classes are exported for tests. Only F26 items are really dead.
- **knip "unused devDependency" `@fission-ai/openspec`.** It's the planning CLI (`openspec/`), used by humans, not imported.
- **`src/matcher/match.ts` used only by `tests/matcher.mjs`.** It is the gig-listing matcher with an eval set (`npm run eval:matcher`) built ahead of L07. This is intentional preparation, and it's cheap to keep.
- **MusicBrainz client: 8 attempts, backoff to 15 s, retry on every 5xx.** It looks over-patient, but it is backed by measured 503 bursts (decision 033, LIMITS L03).
- **Hand-rolled `.env` loader** (`src/config-env.ts`) instead of dotenv. It's documented, 39 lines, 100% covered, and avoids a dependency for a handful of keys.
- **`is_upcoming` stored but distrusted.** Readers derive it from the date (db:551-567), and the comment explains why. Only the sort still uses it (F32, Low).
- **No app login.** It's a deliberate single-owner design, and CI asserts the Docker port is loopback-only (`.github/workflows/verify.yml`, "published on loopback only"). The real gap is only the non-Docker path (F02).
- **The importers never delete artists or unfollows.** It's a documented honesty rule (partial import ≠ unfollow). Removing would need a complete-read proof first.
- **The Docker image keeps dev deps, `src/` and `tests/`.** It's needed because ingest and seed run TS directly under `--experimental-strip-types`. This is documented in the Dockerfile.
- **Single 1,201-line DB module.** The size is real (F17), but there are no cycles (madge) and the split is already proposed, so it doesn't need escalating.
- **Token crypto.** AES-256-GCM, a fresh 96-bit IV, an auth tag, a versioned `v1.` format and strict key validation are all correct as written.

---

## Open questions for the maintainer

1. **Multi-user:** is "Adding other people" meant to work on one instance (needs real per-user sessions), or should the README say one account per copy? (F10)
2. **Release updates:** should a refined or postponed date overwrite silently, or should the feed mark "date changed"? Should vanished release-groups be removed or kept? (F07)
3. **Two Spotify profiles → one MBID:** merge into one artist, allow both rows the same MBID (drop UNIQUE), or queue for a human? (F08)
4. **Next upgrade path:** does the advisory fix need Next 16? Is `/_next/image` reachable with no `next.config`? (F01, **unverified**)
5. **Health UI:** is a source-health display planned? No LIMITS entry covers it. (F11)
6. **`user-top-read`:** a planned fallback, or a leftover? (F04)
7. **Aliases:** intended as the gig matcher's input (via `match.ts` `buildIndex`)? If so, record that in LIMITS. (F29)
8. **Adapter contract:** keep `SourceAdapter.fetch()` as the gig integration point, or document jobs-call-helpers as the real pattern? (F12)

---

## Tool output used (bandlelion-tools/)

`summary.txt`: audit exit 1 (1 critical, 4 high), knip exit 1, madge exit 0 (no cycles), jscpd exit 0 (6 clones, 72 lines, 0.77%), tsc exit 0 (empty log), tests-cov exit 1 (docs.mjs only), build exit 0. `churn.txt` used for hot files. Not run by me: depcheck (knip covered unused deps), browser and screenshot suites, the CI container job.
