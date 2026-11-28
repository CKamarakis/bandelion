# Bandelion: do the docs match what is built?

Audit date: 2026-11-20. This is a read-only audit of the clone at `temp/audit-1120/bandlelion`, on branch `docker-and-ci` at commit `4f3bcfc`. Nothing was run, installed or edited. All paths below are relative to the repo root.

## Traffic light: AMBER

- **Mostly yes.** The 10 behaviour specs were written from the code on 2026-09-25 and still describe it well. Of 51 requirements, 29 match fully, 19 match with gaps, and 3 do something different.
- **Nothing has been built "off the books" since specs were introduced.** Every code change after 2026-09-25 belongs to a planned change. The roughly 40 earlier commits came before specs existed, and the specs were written afterwards to cover them.
- **A few real behaviour bugs hide behind matching docs:**
  - An artist you reject in Review is likely asked about again later.
  - "Oldest first" puts released records above upcoming ones.
  - One big month can join the page before it instead of getting its own page.
- **The latest finished work is not filed.** The Docker/CI change has every task ticked but is not archived. The `main` branch is 11 commits behind this branch, so it lacks Review, triage, specs and Docker.
- **Some user-facing claims are out of date.** The README describes a "From liked songs" mark that was removed. The tagline and connect text promise "gigs", which do not exist. `.env.example` says the timezone setting drives "this week", but nothing reads it.

---

## 1. Inventory

**PRDs:** none. No PRD file and no `knowledge/` folder exist. `docs/PRODUCT.md` (product rules with reasons) is the closest thing, so section 2 uses it in place of a PRD.

### Main specs (`openspec/specs/`)

| Capability | Requirements | Scenarios |
|---|---|---|
| artist-links | 4 | 5 |
| cover-art | 3 | 4 |
| event-flags | 6 | 7 |
| identity-resolution | 5 | 9 |
| release-feed | 7 | 10 |
| release-sweep | 5 | 6 |
| review-queue | 4 | 6 |
| roster-import | 6 | 10 |
| source-health | 4 | 8 |
| spotify-auth | 7 | 13 |
| **Total** | **51** | **78** |

### Changes

| Change | State | Notes |
|---|---|---|
| `archive/2026-09-25-docs-to-specs` | archived | Created all 10 specs. The main specs are identical to its deltas (diffed). Tasks: 19 of 19 done. |
| `docker-and-ci` | **active, all tasks `[x]`** | Deltas: new `deployment` capability (5 requirements, 7 scenarios) and one added `source-health` requirement. The code is done (`openspec/changes/docker-and-ci/tasks.md:1-46`), but it has not been archived, so the main specs do not include it yet. |
| `split-db-module` | proposal only | Pure refactor with `skip_specs: true`. Not started: `src/db/index.ts` is still 1,201 lines. |

**Branches:** this branch is 11 commits ahead of `origin/main`, whose last commit is `c5ef2b0`. Artist links (`bbaa836`), the review screen (`d53e795`), triage (`ec87bad`), OpenSpec and Docker exist only on `docker-and-ci`.

---

## 2. PRD (`docs/PRODUCT.md`) to spec

