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
docker compose up      # the actual artifact
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
src/app/            Next.js routes and UI
src/app/Feed.tsx    the release feed: cards, month sections, filters, pagination
src/app/feed-filters.ts the filter predicates, month grouping and page windowing
src/app/feed-format.ts dates at the precision we actually have, and no more
src/app/InfoNote.tsx a note behind an icon, for text that is read once
src/app/Masthead.tsx the shared header: wordmark, nav with counts, catalogue labels
src/app/FlagButtons.tsx the three marks — save, listened, liked — as inline SVG
src/app/SavedList.tsx one row per record; both list pages render it
src/app/use-event-flags.ts optimistic flag state, reverted when a write fails
src/app/playlist/page.tsx the playlist: what you saved from the feed to hear later
src/app/favs/page.tsx the records you hearted after hearing them
src/app/api/events/[id]/state/route.ts writes one flag without touching the others
public/            the mark and its favicons; the only static assets
tests/              standalone .mjs suites, auto-enrolled by run.mjs
tests/liked.mjs     liked-songs paging and artist extraction, against a fixture
tests/liked-db.mjs  the list flags, and the real schema.sql-then-migrate path
tests/state.mjs     the event flags: migration 4, and that one never clears another
tests/state-route.mjs the flag route in process: rejected input, and partial writes
tests/fixtures/     recorded upstream responses — never call live APIs in tests
tests/pager-scroll.mjs hand-run: proves turning a page returns you to the top
tests/record-fixture.mjs  hand-run: the one script that does call live Spotify
tests/seed.mjs      hand-run: builds data/seed.db so screens work without OAuth
```

Not built yet: gigs, and every source adapter other than Spotify and
MusicBrainz. `LIMITS.md` tracks what is deferred and
what would lift each limit — the improvement queue for after the happy path
works; `tests/docs.mjs` keeps its shape honest. Releases come from MusicBrainz rather than
Spotify (decisions 032/033/039) — see
`VENUES.md` for the Berlin venues the gig sources will target.

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

> **Artists are artists; the list is provenance.**
> Followed artists and liked-song artists are one `artists` table and one
> `user_artists` row per artist, carrying a `followed` and a `liked` flag. Not
> one row per source: measured on a real library, **477 of 1,408 liked artists
> are also followed**, so the overlap is the normal case, and a row per source
> would make every feed query need `DISTINCT` to avoid showing those twice.
> A third list (Trias) is a third flag. Would change past four or five lists,
> where a join table starts earning its keep.

> **Liked artists arrive without images, and that is not worth fixing.**
> `/me/tracks` nests only artist id and name. The batch `GET /artists?ids=` that
> would have filled in images for 1,400 artists in 28 calls is **gone** —
> measured 403 on an allowlisted token — so the alternative is one call per
> artist. Type carries the hierarchy here anyway. Would change if Spotify
> restores a batch artist endpoint.

> **Volume is the risk, not sparsity.**
> A 4-month release window across thousands of artists produces a lot of items.
> Singles are the bulk of the noise. Dismiss and sub-filters are load-bearing,
> not conveniences.

> **Save, listened and liked are three flags, not three stages.**
> One `event_state` row per (user, event) carries `queued`, `listened` and
> `favorited`, and every write names only the flag it changes. A state machine
> holding one of them at a time was rejected because it cannot represent
> "listened and did not like it", which is the ordinary outcome of working
> through the playlist. Hearting a record therefore leaves it on the playlist:
> the two lists overlap by design, the way `followed` and `liked` do on
> `user_artists`. Would change if a fourth mark arrived that genuinely replaced
> an earlier one rather than adding to it.

> **The feed is for scanning; the lists are for working through.**
> The feed is a card grid because the question there is "anything new across
> 600 records". The playlist and favs are one row per record, because the
> question is "what is left, and what did I think of it" — and a line per record
> fits more of them on screen with the marks in one column the eye can run down.
> Would change if the lists ever grew past a few hundred rows, where they would
> need the feed's filters and pagination too.

> **A saved list is read two ways, so it offers both.**
> By month (the default) groups by release date the way the feed does: the list
> as a plan, what is out and what is coming. Recently added keeps the order the
> rows were saved in, ungrouped: the list as a queue, where the thing you just
> put there is on top. Neither is a superset of the other, which is why this is
> a control rather than a default someone has to live with. `added` is the
> identity on what `getFlaggedEvents` returned — a `FeedItem` carries no
> `updated_at`, so any re-sort would silently destroy that order.

> **A row leaves its list the moment its flag goes.**
> Un-hearting in favs, un-saving on the playlist and the X all remove the row
> at once, and the count follows it. The first version kept the row in place,
> struck through, so nothing moved under the cursor and a misclick was one
> press from being undone. That was the wrong trade and was reported as a bug:
> a page named after a list must not show records that are not on it. Would
> change if removal ever became hard to reverse, which would argue for an undo
> rather than for leaving the row behind.
>
> `visibleList` filters and orders in one call for this reason. The predicate
> was already correct when the bug was reported; nothing applied it before
> ordering, and a test of the predicate alone passed while the screen was
> wrong.

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

  Re-verified 2026-09-17 with a live call on an allowlisted token: `/me` 200,
  `GET /artists/{id}` 200, `GET /artists?ids=` **403**. The [reference page for
  Get Several Artists](https://developer.spotify.com/documentation/web-api/reference/get-multiple-artists)
  is still published and its "Deprecated" labels sit on *fields*, not on the
  endpoint — so the docs read as though batch still works. It does not. Trust
  the 403 over the page.

- Separately, `genres`, `popularity` and `followers` are **deprecated fields**
  and already return empty/null on live responses (measured the same day:
  Pitbull came back with `genres: []` and `popularity: null`). `images` is
  unaffected. `RosterEntry` still carries genres and popularity; nothing reads
  them, and nothing should start.

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
- **Catalogue numbering, but not on every row.** The FAC-number idea is right
  for the page as an object (the header carries `BND 0001`), and wrong repeated
  down a 200-row feed: `BND 0504` beside every release is a number nobody reads,
  competing with the date and the artist for the same glance. `catalogueNumber`
  still exists and still has its tests. Would change if an event ID ever became
  something you need to quote.
- **Information as texture.** Dense condensed or monospaced metadata blocks,
  hard rules between them.
- **The grid is visible.** Hard rules, boxes, obvious columns. Not hidden.
- **Restraint against the palette.** Saville used flat colour sparingly on a lot
  of white. Magenta and violet are allowed on real surfaces, but the default is
  still a lot of white with colour placed where it means something.

### Palette

**`PALETTE.md` is the reference**: every colour, what it is for, and the
measured ratio of every pairing worth knowing. The values themselves live in
`src/app/globals.css`, and `tests/contrast.mjs` parses that file, so a hex is
declared exactly once in the codebase.

The short version:

- `#FFFFFF` white, `#333129` near-black olive, `#F7D000` dandelion yellow carry
  the interface.
