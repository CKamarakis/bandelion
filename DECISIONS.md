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