| Product rule | PRODUCT.md | Spec | Status | Note |
|---|---|---|---|---|
| Feed is the product; releases and gigs are event types | :10 | release-feed | partly | The spec covers releases only. Gigs are not built (README.md:197). |
| Sort by urgency, not by date | :16 | none | missing (by design) | This is a gigs rule, and gigs are not built (CLAUDE.md:161). |
| Fetch gigs by city, match locally | :23 | none | missing (by design) | Gigs, not built. |
| Deterministic matching before any LLM | :29 | identity-resolution:18 | covered | |
| Artists are artists; the list is provenance | :36 | roster-import:10 | covered | |
| Liked artists arrive without images | :45 | none | missing | CLAUDE.md:165 maps this to `roster-import`, but no requirement mentions images. It is tracked as docs/LIMITS.md:347 (L13). |
| Volume is the risk; "Dismiss and sub-filters are load-bearing" | :52-55 | release-feed:27 (filters) | **partly** | Filters are specified and built. **Dismiss** has no spec and no UI; it exists only as a column at `src/db/schema.sql:153`. |
| Save, listened, liked are three flags | :57 | event-flags:10 | covered | |
| Feed for scanning, lists for working through | :67 | release-feed, event-flags | covered | |
| A saved list is read two ways | :75 | event-flags:49 | **partly** | PRODUCT.md:77-78 says "Recently added keeps the order the rows were saved in". The spec and the code use the time **any** flag last changed (`src/db/index.ts:462`, `:502`). This conflict was flagged in `archive/.../design.md:99-103` and never resolved. |
| A row leaves its list the moment its flag goes | :84 | event-flags:41 | covered | |
| Artist link tries the app, falls back to web | :98 | artist-links:28 | covered | |
| Triage accepts what it can prove; two artists never share an MBID | :109, :118 | identity-resolution:18, :38 | covered | The behaviour has gaps; see section 3. |
| An ambiguous name is a decision, and the decision is kept | :124 | review-queue:23, :37 | **partly** | PRODUCT.md:134-135 says a rejected row is kept so it is not re-asked. The code re-queues it; see section 3. |
| Every row links both sides | :138 | review-queue:10 | covered | |
| Links are best-effort and say so | :143 | identity-resolution:45 | covered | Links are stored but no screen shows them (no `artist_links` reader in `src/app/`). |

---

## 3. Spec to code (all 51 requirements checked)

Verdict key:
- **M**: matches.
- **P**: matches in part; the gap is in the note.
- **D**: does something different.

`src/` is omitted from code paths.

### spotify-auth (6 M, 1 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| PKCE with CSRF state | spotify-auth/spec.md:11 | M | auth/spotify.ts:39-47, 63-81; auth/session.ts:41-49; app/api/auth/login/route.ts:24-49 | httpOnly, SameSite=lax, 600 s. The Secure flag is dropped for **any** http redirect URI, not only loopback ones. |
| Read-only scopes | :29 | M | auth/spotify.ts:31, 76, 79 | Exactly three scopes, plus `show_dialog=true`. |
| Callback exchanges once, clears cookies | :38 | M | app/api/auth/callback/spotify/route.ts:28-35, 108-159 | |
| Popup with redirect fallback | :52 | M | callback route.ts:50-106; app/ConnectSpotify.tsx:112-122 | |
| Tokens encrypted at rest | :65 | P | auth/crypto.ts:38-52 | The "malformed key" scenario (:78-80) requires a how-to-generate message. Only a *missing* key gets one (crypto.ts:41-44); a wrong-length or non-hex key does not (:46-49). |
| Refresh before expiry | :82 | M | auth/spotify.ts:198-202; auth/session.ts:68-96; db/index.ts:1175 | 60 s skew. COALESCE keeps the old refresh token. |
| Disconnect keeps roster | :91 | M | app/api/auth/disconnect/route.ts:19-22; db/index.ts:1199-1201 | POST only. |

### roster-import (5 M, 1 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| One row, list flags | roster-import/spec.md:10 | M | db/index.ts:337-381 | |
| Source id beats name | :23 | M | db/index.ts:253-293; jobs/roster.ts:70-77 | |
| Liked artists from track credits | :31 | M | adapters/spotify.ts:242-263; jobs/liked.ts:70-71 | |
| Checkpointed, resumable job; no second start | :41 | P | jobs/roster.ts:115-199; app/api/roster/route.ts:21-58 | <ul><li>The running check is check-then-act around an `await` (route.ts:26-29), so two quick POSTs can both start a run.</li><li>A killed process leaves the status `running`, and the route then never restarts it.</li><li>The CLI has no guard (jobs/cli.ts:316).</li><li>The UI drops the 409 silently (app/RosterImport.tsx:88).</li></ul> |
| Never deletes artists | :59 | M | no `DELETE FROM artists` or `user_artists` anywhere in `src/` | |
| Status from the database | :67 | M | jobs/roster.ts:167, 209-232 | |

