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
npm run ingest         # trigger ingest manually, don't wait for the scheduler
npm run seed           # build a seeded database, so screens work without OAuth
npm run eval:matcher   # artist-name matcher eval set, prints a score
npm run fixtures:record # capture a live upstream response into tests/fixtures/
npm run shots          # screenshots via real browser
docker compose up      # the actual artifact
```

## Architecture

> Keep this current. `tests/docs.mjs` fails the build if this section names a
> file that does not exist.

Written as phases land. What exists today:

```
src/adapters/       one file per source, all implementing SourceAdapter
src/adapters/types.ts   the contract every adapter implements
src/adapters/spotify.ts the roster source: followed artists, paged and resumable
src/auth/           OAuth: PKCE, token exchange, encryption at rest
src/auth/crypto.ts  AES-256-GCM for tokens; the DB never holds plaintext
src/config.ts       every per-instance value, read from env
src/db/             schema, migrations, queries
src/jobs/           checkpointed ingest jobs
src/jobs/roster.ts  the Spotify roster import: resumable, never deletes
src/jobs/cli.ts     `npm run ingest`
src/matcher/        artist-name matching, tiered and deterministic
src/app/            Next.js routes and UI
tests/              standalone .mjs suites, auto-enrolled by run.mjs
tests/fixtures/     recorded upstream responses — never call live APIs in tests
```

Not built yet: the feed itself, release fetching, and every source adapter
other than Spotify.

---

## Constraints

These are load-bearing. Breaking one silently defeats the purpose.

1. **No test calls a live third-party API.** Record a fixture, replay it. A
   suite that fails when Eventim is down is a suite everyone learns to ignore.
   Every adapter ships with a captured fixture of the real upstream shape; when
   a source changes its JSON, the fixture diff names what broke.
2. **An adapter never throws out of `fetch`.** It records the failure and
   returns `[]`. One failing source must never empty the feed or block the
   others. There is a test that disables an adapter and asserts the feed still
   renders and `adapter_health` shows degraded — that promise is the whole
   architecture, and untested it is a wish.
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

Product decisions with reasons. Format: **a bolded claim, then why, then what
would change it.**

> **The feed is the product; releases and gigs are event types.**
> Both are rows in `events`, discriminated by `type`. The alternative — parallel
> release and gig systems — was rejected because every requirement that arrived
> during planning ("show the latest release on a gig card") crossed the
> boundary. Would change if the two types stopped sharing a timeline.

> **Sort by urgency, not by date.**
> Berlin shows are announced anywhere from 14 months to 2 weeks ahead. Pure
> chronological order buries an urgent thing under distant festival dates. For
> gigs the urgent moment is usually the **ticket on-sale date**, not the show
> date: a show 8 months out with tickets dropping Friday is the thing you must
> not miss. Would change if on-sale dates prove too unreliable to sort on.

> **Fetch gigs by city, match locally.**
> With thousands of followed artists, per-artist event queries are thousands of
> calls per poll. Pulling all city events in the window is hundreds of calls
> total. Consequence: even official sources need name matching, so the matcher
> is not only for crawled sources.

> **Deterministic matching before any LLM.**
> An LLM resolves messy lineup strings better than fuzzy matching, but it is a
> per-instance API key, a cost, and a dependency in an app whose selling point
> is that you run it yourself. The eval set exists so that when an LLM adapter
> is added, it has to *prove* it beats the deterministic tiers. Would change if
> the eval score plateaus somewhere useless.

> **Volume is the risk, not sparsity.**
> A 4-month release window across thousands of artists produces a lot of items.
> Singles are the bulk of the noise. Dismiss and sub-filters are load-bearing,
> not conveniences.

> **Links are best-effort and say so.**
> Artist links come from MusicBrainz URL relationships, fetched in the same call
> as MBID resolution. TikTok is poorly covered and will often be missing. The UI
> must not imply a complete profile.

---

## The Spotify ceiling

**Verified during planning. Do not spend effort working around it.**

- Development mode allows **5 allowlisted users per app**. The allowlist is on
  *your app*, not on their accounts: a non-allowlisted user can complete OAuth,
  then every API call returns **403**.
- The app owner must hold **Spotify Premium** or the app stops working.
- Extended quota mode — the only tier above 5 users — requires a registered
  business, a launched service, and **250,000+ MAU**. Individuals are not
  eligible. There is no intermediate tier and no self-serve upgrade.
- `GET /artists` (batch) was **removed** in Feb 2026. Fetch individually via
  `GET /artists/{id}`. The local cache is therefore load-bearing, not an
  optimisation. `/me/following` and `/me/top/artists` survived.

**Self-hosting is the answer to this**, not a workaround for it: each person
runs their own instance with their own Spotify app, is their own owner, and is
allowlisted by default.

Sources: [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
[Feb 2026 migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide),
[extended access criteria](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access).

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

**Post-punk and late-80s/90s indie.** DIY show flyer, xerox and screenprint,
fanzine cut-and-paste. Factory Records, Fugazi sleeves, a photocopied poster
stapled to a pole. Underground, rough, groovy, fun — built for people who take
music seriously and design that does not take itself seriously.

**Not:** friendly SaaS, soft cards, pastel anything.

### The Factory idea, and why it fits

Peter Saville's Factory sleeves were **information design pretending to be
art**: Unknown Pleasures is a pulsar plot, FAC numbers catalogued everything
including the office cat, and the sleeve often carried less band-name than a
specimen chart would.

That is the right model for Bandelion, because Bandelion **is** a list of dates,
venues and catalogue numbers. So:

- **The data is the ornament.** Do not decorate the feed. Set the dates, venue
  names and metadata in heavy type at real scale and let density carry the look.
- **Catalogue numbering, shown.** Every event carries an ID; display it
  (`BND 0417`). Honest — we have the IDs anyway — and exactly the reference.
- **Information as texture.** Dense condensed or monospaced metadata blocks,
  hard rules between them.
- **The grid is visible.** Hard rules, boxes, obvious columns. Not hidden.
- **Restraint against the palette.** Saville used flat colour sparingly on a lot
  of white. This is why magenta and violet are accents only.

### Palette

**Primary — carries the whole interface:**
- `#FFFFFF` white
- `#333129` near-black olive
- `#F7D000` dandelion yellow

