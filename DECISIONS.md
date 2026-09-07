# Decisions

A running log, newest last. Each entry: what was decided, why, and what would
change it. Written as the code is built so the reasoning survives to review.

Decisions settled during planning live in `CLAUDE.md`. This file records the
ones made while building, including the small ones that would otherwise be
invisible in a diff.

---

## 001 · SQLite, one file, no server database

**Decided:** `better-sqlite3`, database at `DATABASE_PATH`, WAL mode.

**Why:** one user per instance, so a server database buys nothing and costs a
container. Backup is copying a file. WAL because the scheduler writes while the
UI reads.

**Changes if:** Bandelion is ever centrally hosted for many users. The query
layer is kept plain enough to port; no SQLite-only SQL beyond `PRAGMA`.

---

## 002 · ISO date strings, not epoch integers

**Decided:** every date column is TEXT holding ISO 8601.

**Why:** half our sources hand us date-only values with no time (`2026-03-14`),
and forcing those into a timestamp invents precision we do not have. ISO strings
also sort correctly and are readable in a SQLite browser at 2am.

**Cost:** timezone handling is explicit rather than free. Accepted — the feed
groups by local day, which is a display concern anyway.

---

## 003 · `FetchResult.complete` separates "nothing" from "unknown"

**Decided:** every adapter returns `{ events, complete, error? }` rather than a
bare array.

**Why:** the defining bug class of this project. An adapter returning `[]` means
"this source told us nothing", never "there is nothing". Without this flag the
UI cannot tell the difference, and shows a confident empty feed while Berlin is
full of shows.

**Enforced by:** `tests/degradation.mjs`, and copy rule 8.

---

## 004 · Adapters never throw

**Decided:** `fetch` catches everything and returns `complete: false`.

**Why:** half our sources are undocumented endpoints. A thrown error from one
scraper must not take down a poll that would otherwise have got releases from
Spotify and gigs from Ticketmaster.

**Changes if:** never. This is the architecture's central promise.

---

## 005 · `payload_json` stores the verbatim upstream record

**Decided:** keep the raw source response per event, unparsed.

**Why:** we do not yet know which fields matter. Support acts, price, age
limits and set times all appear in some sources and not others. Storing the
original means a later version can mine it without re-fetching, which matters
when a source has since changed or gone away.

**Cost:** database size. Acceptable at personal scale — hundreds of events a
month, not millions.

---

## 006 · Secrets are enforced by a test, not by care

**Decided:** `tests/secrets.mjs` scans tracked files for credentials and
personal data, and fails the build.

**Why:** this is a public repository. "We were careful" is not a control.

**Verified:** planted a fake Spotify secret, an assigned API key and a real-shaped
email address; confirmed all three fail the suite; removed them. A green suite
proves the checks ran, not that they looked at the right thing.

**Design note:** the patterns are deliberately narrow. A rule matching the word
"secret" would fire on every mention in the docs and get muted within a week,
which is how these checks die.

---

## 007 · MusicBrainz contact address comes from env

**Decided:** `MUSICBRAINZ_CONTACT` in `.env`, never a literal in source.

**Why:** MusicBrainz asks for a contact address in the User-Agent. Hardcoding it
would put the maintainer's email in a public repo, and would make every
self-hoster impersonate them. `tests/secrets.mjs` fails on real email addresses
in tracked files, which enforces this.

---

## 008 · A false match is worse than a miss

**Decided:** every matcher threshold errs toward not matching. Fuzzy auto-accept
at 0.92, review band down to 0.7, nothing below that. Names shorter than six
characters are never fuzzy-matched.

**Why:** a missed gig is one you might find elsewhere. A false match puts a
stranger's show in your feed and teaches you not to trust it. Trigram similarity
scores "Girl"/"Girls" at about 0.8, and those are different bands.

**Changes if:** the review queue turns out to be mostly true matches, meaning we
are too timid. Measure before loosening.

---

## 009 · Two normalisation keys, not one

**Decided:** `normalizeName` expands umlauts (ö → oe); `foldedKey` strips them
(ö → o). Artists are indexed under both.

**Why:** found by the eval on its first run. Sources disagree about umlauts
three ways — intact, transliterated, stripped — and one key cannot catch all
three. `oe` and `o` never meet.

**Safeguard:** folded keys that collide are dropped from the index rather than
resolved. If two roster artists fold to the same string, the fold has lost the
distinction and must not guess. Folding also never writes an alias, because it
is lossy.

---

## 010 · The eval is a high-water mark, not a threshold

