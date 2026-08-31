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