### source-health (1 M, 2 P, 1 D)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Adapters never throw out of a fetch | source-health/spec.md:10 | **D** | adapters/musicbrainz.ts:132-169; adapters/coverart.ts:80; adapters/spotify.ts:88-127 | <ul><li>Spotify complies.</li><li>The MusicBrainz client **throws** `MusicBrainzError`. The jobs catch it (jobs/releases.ts:228, jobs/resolve.ts:220), so the feed survives, but not the way the spec says.</li><li>A failure on page 2 of `fetchReleaseGroups` discards page 1 (musicbrainz.ts:385-422).</li><li>CLAUDE.md:132 also says adapters "return `[]`".</li></ul> |
| Nothing vs unknown | :24 | P | adapters/musicbrainz.ts:388, 399-400, 416-418; adapters/coverart.ts:104-106 | <ul><li>MusicBrainz: a missing `release-groups` key returns `[]` with no incomplete flag.</li><li>MusicBrainz: the 10-page cap truncates silently.</li><li>No adapter exposes retry-after as a value (scenario :37-39).</li></ul> |
| Health recorded per source | :41 | M | db/index.ts:1037-1067 | 1 failure = degraded, 3 = failing, error cut to 500 characters. The healthy status is spelled `ok`. |
| Unconfigured sources disabled | :55 | P | adapters/spotify.ts:398-400; adapters/musicbrainz.ts:499-501 | <ul><li>`enabled()` is never called anywhere in `src/`.</li><li>Cover Art has no `enabled()`.</li><li>`registry.ts`, named in adapters/types.ts, does not exist.</li></ul> |
| *(delta)* A failing source never empties the feed | changes/docker-and-ci/specs/source-health/spec.md:5 | M | jobs/releases.ts:200-216; jobs/covers.ts:118, 145-172; db/index.ts:755-776 | Built and tested (tests/degradation.mjs). The main spec lacks it until the change is archived. |

### identity-resolution (1 M, 4 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Exact join first | identity-resolution/spec.md:10 | M | jobs/resolve.ts:292-317; adapters/musicbrainz.ts:179-199 | |
| Triage decides only what it can prove | :18 | P | matcher/triage.ts:126-193; jobs/resolve.ts:321-368 | <ul><li>A **sole candidate in another script is accepted with no exact-name check** (triage.ts:174-175; intended per the comment at :165-170, but not in the spec).</li><li>Zero candidates are **not** queued (resolve.ts:358), although the spec says "anything else SHALL go to the review queue".</li></ul> |
| Two artists never share an MBID | :38 | P | db/schema.sql:24 (`mbid TEXT UNIQUE`); jobs/resolve.ts:218-224; app/api/review/[id]/route.ts:94-96 | <ul><li>Enforced only by the database constraint.</li><li>In the job, the collision is counted as a transient failure and retried every run.</li><li>In Review, it returns a 500.</li></ul> |
| Links stored with identity | :45 | P | jobs/resolve.ts:304-314; db/index.ts:691-717 | An artist confirmed **through Review gets no links** (route.ts:93 does not fetch them). |
| Resumable, tolerates a busy source | :55 | P | jobs/resolve.ts:165-273; adapters/musicbrainz.ts:116-160 | <ul><li>"Source down" ends with job status **`complete`** (resolve.ts:198-202). Release sweep reports `failed` in the same case.</li><li>An **abort** is caught as a transient failure and skipped, not propagated (resolve.ts:214-231). The comment at :214-215 says the opposite.</li></ul> |