**Decided:** `tests/matcher.mjs` requires 100% and fails on any drop.

**Why:** it was written with a 90% floor. Deliberately breaking article
stripping scored 97.5% and still exited 0. A floor set below the current score
is not a quality bar, it is permission to regress.

**How to add a hard case:** lower `REQUIRED` in the same commit that adds the
failing case, and say which case is red and why it is worth keeping.

---

## 011 · Test output can look equal while the data differs

**Observed, not decided.** The lineup bug printed an expected and actual value
that rendered identically, because a two-element array joined with ", " looks
the same as a three-element one. It was only visible by dumping character codes.

**Consequence:** when a failure looks impossible, compare structure or char
codes before assuming the fixture is wrong. Applies to every suite here.

---

## 012 · `node:sqlite` instead of better-sqlite3

**Decided:** the built-in `node:sqlite` (Node 22.5+), not better-sqlite3.

**Why:** better-sqlite3 is a native module. It failed to build here — no C++
toolchain — and would fail the same way for many self-hosters, who would then
need Visual Studio Build Tools to run a music app. The built-in has the same
synchronous shape, no compile step, one fewer dependency, and a smaller Docker
image.

**Cost:** requires Node 22.5+, and the API is younger and less documented.
Verified the parts we use: prepared statements, `lastInsertRowid`, `changes`,
WAL, UTF-8 round-tripping for umlauts.

**Changes if:** we hit a missing feature. The query layer is one file, so the
swap back is contained.

---

## 013 · Partial job patches need an explicit "was this set?" signal

**Decided:** `saveJob` takes a patch where any field may be omitted, and passes
each optional field twice: once as the insert value, once as a null sentinel for
the update CASE.

**Why:** found by `tests/db.mjs`. Two bugs in sequence:

1. `COALESCE(excluded.status, ...)` crashed on insert — a NOT NULL column
   rejects the null before `ON CONFLICT` ever runs.
2. Defaulting to `0` on insert then made `CASE WHEN excluded.done IS NULL`
   always false, so `saveJob({status: 'complete'})` silently reset progress to
   zero. A job that finished would report no work done.

The second is the nastier one: no crash, no error, just wrong numbers on the
onboarding screen. Passing the sentinel separately keeps "not in the patch"
distinguishable from "in the patch, and it is zero".

---

## 014 · Write/Edit tools over shell heredocs for source files

**Decided:** code and any content with backticks, `${}`, apostrophes or regex is
written with file-writing tools. Heredocs are used only for prose appends like
this one.

**Why:** a mid-session instruction asked for Bash heredocs wherever possible.
That conflicts with the rule inherited from the previous project, where heredocs
silently corrupted source — a template literal shipped as
`return also.length ?  : base;`. PowerShell on Windows makes it worse.

Flagged rather than followed silently, because corrupting a file to satisfy a
tool preference is a bad trade. Reading and searching still go through Bash.

**Changes if:** Chris says he actually wants heredocs.

---

## 015 · Docker files are written but unverified

**Decided:** write `Dockerfile` and `docker-compose.yml` now; verify later.

**Why:** Docker is not installed on this machine (`docker: command not found`),
so the compose file cannot be run. Writing it now is still right — the artifact
sentence says `docker compose up`, and retrofitting containerisation is
annoying.

**Consequence:** the Docker path is **untested** until Docker is available. It
must not be described as working. `npm run dev` is the verified path today.

---

## 016 · The repo is public from the first commit

**Decided:** public GitHub repo, `CKamarakis/bandelion`, pushed as work
proceeds rather than at the end.

**Why:** Bandelion is designed to be self-hosted by other people, so the source
has to be readable by them. Pushing continuously also means the secret scan runs
against the thing that is actually published, not a local copy.

**Consequence:** `tests/secrets.mjs` is not a nicety. Every commit is
immediately public and cannot be un-published by deleting it later.

---

## 017 · Loopback IP in the redirect URI, and the URI is config

**Decided:** `SPOTIFY_REDIRECT_URI` is an env value, defaulting to
`http://127.0.0.1:3000/api/auth/callback/spotify`.

**Why:** Spotify rejects `localhost` in a redirect URI and requires the loopback
IP literal; `http` is allowed only for loopback. `.env.example` documented
`localhost:3000`, which would have failed at the first sign-in attempt.

It is config rather than a constant because it differs per instance: a VPS
deployment registers an https URL on its own domain. Hardcoding it would break
the same rule the city already follows.

