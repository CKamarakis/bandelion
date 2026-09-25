# CLAUDE.md — Bandelion

## What this is

Bandelion is a **self-hosted personal music radar**. It takes the artists you
follow on Spotify and answers one question per artist: *anything new?* — a new
release, an announced release, a gig in your city, a video, a review. Everything
lands in one filterable feed.

It is **not** a music player, not a recommender, and not a public product. See
*The Spotify ceiling* below for why that last one is a fact rather than a
choice.

**The artifact:** `docker compose up` on a laptop or a small VPS, working
against live third-party sources, still working in three months when one of
those sources has changed its JSON.

That sentence decides most arguments. It is why there is a server, why state
lives in SQLite rather than a file, why every source sits behind an adapter, and
why no test may call a live API.

## Commands

```bash
npm install
npm run dev            # Next.js dev server
npm run build
npm start              # serve the production build
npm test               # whole suite
npm run verify         # build + test — run before committing
npm run ingest         # roster; also `liked`, `resolve` (MBIDs), `releases`, `covers`
npm run seed           # build a seeded database, so screens work without OAuth
npm run eval:matcher   # artist-name matcher eval set, prints a score
npm run fixtures:record # capture a live upstream response into tests/fixtures/
npm run shots          # screenshots via real browser
docker compose up      # the actual artifact — not written yet (docker-and-ci)
```

## Architecture

> Keep this current. `tests/docs.mjs` fails the build if this section names a
> file that does not exist.

Written as phases land. What exists today:

```
src/adapters/       one file per source, all implementing SourceAdapter
src/adapters/types.ts   the contract every adapter implements
src/adapters/spotify.ts two artist lists: followed artists and liked-song artists
src/adapters/musicbrainz.ts identity by Spotify-URL join, links, and release-groups
src/adapters/coverart.ts sleeve images from the Cover Art Archive, by release-group MBID
src/auth/           OAuth: PKCE, token exchange, encryption at rest
src/auth/crypto.ts  AES-256-GCM for tokens; the DB never holds plaintext
src/config.ts       every per-instance value, read from env
src/config-env.ts   .env loading for entry points Next does not start
src/db/             schema, migrations, queries
src/jobs/           checkpointed ingest jobs
src/jobs/roster.ts  the Spotify roster import: resumable, never deletes
src/jobs/liked.ts   the liked-songs import: artists credited on saved tracks
src/jobs/resolve.ts MBID resolution: exact join first, review queue second
src/jobs/releases.ts release sweep: MusicBrainz release-groups into events
src/jobs/covers.ts  cover art pass: stamps checked, so a coverless release is asked once
src/jobs/cli.ts     `npm run ingest`
src/matcher/        artist-name matching, tiered and deterministic
src/matcher/triage.ts which name-search candidates are safe to accept without a human
src/app/            Next.js routes and UI
src/app/Feed.tsx    the release feed: cards, month sections, filters, pagination
src/app/feed-filters.ts the filter predicates, month grouping and page windowing
src/app/feed-format.ts dates at the precision we actually have, and no more
src/app/ArtistLink.tsx the artist name as a link: desktop app first, web as fallback
src/app/artist-link-url.ts the two URLs that link can point at, importable by tests
src/app/InfoNote.tsx a note behind an icon, for text that is read once
src/app/Masthead.tsx the shared header: wordmark, nav with counts, catalogue labels
src/app/FlagButtons.tsx the three marks — save, listened, liked — as inline SVG
src/app/SavedList.tsx one row per record; both list pages render it
src/app/use-event-flags.ts optimistic flag state, reverted when a write fails
src/app/ReviewList.tsx the review queue: one artist per block, one button per candidate
src/app/review/page.tsx the names MusicBrainz could read more than one way
src/app/api/review/[id]/route.ts one decision: accept a candidate, or none of them
src/app/playlist/page.tsx the playlist: what you saved from the feed to hear later
src/app/favs/page.tsx the records you hearted after hearing them
src/app/api/events/[id]/state/route.ts writes one flag without touching the others
public/            the mark and its favicons; the only static assets
tests/              standalone .mjs suites, auto-enrolled by run.mjs
tests/liked.mjs     liked-songs paging and artist extraction, against a fixture
tests/liked-db.mjs  the list flags, and the real schema.sql-then-migrate path
tests/state.mjs     the event flags: migration 4, and that one never clears another
tests/state-route.mjs the flag route in process: rejected input, and partial writes
tests/artist-link.mjs where an artist link points, and what SPOTIFY_LINK_TARGET accepts
tests/review.mjs the review queue, and the route that decides one row
tests/triage.mjs the triage rules, each against a real row from the queue
tests/fixtures/     recorded upstream responses — never call live APIs in tests
tests/pager-scroll.mjs hand-run: proves turning a page returns you to the top
tests/record-fixture.mjs  hand-run: the one script that does call live Spotify
tests/seed.mjs      hand-run: builds data/seed.db so screens work without OAuth
openspec/specs/     what the system does, one spec per capability — the source of truth
openspec/changes/   work in flight: the roadmap, one change per piece
docs/               reference and evidence; README.md indexes it
docs/PRODUCT.md     the product rules, each with why and what would change it
docs/DECISIONS.md   what was decided while building, and why — history
docs/LIMITS.md      what is deferred, and what would lift each limit
docs/DESIGN.md      the look, the rules and the palette with measured contrast
docs/SPOTIFY.md     what the Spotify API allows, measured
docs/TESTING.md     each suite, the bug it exists for, and the traps
docs/TRIAGE.md      the evidence behind every triage rule
docs/VENUES.md      the Berlin venues the gig sources will target
```