### review-queue (0 M, 4 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Row carries what is needed; count agrees | review-queue/spec.md:10 | P | app/ReviewList.tsx:139-229; app/Masthead.tsx:22-27, 100; app/review/page.tsx:33 | The nav shows **no count**; the count only decides whether the link appears. The page shows 40 rows at a time. "Every candidate" means MusicBrainz's top 5 (musicbrainz.ts:211). |
| Accepting resolves, remembers the name | :23 | P | app/api/review/[id]/route.ts:26-96; db/index.ts:952-972 | The 404 lookup runs before the UUID check, so a bad MBID on an unknown row gets a 404, not the spec's 400. |
| Rejecting keeps the decision | :37 | P | db/index.ts:813-822, 981-983; jobs/resolve.ts:85-96 | The row is kept as `rejected`, but the next resolve run re-selects the artist (`mbid IS NULL`), and the duplicate check looks only at *pending* rows. **The artist is likely asked again.** This is code reading only, not reproduced. It was first flagged in `archive/.../design.md:93-98`. |
| Only a pending row can be decided | :45 | P | app/api/review/[id]/route.ts:69-72; db/index.ts:874 | The lookup reuses the queue query's limit of 500, so a pending row past the 500th also gets a 404. |

### release-sweep (3 M, 2 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Release-groups by MBID, one request per artist | release-sweep/spec.md:10 | P | jobs/releases.ts:78-95; adapters/musicbrainz.ts:385-422 | Up to 10 paged requests per artist, not one. Silent cap at 1,000 groups. |
| Only the configured window | :19 | M | config.ts:45-46, 83-99; adapters/musicbrainz.ts:432-447 | 4 months back, 2 forward. |
| Dates keep source precision | :32 | P | adapters/musicbrainz.ts:427-441 | A year-only date is admitted only if its year is no later than the window's end year. The comment says it is "exempt from the upper bound", so "2028" is dropped today. |
| Second sighting writes nothing | :42 | M | db/index.ts:755-776; db/schema.sql:103 | |
| Resumable, tolerates a busy source | :51 | M | jobs/releases.ts:153, 194-249 | A resumed run re-sweeps some artists it already stamped: extra requests, no new rows. |

### cover-art (3 M)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Looked up by release-group | cover-art/spec.md:10 | M | adapters/coverart.ts:73; jobs/covers.ts:51-65 | |
| No cover means checked once | :18 | M | adapters/coverart.ts:94; db/index.ts:787-793 | Other 4xx answers (403, 429) are also left unchecked, so they are retried forever. |
| Cover pass resumable | :31 | M | jobs/covers.ts:118-184 | An abort throws out with no catch (covers.ts:138), leaving the status `running`. |

### release-feed (3 M, 2 P, 2 D)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Upcoming above released | release-feed/spec.md:10 | **D** | app/Feed.tsx:256-270; app/feed-filters.ts:274-282 | The client re-sorts by date only. With **Oldest first**, released rows come before upcoming ones. |
| Month groups, undated last | :18 | P | app/feed-filters.ts:239-256, 276-278; app/Feed.tsx:535-557 | Undated rows come last, but with no heading. Year-only rows get their own year section. |
| Independent filters | :27 | M | app/feed-filters.ts:31-80, 190-226; app/Feed.tsx:261-267 | Weeks start Monday, in UTC (app/page.tsx:96). |
| Pages at month boundaries | :45 | **D** | app/Feed.tsx:76, 311-328 | A page closes only *after* it reaches 100 rows, so 30 rows plus a 150-row month make one 180-row page. The big month does not get "a page of its own". Scroll to top works (Feed.tsx:370-381). |
| Dates at the known precision | :55 | M | app/feed-format.ts:66-88; app/Feed.tsx:648 | |
| Copy does not overclaim | :67 | P | app/page.tsx:42, 44-46 | <ul><li>The tagline says "Releases **and gigs**".</li><li>The connect text says "checks for new releases **and gigs in your city**".</li><li>There are no gigs (app/Feed.tsx:124).</li></ul> |
| Empty database renders an empty feed | :75 | P | app/Feed.tsx:403-411; app/page.tsx:91-132, 201 | It renders without error, but shows an empty-state message and **no counts**. Before Spotify is connected, the feed is not shown at all. |