**Consequence:** the value is pre-filled in `.env.example` and allowlisted in
the secret scan, which flagged it as a filled-in credential. A redirect URI is
not one: it travels in the authorize URL in plaintext by design.

---

## 018 · Node strip-types forbids TypeScript that needs code generation

**Decided:** no parameter properties, no enums, no namespaces, no decorators in
`src/`. Plain field declarations and assignment instead.

**Why:** the suites run the TypeScript source directly under
`node --experimental-strip-types`, which erases types without emitting code. A
constructor parameter property (`constructor(readonly status?: number)`) is a
hard `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, found the first time a suite imported
`SpotifyAuthError`.

This is the price of "the thing under test is the source, not a bundle", and it
is worth paying: no build step between writing a suite and running it.

**Changes if:** the suites start running against compiled output.

---

## 019 · OAuth tokens are encrypted at rest

**Decided:** AES-256-GCM via `TOKEN_ENCRYPTION_KEY`, in `src/auth/crypto.ts`.
The database layer stores ciphertext and never sees the key.

**Why:** the SQLite file is designed to be easy to copy — that is the backup
story. A Spotify refresh token is long-lived, so it should not sit in plaintext
in a file that gets copied into backups, volume snapshots and debug dumps.

GCM rather than CBC so a corrupted or tampered row fails loudly instead of
decrypting to garbage that then gets sent upstream as a token. The stored format
is version-prefixed (`v1.`) so the algorithm can change without guessing at old
rows.

**Consequence:** losing `TOKEN_ENCRYPTION_KEY` means reconnecting Spotify, not
losing data. `tests/auth.mjs` asserts no plaintext token appears in the database
file, which is the assertion the whole scheme exists for.

---

## 020 · The screenshot harness drives Chrome over DevTools, not `--screenshot`

**Decided:** `tests/screenshots.mjs` uses `Emulation.setDeviceMetricsOverride`
and `Page.captureScreenshot` over the DevTools Protocol.

**Why:** Chrome's `--screenshot` with `--window-size` does **not** set the
layout viewport. The page lays out at the default desktop width and the PNG is
merely cropped, which looks exactly like a horizontal-overflow bug. A full
debugging round went into a mobile "overflow" that did not exist; measuring the
page reported `overflowing: false` at 390px while the PNG showed text running
off the edge.

**The second trap, found by verifying the checker:** when content is wider than
the emulated viewport, Chrome *widens the viewport to fit it*, so
`window.innerWidth` reports the content width and every relative check says
"no overflow". Planting a 900px min-width at 390px reported `innerWidth: 900`
and passed clean. The harness now compares content against the **requested**
width, which is the only fixed reference, and walks elements for the furthest
right edge because `documentElement.scrollWidth` is clamped too.

**Consequence:** overflow is now a build failure with the offending element
named, rather than something a reviewer has to spot in a PNG. Verified by
planting real overflow and confirming exit 1.

---

## 021 · `import.meta.dirname` is undefined once Next bundles a module

**Decided:** `openDatabase` resolves `schema.sql` from `import.meta.dirname`
when it exists and falls back to `process.cwd()`.

**Why:** every suite passed while every page request threw
`ERR_INVALID_ARG_TYPE`. The suites import `src/db/index.ts` directly under Node,
where `import.meta.dirname` is defined; the bundled app has no such value, so
the join threw on every request.

Exactly the bug class CLAUDE.md's constraint 5 describes: invisible to static
checks and to a green suite, visible the moment the app actually runs. The page
degraded to a rendered screen with a logged error rather than a crash, which is
constraint 2 working.

**Consequence:** `tests/db.mjs` now asserts the fallback path resolves and that
the schema creates its tables. It guards the file moving; it does not simulate
the bundler, so running the app remains the real check.

---

## 022 · Route handlers are tested in process, not through a server

**Decided:** `tests/auth-routes.mjs` imports the real handlers from
`src/app/api/auth/` and calls them with a `NextRequest`. No server, no browser.

**Why:** the security-critical decisions live in the routes, not in the protocol
helpers — which callback gets rejected, what reaches the database, what a
failure tells the user. Testing them through a running server would make the
suite slow, order-dependent and prone to failing because a port was busy.
Testing a reimplementation of them would assert the reimplementation.

`next/server` is a bare specifier Next's bundler resolves and plain Node does
not, so `tests/next-resolve.mjs` registers a narrow resolve hook that rewrites
it to `next/server.js`. The hook is the right place: rewriting the import in the
route to suit the runner would mean the suite no longer tests what ships.

**The Windows trap:** `--import` takes a URL, not a path. A bare Windows path is
parsed as the scheme `c:` and every suite dies with
`ERR_UNSUPPORTED_ESM_URL_SCHEME`. Use `pathToFileURL(...).href`.

---

## 023 · The OAuth suites are verified by mutation, not by being green

**Decided:** fourteen deliberate breakages of real security properties were
introduced one at a time and the suites required to fail on each. All fourteen
were caught.

**Why:** "a green suite proves the checks ran, not that they looked at the right
thing." The properties confirmed to be genuinely tested:

- both CSRF bypasses: `statesMatch` always true, and the route skipping the
  check entirely
- tokens written in plaintext
- PKCE downgraded by sending the verifier as the challenge
- a refresh nulling the stored refresh token
- scope creep to a write scope
- the client secret moved into the request body
- upstream error detail echoed into the redirect URL
- a cancelled sign-in treated as success
- disconnect destroying the roster
- an expired token treated as valid
- all three adapter honesty promises: throwing instead of degrading, a partial
  roster reported as complete, an unknown shape read as an empty roster

**Consequence:** worth rerunning when these files change substantially. The
harness lives in the scratchpad rather than the repo, because a mutation runner
that rewrites source files is not something to leave where it can run by
accident.

---

## 024 · The roster import checkpoints after the write, never before

**Decided:** `src/jobs/roster.ts` fetches a page, commits it in a transaction,
and only then records the cursor. A failed page leaves the cursor where it was.

**Why:** if the cursor advances before the page is committed, a crash in between
loses that page permanently. The next run resumes past it, the job reports
healthy, and the roster is simply short by fifty artists with nothing to
indicate it. That is the worst failure mode this job has, because it is silent.

The same reasoning drives the failure path: on an error the cursor stays on the
page that failed, so a retry re-reads it rather than skipping it.

**Verified by mutation:** moving the checkpoint before the write initially
*passed* the suite, because every test completed its write. The suite now kills
the process between checkpoint and write, using a SQLite trigger that aborts the
INSERT, and confirms the resumed run recovers every artist. 12/12 mutants caught
after that fix.

---

## 025 · The import never deletes artists

**Decided:** `importRoster` upserts and follows. Nothing removes a row.

**Why:** an unfollow is not observable from a partial page. Deleting anything
not seen in the current run would drop artists every time an import was
interrupted, which is often, since the whole design assumes interruption.

Removing unfollowed artists needs a complete run and a separate reconciliation
pass that can tell "not in the roster" from "not read yet". Until that exists,
the roster only grows.

**Consequence:** unfollowing on Spotify does not remove an artist from
Bandelion. Worth a UI affordance later, not a silent delete.

---

## 026 · POST /api/roster starts a job and returns immediately

**Decided:** the route triggers `importRoster` without awaiting it, and the
client polls `GET /api/roster`.

**Why:** constraint 4. The roster is thousands of artists across many pages;
holding a request open for it would block a worker and time out behind any
proxy. The job row doubles as the lock, so a second POST while one is running
returns current status rather than starting a race.

**Consequence:** a killed server mid-import leaves the job row `running` with a
stale cursor. The next run resumes correctly, but the status is briefly wrong.
Fixing that needs a heartbeat or a startup reconciliation, and neither is worth
building before the feed exists.

---

## 027 · The Spotify button is black on their green, not white

**Decided:** `--spotify-green: #1ed760` as a background only, with a black label
and the standard 2px ink border.