Not built yet: gigs, and every source adapter other than Spotify and
MusicBrainz. `docs/LIMITS.md` tracks what is deferred and
what would lift each limit — the improvement queue for after the happy path
works; `tests/docs.mjs` keeps its shape honest. Releases come from MusicBrainz rather than
Spotify (decisions 032/033/039) — see
`docs/VENUES.md` for the Berlin venues the gig sources will target.

---

## Constraints

These are load-bearing. Breaking one silently defeats the purpose.

1. **No test calls a live third-party API.** Record a fixture, replay it. A
   suite that fails when Eventim is down is a suite everyone learns to ignore.
   Every adapter ships with a captured fixture of the real upstream shape; when
   a source changes its JSON, the fixture diff names what broke.
2. **An adapter never throws out of `fetch`.** It records the failure and
   returns `[]`. One failing source must never empty the feed or block the
   others. A test that disables an adapter and asserts the feed still renders
   and `adapter_health` shows degraded is **owed, not written** — the
   `docker-and-ci` change adds it. That promise is the whole architecture, and
   untested it is a wish.
3. **Documentation is tested, not remembered.** A test asserts this file names
   only files that exist and documents every npm script. Prose drifts silently;
   this fails the build instead. (The docs this project inherited said "the four
   rules" three times while listing seven. That is the failure mode.)
4. **Nothing iterates the full roster inside a request handler.** The roster is
   thousands of artists. All ingest is a checkpointed, resumable job. The UI
   must be usable while ingest is incomplete.
5. **Test by rendering, not by reading.** The worst bugs pass every static
   check. Mount the built app and drive it. A green suite is not a working
   screen — screenshots catch what text checks cannot, every time.
6. **The rules are executable.** Whatever the product refuses to promise,
   assert it. Includes a grep over the source for copy claiming what the data
   cannot support (see *Copy* below).

---

## Domain rules

The reasoning lives in `docs/PRODUCT.md`; the behaviour in `openspec/specs/`.

| Rule | Spec |
|---|---|
| The feed is the product; releases and gigs are event types | `release-feed` |
| Sort by urgency, not by date | gigs, not built |
| Fetch gigs by city, match locally | gigs, not built |
| Deterministic matching before any LLM | `identity-resolution` |
| Artists are artists; the list is provenance | `roster-import` |
| Liked artists arrive without images | `roster-import`, `docs/LIMITS.md` L13 |
| Volume is the risk, not sparsity | `release-feed` |
| Save, listened and liked are three flags, not three stages | `event-flags` |
| The feed is for scanning; the lists are for working through | `release-feed`, `event-flags` |
| A saved list is read two ways, so it offers both | `event-flags` |
| A row leaves its list the moment its flag goes | `event-flags` |
| An artist link tries the desktop app and falls back to the web | `artist-links` |
| Triage accepts what it can prove; two artists never share an MBID | `identity-resolution` |
| An ambiguous name is a decision, and the decision is kept | `review-queue` |
| Links are best-effort and say so | `identity-resolution` |

---

## The Spotify ceiling

Five allowlisted users per app, Premium required for the owner, no tier an
individual can reach, and no batch artist endpoint (`GET /artists?ids=` is
403). **Do not spend effort working around it**: self-hosting is the answer.
The measurements and their sources are in `docs/SPOTIFY.md`.

---

## Unofficial sources

Eventim's public endpoint, Resident Advisor's GraphQL API and the promoter
crawlers are **undocumented**. They are what make Berlin coverage good, and they
can change without notice.

This is accepted for a personal instance running a few requests a day. **It
would need revisiting if Bandelion were ever publicly hosted.** Constraint 2
exists so that when one breaks, it is a degraded row rather than an outage.

---

## Conventions

- Comments explain **why**, not what. Match the existing density.
- Long strings passed to a helper get hoisted to a named `const` above the
  component, so the markup stays readable.
- **Use Write/Edit, never shell heredocs**, for anything containing backticks,
  template literals, apostrophes or regex. Heredocs have silently corrupted
  source files before, and PowerShell on Windows makes it worse.
- **No TypeScript that needs code generation.** The suites run `src/` directly
  under `node --experimental-strip-types`, which erases types without emitting
  code. Constructor parameter properties, enums, namespaces and decorators are
  all a hard error. Declare the field and assign it in the body.

## Design

Post-punk and Factory Records: DIY flyer, xerox, screenprint. `docs/DESIGN.md`
holds the look, the rules and the palette with measured contrast. The rules
that fail the build: zero border-radius (two documented exceptions), no
shadows, gradients or glassmorphism, and every hex in `docs/DESIGN.md` must
ship in `src/app/globals.css` — all asserted by `tests/contrast.mjs`. Type
carries the hierarchy; colour never carries meaning alone. **Any colour change
gets measured.**

---

## Triage

Changing which MusicBrainz candidates resolve without a human follows
`.claude/skills/triage/SKILL.md`, invocable as `/triage`. Measure against the
real queue first, write the test from a real row, and keep the anti-merge
assertion in `tests/resolve.mjs` true. `docs/TRIAGE.md` is the evidence log.

## Copy

User-facing strings follow the eight rules in `.claude/skills/copy/SKILL.md`,
invocable as `/copy`.

**The one that matters most here: copy must not assert what the product cannot
do.** Bandelion's data is incomplete by nature — missing support acts, absent
on-sale dates, unresolved links. A UI reading "Tickets on sale Friday" because
we failed to parse a status is exactly this bug. Before writing a label, ask
what the system actually knows. If the honest answer is smaller than the copy,
the copy is wrong.

---

## Working with me

Every line came from something that went wrong or right in a real session.

- **Ask only what changes the build.** Questions with an obvious default get the
  default, stated plainly, not a dialog.
- **Screenshot and check your own work before handing back.** Non-negotiable.
  jsdom proves it works; it has no layout engine, so it cannot show
  misalignment, overflow or overlap.
- **Say what you did not do, and why.** Quietly dropping an item is worse than
  flagging that it needs a decision.
- **Push back once, then build.** If I reaffirm, implement it fully.
- **When I report a bug, reproduce it before fixing it.** Then re-break it after
  the fix to prove the new test catches it. A test written from a description
  tests the description.
- **Verify a checker before trusting it.** Break the thing deliberately, confirm
  the test fails, restore. A green suite proves the checks ran, not that they
  looked at the right thing.
- **Do not trust a passing suite over my screenshot.**
- **One test run, not two.** Capture once.

**Before a screenshot or a CSS fix, read the Traps in `docs/TESTING.md`**:
building over a running server, a stale port, inline styles beating the
stylesheet, and a fractional rem that paints a seam have each cost a session.

### How a round of changes should go

**From me:** a screenshot with marks on it; numbered items batched by screen;
which ones need discussion; anything about *feel*, since screenshots are static.

**From you:** the bullets above, in that order.

---

## Before committing

Run `npm run verify`.