### event-flags (4 M, 2 P)

| Requirement | Spec | Verdict | Code | Note |
|---|---|---|---|---|
| Three independent flags | event-flags/spec.md:10 | M | db/index.ts:125-126, 435-464, 571-573 | |
| Writes validated | :23 | P | app/api/events/[id]/state/route.ts:26-75 | `Number()` accepts ids such as "1e2" and "0x10". The 404 depends on the wording of the foreign-key error. |
| Feed rows carry flags | :33 | M | db/index.ts:608-611 | |
| Row leaves its list | :41 | M | app/SavedList.tsx:77-80, 184 | A stale comment at SavedList.tsx:52-55 says rows stay. |
| By month or recently added | :49 | P | db/index.ts:462, 502; app/feed-filters.ts:113 | The order is fixed at page load, and it is "recently **marked**", not "saved" (see section 2). |
| Failed writes revert | :58 | M | app/use-event-flags.ts:41-58 | A double press can send two writes (app/FlagButtons.tsx:68-71). |

### artist-links (4 M)

| Requirement | Spec | Verdict | Code |
|---|---|---|---|
| Configurable, defaults to app | artist-links/spec.md:11 | M | config.ts:55 |
| href always web | :20 | M | app/ArtistLink.tsx:69-73, 128 |
| App first, 600 ms fallback, modified clicks left alone | :28 | M | app/ArtistLink.tsx:45, 86, 102-122 |
| Web mode plain link | :42 | M | app/ArtistLink.tsx:71-76 |

**Totals:** 29 M, 19 P, 3 D.
- release-feed: 3 M, 2 P, 2 D.
- source-health: 1 D (adapters never throw).

### Built behaviour no spec mentions (sample)

- **Feed:**
  - Collapsible month bands, with collapse-all (app/Feed.tsx:383-399, 466-486).
  - Month dropdown (app/Feed.tsx:447-457).
  - Clear-filters button (app/Feed.tsx:343-350).
  - Relative labels such as "Tomorrow" (app/feed-format.ts:97-116).
  - A 5,000-row cap with "showing the newest" text (app/page.tsx:124; app/Feed.tsx:60-69).
- **Review:** shown in batches of 40 (app/review/page.tsx:33). The nav link is hidden at 0 (app/Masthead.tsx:100).
- **Imports:**
  - The liked-songs import can be started only from the CLI (jobs/cli.ts:253-262).
  - A short liked read fails the run and restarts it (jobs/liked.ts:207-218).
- **Retries:** MusicBrainz tries 8 times with backoff up to 15 s. Cover Art tries 3 times (adapters/musicbrainz.ts:111-160; adapters/coverart.ts:68-102).
- **CLI exit codes:** 0 = complete, 1 = incomplete, 2 = not configured (jobs/cli.ts:54, 133, 148-154).

---

## 4. Code changes outside OpenSpec

OpenSpec arrived in `c439d6d` on 2026-09-25. Every later commit that touches `src/` belongs to a change:

| Commit | src files | Change |
|---|---|---|
| bcf78d3 | app/globals.css (1 line) | docs-to-specs (archived) |
| df7b6ae | jobs/releases.ts, jobs/covers.ts | docker-and-ci (active) |

**No undocumented change since specs began.**

Before 2026-09-25, all 40 commits that touch `src/` had no OpenSpec, because it did not exist yet. The docs-to-specs change backfilled them (`archive/.../proposal.md:14-17`). One-line guesses at what each changed:

| Commit | Date | Behaviour changed (guess) | In a spec now? |
|---|---|---|---|
| ec87bad | 09-20 | Triage auto-accepts provable name matches; anti-merge guard | identity-resolution:18, :38 |
| d53e795 | 09-20 | Review screen and decision route | review-queue |
| bbaa836 | 09-20 | Artist link opens the desktop app, falls back to web | artist-links |
| 2aac25e | 09-20 | Turning a page scrolls to the top | release-feed:49 |
| b539735 | 09-20 | Row leaves its list when its flag is cleared | event-flags:41 |
| 2329c1b | 09-20 | Two orderings on saved lists; masthead links home | event-flags:49 (home link: no) |
| d0eec00 | 09-19 | Save, listened and liked flags; playlist and favs pages | event-flags |
| 3e4b567 | 09-18 | Artist links stamped; year dropped from card date | release-feed:55 |
| 814fd7a, d552eba | 09-18 | Info note popover; green "this week" text | no (design) |
| 7fcd68e | 09-18 | Numbered pages; 90% sheet | release-feed:45 |
| 596d01d | 09-18 | Favicon and logo | no (design) |
| 0ac4ee1, b736973, 9b431bf | 09-18 | Week shortcuts, icon-button states | week filter yes (release-feed:27); visuals no |
| 9852d94, 12500a2, 0b9016b, 67562ff | 09-18 | Card grid, stripes, card footer date, month bands | partly (release-feed:18); layout no |
| 0e6fde3 | 09-18 | Collapsible months, pagination, cover art, list counts; **removed the "From liked songs" mark** | cover-art, release-feed; collapse no |
| 59a8ff0 | 09-17 | Liked songs as a second artist list | roster-import:10, :31 |
| da5e026, 0b599ba | 09-16 | Category, status and sort controls | release-feed:27 |
| d89ef1b | 09-16 | The release feed | release-feed |
| e3dc9ce | 09-16 | Release rewind no longer re-reads the roster | release-sweep:51 |
| 56d8701 | 09-15 | Releases from MusicBrainz release-groups | release-sweep |
| ad41bcd | 09-07 | Date precision column | release-sweep:32 |
| e2859c8 | 09-07 | Retry every transport fault | identity-resolution:55 |
| aa06dc7 | 09-07 | Cursor no longer reports complete early | identity-resolution:55 |
| d51dc8a | 09-06 | MBID by Spotify URL join | identity-resolution:10 |
| a33ec26 | 09-02 | Same-named artists kept apart; .env loaded in CLI | roster-import:23 |
| 0a08f67 | 09-02 | OAuth in a popup | spotify-auth:52 |
| 64db543 | 09-02 | Checkpointed roster import | roster-import:41 |
| 0d8b06f | 09-02 | Spotify OAuth, roster adapter, connect screen | spotify-auth |
| da7fa17 | 08-31 | SQLite database layer with checkpoints | implicit |
| 5471bdf | 08-31 | Matcher normalisation and eval set | identity-resolution:18 |
| 81d2740 | 08-31 | Adapter contract, schema | source-health:10 |

---

## 5. Docs claims that are no longer true