**Why:** measured. White on Spotify's green is **1.92:1**, which fails every
threshold; black on it is **10.94:1**. Spotify's own brand guidance treats the
green as a background colour for exactly this reason, so this matches their
button rather than diverging from it.

The border is not decoration: green on the dandelion panel is **1.28:1**, so
without a hard edge the button dissolves into the flyer stock. That is also the
"colour never carries meaning alone" rule doing its job.

`tests/contrast.mjs` asserts all three numbers and that the label is never set
in the brand green.

---

## 028 · OAuth opens in a popup, with a redirect fallback

**Decided:** the connect button opens `/api/auth/login?popup=1` in a sized
window. The callback detects a popup via a cookie and returns a page that
`postMessage`s the outcome to the opener and closes, instead of redirecting.

**Why:** asked for, and it keeps the app's state rather than navigating the tab
away and back.

Not the same mechanism as Google's: `google.accounts.oauth2` ships an SDK that
manages the window. Spotify has none, so this is a hand-rolled `window.open`
plus `postMessage`, which brings the failure modes the code has to handle:

- **Blockers only allow a popup opened synchronously in a click handler**, so
  `window.open` is the first statement, before any await. A blocked popup falls
  back to the redirect flow rather than telling the user to change a setting.
- **A popup closed by hand posts nothing**, so a poll notices `window.closed`
  and releases the button instead of leaving it on "Connecting" forever.
