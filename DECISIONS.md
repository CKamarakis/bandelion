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