**Accent — CTAs, emphasis, supporting material only. Never body text, never
large surfaces:**
- `#F700A8` magenta
- `#9C00F7` violet

The yellow is **flyer stock**, not a text colour: a surface you set black type
on, the way a screenprinted poster works.

| Pairing | Ratio | Use |
|---|---|---|
| `#333129` on `#FFFFFF` | ≈12:1 | body text |
| `#333129` on `#F7D000` | ≈9:1 | high-impact blocks, headers, callouts |
| `#F7D000` on `#FFFFFF` | ≈1.6:1 | **never for text** — fails badly |
| accents on white / on olive | check per use | measure before shipping |

### Rules

- **Zero border-radius.** No rounded corners, anywhere, including avatars and
  images. Hard edges are the whole point.
- **No soft shadows, no gradients, no glassmorphism.** Flat blocks and hard
  rules. If depth is needed, use a hard offset block, not a blur.
- **Type carries the hierarchy** — weight, scale and case, not colour. Heavy
  condensed display faces, tight tracking, big jumps between levels. Colour is
  emphasis, never the only signal.
- **Colour never carries meaning alone.** State is border plus shape plus label.
- **Rough on purpose, not sloppy.** Texture, hard rules, slight rotation on
  accents is welcome. Misaligned grids and unreadable text are not.
- **Every element earns its line.** A label repeating identically on every
  instance carries no information. Counters name what they count: never
  "1 left".
- **Anything that expands in place scrolls itself into view.**
- **Consistency of gesture beats economy of controls.** If one row confirms by
  tap, they all do.

**Any colour change gets measured.** `tests/contrast.mjs` parses declared values
out of the stylesheets and computes ratios, so it tests what ships. Never
restate a hex in the test — read it from the source. Three separate contrast
bugs shipped on the previous project this way, worst at 1:1: text exactly the
colour of its own background, reported as "the buttons look empty".

---

## Copy

User-facing strings follow the seven rules in `.claude/skills/copy/SKILL.md`,
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

### How a round of changes should go

**From me:** a screenshot with marks on it; numbered items batched by screen;
which ones need discussion; anything about *feel*, since screenshots are static.

**From you:** the bullets above, in that order.

---

## Before committing

Run `npm run verify`.