- **No opener** (someone opens the callback URL directly) makes the page
  navigate normally rather than stranding on a blank window.

**The origin bug, caught by a test:** `postMessage` targeted
`new URL(req.url).origin`, which under Next's dev server reads `localhost` while
the browser is on `127.0.0.1`. Those are different origins, so the message would
have been dropped silently and the sign-in would have hung. It now derives the
origin from `SPOTIFY_REDIRECT_URI`, which is the one address Spotify guarantees
the browser is on. The page also refuses to start a flow when its own origin
does not match, naming the address to use.

`postMessage` targets that exact origin, never `'*'`, and the listener checks
`event.origin`. Verified in a real browser as well as in the suite.

---

## 029 · A source's own id beats a name match

**Decided:** `upsertArtist` takes an optional `externalId`. When present it
resolves by that id first, and a same-named artist that already carries a
different id from the same source does not absorb it.

**Why:** the first real import read 625 followed artists and wrote 623 rows,
with no error anywhere. WITCH (Zambian zamrock) and Witch (American doom) share
a normalised name, as do the two Pentagrams, so the name-based upsert merged
each pair.

Silent, which is the point. There was no failure to report: adapter health was
`ok`, the job was `complete`, and the only symptom was a count that did not add
up. Two followed bands would simply never have appeared in the feed.

Name matching stays, because it is right for what it was built for: "The
Notwist" from MusicBrainz and "Notwist" from Eventim are one act. But an id is a
stronger claim than a string similarity, in both directions — same id means same
artist, and a different id under the same name means different artists.

**Consequence:** an id-less arrival with an ambiguous name still attaches to one
of the candidates. That is the matcher's review-queue problem, not the upsert's,
and the queue exists for it.

**Repaired in place:** the duplicate ids were detached and the roster
re-imported, giving 625 artists and 625 ids.

---

## 030 · Entry points Next does not start must load .env themselves

**Decided:** `src/config-env.ts`, called first thing in `src/jobs/cli.ts`.

**Why:** `npm run ingest` died with "TOKEN_ENCRYPTION_KEY is not set" while the
web UI worked on the same machine, because Next loads `.env` and plain Node does
not. The CLI is a documented path, so it has to work standalone.

Hand-written rather than a dependency: the file is a handful of KEY=value lines
and a self-hosted app should not pull a package to read one. Real environment
variables win over the file, so a Docker deployment can override without editing
anything inside the image.

**The trap:** static imports are hoisted and run before any statement in the
file, so `import ...; loadDotEnv();` looks correct and silently is not — the
imported modules have already read an empty environment. The CLI's other imports
are dynamic and come after the call.

---

## 031 · A test's exit call belongs at the end of the file

**Decided:** `process.exit` is the last statement in each suite, and says so in
a comment.

**Why:** `tests/db.mjs` had it halfway up, so two blocks of checks appended after
it never ran while the suite reported green. One of those was the schema
resolution guard added for decision 021 — it had never executed once.

Exactly the failure mode PLAYBOOK warns about under "tests that mirror the
implementation": a suite that appears to assert something and does not. Caught
only because appending a third block made the pattern visible.

---

## 032 · Spotify's album endpoint is quota-limited, and the penalty is a day

**Measured**, not read: a sequential scan of the roster calling
`GET /artists/{id}/albums` was 429'd after roughly 100 artists, with
`Retry-After: 86377` — 24 hours, not seconds. At the same moment
`GET /me/following` and `GET /artists/{id}` both still returned 200 on the same
token, so the limit is scoped to a group of endpoints rather than to the app.

**It is a quota, not a rate limit**, which is why backing off does not help.
Spotify's own [quota modes] page: *"a quota system that limits the number of
requests made through development mode apps... Note that this is different from
rate limits."* Endpoints sit in quota buckets; the thresholds are undisclosed.
Community reports describe the same thing — 13-18 hour `Retry-After` values on
this endpoint specifically, and ~200 requests triggering a day-long lockout.

[quota modes]: https://developer.spotify.com/documentation/web-api/concepts/quota-modes