| Claim | Where | Reality |
|---|---|---|
| "a release shows a **From liked songs** mark only when you do not also follow that artist" | README.md:159-160 | Removed in `0e6fde3` (2026-09-18); its commit message says the "From filter answers that question". No such string is in `src/`. |
| BANDELION_TIMEZONE is "used for 'this week' grouping in the feed" | .env.example:19-20 | Loaded at config.ts:44 but never read. Weeks are computed in UTC (app/page.tsx:96; app/feed-filters.ts:190-226). |
| "Releases and gigs…" / "checks for new releases and gigs in your city" | app/page.tsx:42, 44-46 (UI copy) | No gigs exist (README.md:197). This conflicts with the project's own copy rule (CLAUDE.md:236). |
| Bandelion tells you about "gigs in your city, videos, reviews" | README.md:3-6; CLAUDE.md:7 | Releases only. This is caveated later at README.md:197 and CLAUDE.md:115; videos and reviews are not mentioned anywhere as planned. |
| "Recently added keeps the order the rows were saved in" | docs/PRODUCT.md:77-78 | Ordered by the last change to any flag (db/index.ts:462, 502). |
| "Rejecting marks the row `rejected`… because a deleted row is re-asked" (implying a rejected one is not) | docs/PRODUCT.md:134-135 | A rejected artist is likely re-queued (section 3, review-queue). |
| "An adapter never throws out of `fetch`… returns `[]`" | CLAUDE.md:132-133 | The MusicBrainz client throws, and the jobs catch it (adapters/musicbrainz.ts:133-169). |
| "Every adapter ships with a captured fixture" | CLAUDE.md:130-131 | No Cover Art Archive fixture in tests/fixtures/. |
| Suites named offline, ingest, render, interactive, rules, persistence | docs/TESTING.md:104-111 | No such files in tests/. This is partly excused by README.md:244-246 ("came from an earlier, different project"). |
| Screenshot example `http://localhost:3000/feed` | docs/TESTING.md:65-67 | There is no `/feed` route (the feed is `/`), and the setup uses 127.0.0.1. |
| Import steps: resolve, then releases | README.md:110-113 | `npm run ingest covers` (jobs/cli.ts:195) is never mentioned, so a README-only setup gets no sleeves. |
| CLAUDE.md "Target: about 150 lines" | archive/.../proposal.md:23 | It is 281 lines. A planning target, not a user claim. |
| Code comments | app/SavedList.tsx:52-55; jobs/resolve.ts:214-215; app/use-event-flags.ts:31-35 | Each describes behaviour the code no longer has. |

---

## Looks like drift but is fine

- **~40 commits changed `src/` with no OpenSpec.** All of them predate OpenSpec (2026-09-25), and docs-to-specs backfilled them. Nothing after that date is off-plan.
- **No gig specs.** Gigs are not built, and PRODUCT.md:7-8 says gig rules deliberately have no spec.
- **`.env.example` lists Ticketmaster, Eventim, RA and crawler toggles** (lines 26-38) for adapters that do not exist. They are labelled optional P1/P2, and README.md:192-198 says "not built yet".
- **The `split-db-module` change has no specs.** It is a pure refactor and declares `skip_specs: true`.
- **Artist links are stored but never shown.** This satisfies "must not imply a complete profile" (identity-resolution:48).
- **The README Docker checklist is unticked** (README.md:89-93). It is deliberately marked "not yet run", as docker-and-ci tasks 4.2 required.
- **CLAUDE.md still holds the Spotify ceiling and design sections** that the archived proposal planned to move. They are now short pointers to docs/SPOTIFY.md and docs/DESIGN.md.

## Open questions

1. Archive `docker-and-ci` and merge to `main`? Until then, the main specs lack `deployment` and the new source-health requirement, and `main` lacks Review and triage.
2. Recently added: should it be "recently saved" (PRODUCT.md) or "recently marked" (spec and code)? This has been open since 2026-09-25.
3. Should a rejected artist be re-asked? If not, it needs a fix and a scenario. Reproduce first; this audit read the code only.
4. "Oldest first" and oversized-month paging: fix the code, or relax the spec?
5. Should the resolve job report `failed` when MusicBrainz is down for the whole run, as release sweep now does?
6. Should source-health:10 be reworded to "a job never lets a source failure escape", matching how MusicBrainz actually works? Or should the adapter change?
7. Gigs in UI copy: remove "and gigs" until gigs ship?
8. Dismiss (PRODUCT.md:54, "load-bearing"): is it still planned? There is a schema column but no spec and no UI.

*Method and limits:*
- Spec-to-code checks were split across three read-only sub-reviews, and their key claims were spot-checked against the source:
  - asc sort;
  - pagination loop;
  - MusicBrainz throw;
  - key-format message;
  - year-only window;
  - sole other-script triage;
  - resolve `complete`;
  - rejected re-queue path.
- Tests were read, not run. Line numbers are from this checkout.