- `#F700A8` magenta and `#9C00F7` violet are **usable on surfaces, not only as
  hairlines**. The earlier rule confined them to accents; what actually matters
  is the measurement, not the area, and `PALETTE.md` records which pairings
  pass. Restraint is still the intent — a lot of white with colour placed
  deliberately — but it is a design judgement now rather than a hard limit.
- `#000000` true black is the striped ground and nothing else. It is NOT
  `--ink`: the two differ, and ink on true black is 1.61:1, so no type is ever
  set on the stripes.

The yellow is **flyer stock**, not a text colour: a surface you set black type
on, the way a screenprinted poster works.

### Rules

- **Zero border-radius**, with two exceptions, both circles drawn around
  circular artwork. No rounded corners anywhere else, including avatars and
  images — hard edges are the whole point. The exceptions are the save stamp
  (`.stamp`), a 24px circle carrying the bolt on a sleeve's corner, and the
  masthead mark's focus ring (`.masthead-home`), which would otherwise box a
  circular logo. Both are ink marks rather than interface chrome.
  `tests/contrast.mjs` holds the allowlist and fails on a rounded corner
  anywhere else, naming the offending selector, so these are documented
  exceptions rather than a loosened rule.
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

### Taking a screenshot without fooling yourself

Three separate times this went wrong in one session, each time producing a
screenshot of something other than the current build:

- **Stop the server before `npm run build`.** Building over a running server
  corrupts `.next` and the page renders with no CSS at all.
- **Kill by port, not by task.** A dead server can keep port 3000, so the next
  one silently takes 3001 and the screenshot captures the old build.
- **Wait for something new, not for a 200.** Poll for a string that only the
  new build contains. "The server answered" is not "the server answered with
  your change".

### A fractional rem at bold can render a seam

A button set at `0.8rem` (11.2px) bold in the monospace stack drew a visible
lighter band through the middle of one word, on an inked background. It looked
exactly like a stray `background` rule or a stuck `:hover`, and it was neither:
the markup was plain text and no selector matched. Whole-pixel `font-size`
fixed it, which is why `.feed-weekbtn` and `.list-orderbtn` both set px rather
than rem.

Worth knowing because the search for it went through the markup, the cascade
and the source order first. If a "highlight" appears mid-word with no rule that
could paint it, suspect the font size before the stylesheet.

### An inline style beats a stylesheet rule

Regardless of order or specificity. A `margin: 0` in a component silently
cancelled a `margin-top` in `globals.css` and the gap measured 0px while both
files looked right. The same thing happened earlier with `display: block`
beating a media query. When a CSS change does not take, look for an inline
style on the same element before doubting the selector.

### How a round of changes should go

**From me:** a screenshot with marks on it; numbered items batched by screen;
which ones need discussion; anything about *feel*, since screenshots are static.

**From you:** the bullets above, in that order.

---

## Before committing

Run `npm run verify`.