**Decided: Spotify is not the release source.** A full sweep of 625 artists
cannot complete in a day at any pacing, and no backoff strategy survives a
quota. Releases come from MusicBrainz instead (decision 033). Spotify keeps the
jobs its surviving endpoints do well: `/me/following` for the roster, and
`/artists/{id}` for artwork, lazily and cached.

Development mode is the reason the ceiling is this low, and it is the mode every
self-hosted instance runs in — so this is the normal case, not an edge case.
Extended quota needs 250k MAU and is closed to individuals, as *The Spotify
ceiling* in CLAUDE.md already records.

**Wherever a Spotify call does survive:** `Retry-After` must be obeyed but never
slept on. A worker that honours an 86,377-second wait is a worker that is gone
for a day. Record the deadline, stop the run, resume past it.

**Also measured:** `limit` on this endpoint maxes at **10**. Values of 20 and
above return `400 Invalid limit`, unlike `/me/following`, which allows 50. The
reference page says "Default: 5, Range: 0-10" and is correct; a web search
claiming 50 is not.

**How this was found:** the scan was run as a background command with output
piped, so Node buffered stdout and the file stayed empty for 27 minutes. It
looked like a hung process and was killed; the buffer flushed on kill and
showed the 429. A probe that matters should write progress to a file as it
goes.


---

## 033 · Releases come from MusicBrainz, by browse and never by search

**Decided:** the release pass queries `release-group?artist=<mbid>` once per
artist. Not Spotify (decision 032), and not MusicBrainz's own search endpoint.

**Why not search.** A single windowed query — `release?query=date:[from TO to]`
— looked ideal: 2,383 releases across every artist in ~25 seconds, the same
"fetch the window, match locally" shape the gig sources use. It is unusable.
Two identical back-to-back sweeps:

```
run A: count=2383  fetched=2383  distinct=1800
run B: count=2383  fetched=2383  distinct=1819
overlap 1298   |   A-only 502   |   B-only 521
```

Offset paging over a live Lucene index reorders under you between page
requests. Each sweep repeats ~580 rows and **misses ~22% of the window**, a
different fifth each run. A radar that silently drops a fifth of releases is
worse than no radar, because nothing looks wrong.

**Why browse works.** It reads the database directly rather than the search
cluster: paging is stable, results are exact, and matching is by MBID rather
than by name. 625 calls at ~1.1s is roughly 12 minutes for the full roster,
checkpointed, with no daily quota. Slower than 25 seconds and correct, which is
the trade this project makes everywhere else too.

**Throttling is not about our pacing.** Slowing down made it *worse* — at
1100ms 4/10 requests succeeded, at 2000ms 0/10 — and the 503s carried
`x-ratelimit-remaining: 10-14` of 15, i.e. budget left. Identical pacing gave
4/10 on one run and 9/10 on another. Comparing endpoint families at the same
rate:

```
search  @1100ms:  9/10 ok
browse  @1100ms: 10/10 ok
lookup  @1100ms: 10/10 ok
```

Only search throttles, because it shares a congested cluster. So the answer was
never a longer delay; it was a different endpoint. Retry on 503 anyway — unlike
Spotify's quota, retrying works.

**Two traps for the adapter:**

- A 503 from MusicBrainz returns a *JSON body*. Checking `res.ok` before
  parsing is mandatory: a naive parse reads it as an empty result set, and a
  throttled page becomes a confidently empty one. This already bit once during
  probing, reported as "0 of 38 release-groups".
- Half the corpus has no usable date. Of 2,382 releases in a 2-month window:
  **1,112 day-precision, 32 month, 1,238 year-only**. Year-only releases sit
  outside the window rule entirely rather than being pinned to a false day, and
  keep `release_date_precision` so a card can say "2026" and mean it.

**Duplicate editions are real but tractable.** One record appears once per
format and territory — vinyl, CD, SHM-CD, digital — each a distinct release
under a shared release-group MBID. Collapse on the release-group, keep the
editions as detail. Deluxe editions are genuinely separate products and are
kept apart by `total_tracks`, which is what distinguishes them from a mere
repressing.

**Blocked on:** MBID resolution, which does not exist yet. All 625 artists have
`mbid = NULL`, so this is the next thing to build.

---

## 034 · MBIDs come from the Spotify URL relation, never from a name search

**Decided:** resolution asks MusicBrainz "which artist do you have for this
Spotify URL?" (`url?resource=...&inc=artist-rels`). A name search is a fallback
that fills the review queue and never writes an identity.

**Why, measured on the real roster.** Two artists on it are called WITCH and two
are called Pentagram. A name query returns *byte-identical* results for both
members of each pair — MusicBrainz's top hit for "Witch" is the Zambian zamrock
band whichever one you asked about:

```
score 100  6fc531d2  WITCH  [ZM]  Zambian psychedelic rock band
score  95  ad748c20  Witch  [??]  Chicago based experimental trio
score  87  279e253d  Witch  [US]  US heavy metal band from Orange County
```

Any strategy that trusts the top score gives both roster rows the same MBID and
merges two bands. That is decision 008 ("a false match is worse than a miss") at
the identity layer, where it is worse still: a wrong MBID silently attaches
another band's entire release history to your feed.

The URL join has none of that ambiguity — it is a relation a human curated.
Tested against both ambiguous pairs plus controls: **9 artists, 9 distinct
MBIDs, zero collisions.**

**Cost:** artists with no Spotify URL relation in MusicBrainz do not resolve at
all. On the live run that was roughly 20%, and they go to `match_queue` for a
human rather than being guessed at. Would change if the queue turns out to be
mostly obvious matches, meaning we are too timid — measure before loosening.

---

## 035 · A busy source degrades one artist, not the run

**Decided:** `resolveOne` is wrapped so a lookup that exhausts its retries
counts as a transient failure and the job continues. Health is reported from
what actually happened, not from whether the job crashed.

**Why:** the first live run died on artist 4 of 625 with "MusicBrainz stayed
busy after 4 attempts", having resolved 3. Constraint 2 says one failing source
must not empty the feed; the same logic applies inside a job, where one busy
lookup must not cost the other 621. The artist keeps `mbid = NULL`, so the next
run picks it up — `pendingArtists` selects on exactly that.

**Retry budget raised to 8 attempts, exponential, capped at 15s.** Four attempts
with linear backoff gave up while MusicBrainz was merely busy. Decision 033
measured why: the 503s come in bursts unrelated to our pacing.

**The trap this avoids:** `recordSuccess` on every run that did not throw. A run
where all 625 lookups 503'd would then report the source healthy — precisely the
invisible-breakage failure `adapter_health` exists to prevent. `recordHealth`
reports failure when every attempt failed.

**Also corrected:** the CLI promised "about 12 minutes" from the 1.1s pacing.
Measured on the real roster it is **about 8 seconds per artist** — two calls
each plus retries — so 625 artists is over an hour. The estimate now says so,
and mentions that Ctrl-C resumes.

---

## 036 · A forward-only cursor cannot finish a job that skips rows

**Found on the live roster.** The first full resolution run ended with the
cursor at 629 (the last artist id) and 133 unresolved artists *behind* it. Every
subsequent run then reported `complete` having attempted zero, because
`pendingArtists` selects `id > cursor` and there is nothing past the end.

The cursor is right for a first pass — it is what makes an hour-long job
resumable. It is wrong as a completion test, because an artist can be skipped
(MusicBrainz busy, or no record) and still leave the cursor moving past it.

**Decided:** when the tail comes back empty, rewind to 0 and sweep once more.
Only a sweep that starts from zero and finds nothing pending is genuinely
complete. Exactly once per run, guarded by a flag *and* a set of ids already
handled this run — without both, an artist MusicBrainz has no record of is
re-selected forever, and the ones already queued get queued again.

**Verified by mutation:** removing the rewind fails the two tests covering it.
Confirmed live: the cursor jumped 615 → 22 mid-run and the second pass ran to
completion.

**The reporting bug this exposed.** The same run printed "17 with no MusicBrainz
record" for a set including Gojira — an artist that resolves fine when asked
again. Those were transient 503s counted into `unresolved` and never surfaced
separately, so the CLI reported a permanent absence for a source that was merely
busy. That is the same class of lie as an empty feed that means "we did not
look". `transientFailures` now gets its own line.

**Caught by sanity, not by a test.** The 17 were only investigated because
Gojira and Thee Oh Sees looked wrong in a list of obscure bands. A result that
is plausible in aggregate can still be wrong in a way only domain knowledge
spots.

---

## 037 · The review queue holds questions, not events

**Decided:** `queueForReview` returns the existing row when the same artist is
already pending from the same source.

**Why:** three resolution runs produced **343 queue rows for 117 artists** —
Nightstalker, Sasquatch, Astroqueen and others queued three times each with
identical payloads.

The original comment justified not deduplicating on the grounds that the same
name from two *sources* is two judgements. That is true and unchanged. But the
same artist from the same source is one question asked repeatedly, and a review
queue three times longer than it needs to be is one nobody works through.

A decided row (confirmed or rejected) does not block a new one: that is a fresh
question about an artist whose earlier answer is already recorded.

**Repaired in place:** the 343 live rows were collapsed to 117, one per artist.

---

## 038 · Every transport fault is retried; politeness is not the lever

**Decided:** the MusicBrainz client retries any 5xx and any thrown network
error, not just 503. An aborted signal still propagates — that is the operator
stopping the job, not a fault.

**Why:** 503 was the only retried status, so a **502** — seen live alongside
503s — threw immediately and cost the artist. Dropped sockets
(`UND_ERR_SOCKET`, "other side closed") did the same. Both produced the failure
mode decision 036 already named once: an artist reported as having no
MusicBrainz record when the server had merely fallen over.

**Why not just slow down.** The instinct is to hit them more gently. Measured in
decision 033, that is backwards:

```
delay 1100ms:  4/10 ok
delay 1500ms:  6/10 ok
delay 2000ms:  0/10 ok
```

Slower was *worse*, and the 503s carried `x-ratelimit-remaining: 10-14` of 15 —
budget left, still refused. Identical pacing scored 4/10 and 9/10 on two runs.
The congestion is on their shared cluster, not in our request rate, so pacing
below the documented 1 req/sec buys nothing and costs hours on a 625-artist job.

**What actually helps**, in order: use browse/lookup rather than search (only
search shares the congested cluster); retry patiently with capped exponential
backoff; and degrade one artist rather than the run. Those three are why
resolution completes at all.

**Still open:** each artist costs two calls (identity, then links). Skipping the
links call for artists that already have links would cut a re-run roughly in
half. Tracked in `LIMITS.md` L03.

---

## 039 · Spotify has no lookahead at all; the upcoming feed is MusicBrainz-only

**Measured:** across **60 sampled roster artists and 542 albums**, Spotify's
`/artists/{id}/albums` returned **zero** future-dated releases. Not few — none.
The same artists show releases from days before the sample (Tramhaus "Swarm",
2026-08-26; Deathchant "KOVA/CRAWL", 2026-08-28), so the endpoint is current;
it simply does not carry announced-but-unreleased records.

MusicBrainz does. For Boy Harsher it had *GET MEAN* dated 2026-09-18 — eleven
days ahead — while Spotify showed nothing after 2026-08-26 for the same artist.

**Consequence:** "what is coming in the next two months", the thing the product
exists for, cannot be answered from Spotify under any strategy. This closes the
question left open when decision 032 ruled Spotify out on quota grounds: even
with unlimited quota it would not have the data.

**Corrects an earlier claim.** While planning the release pass I said Spotify
"returns announced-but-unreleased albums with future release_date values, but
inconsistently". That was wrong, and it was asserted from documentation rather
than measurement. It is zero.

**Also corrected:** the deluxe-edition duplication (decision 033) does not
appear at release-group level. Haken's *Fauna* and *Fauna (Deluxe Edition)* are
one release-group in MusicBrainz — the duplication lives at the *release* level.
Browsing release-groups therefore collapses it for free, which is another point
in favour of the endpoint chosen for other reasons.

**Upcoming releases are rare.** Two future-dated release-groups across the four
recorded artists, and zero across the first ten of a wider sample. A feed
section for them will usually be short or empty, which is a design constraint
rather than a bug.

---

## 040 · Schema changes need migrations, not just schema.sql

**Decided:** `PRAGMA user_version` plus an append-only `MIGRATIONS` array in
`src/db/index.ts`, run on every `openDatabase`.

**Why:** `schema.sql` is entirely `CREATE TABLE IF NOT EXISTS`. It builds a new
database correctly and does **nothing at all** to one that already exists. Two
columns were needed for the release pass — `release_details.date_precision` and
`artists.last_release_check_at` — and adding them only to `schema.sql` would
have made them present for new installs and silently absent for every existing
one. For a self-hosted app that is everybody who has already used it.

`user_version` rather than a migrations table: it is built into SQLite, needs no
schema of its own, and cannot drift from the thing it describes.

**Each migration must be safe against a fresh database**, because a new install
runs `schema.sql` *and* the migrations. Duplicate-column errors are swallowed;
anything else propagates.

**Verified:** a test builds a database the old way, migrates it, and asserts the
columns appear and existing rows survive. Commenting out the `migrate(db)` call
fails it. The live 625-artist database was migrated in place — version 0 → 1,
both columns added, 625 artists and 495 MBIDs intact.
