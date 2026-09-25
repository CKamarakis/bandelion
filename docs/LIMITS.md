# Known limits

What Bandelion does not do yet, or does worse than it should.

**The point of this file is sequencing, not confession.** The goal is a working
end-to-end flow first; improvement passes come after. Something is written here
so it can be *deliberately* deferred rather than forgotten, and so the second
pass has a work queue instead of a memory test.

## How this differs from the other docs

- `docs/DECISIONS.md` — what was decided and why. Closed questions.
- `docs/LIMITS.md` (this file) — what the decision costs, and what would lift it.
  Open questions, deliberately parked.
- `CLAUDE.md` — the rules. Not negotiable per-phase.

A limit graduates out of this file when it is fixed, or into `docs/DECISIONS.md`
when we decide to live with it permanently.

## Format

Each entry: **what is limited**, the **measured** cost where a number exists,
what would **lift** it, and the **trigger** — the observation that should make
us act. An entry with no measurement says so; a guess labelled as a measurement
is worse than no entry.

**Severity** is about the feed, not about effort:

- **blocks-flow** — the happy path does not work without this.
- **degrades** — the flow works, output is thinner or noisier than it should be.
- **cosmetic** — nobody's decisions change because of it.

---

## L01 · About 17% of artists resolve to no MBID · degrades

**Measured, run complete:** of 625 artists, **495 resolved (79.2%)**, 117
queued for review (18.7%), 13 with no MusicBrainz record at all. A second pass
over the artists the first pass stranded recovered only 3 more, so this is the
ceiling for the URL-join strategy alone.

**What they are.** Not ambiguous artists — artists MusicBrainz has no Spotify
URL relation for. Of the first 55 queued: 50 were exact name matches at score
100, 54 had exactly one candidate at the top score, and all 55 had names unique
within the roster. Steak, Karkara, Mount Hush, Dirty Sound Magnet — small bands,
thinly edited. Sampling four of their MusicBrainz entries, **none carried a
Spotify URL at all**, which is why the join found nothing.

**Why the obvious fix is wrong.** "Auto-accept when one candidate leads on
score" was tested against the recorded WITCH fixture and would assign *both*
roster WITCHes the same Zambian MBID — the exact merge decision 034 exists to
prevent. It is not a candidate.

**What would lift it.** A narrower rule: auto-accept a name match only when the
candidate has **no Spotify URL of its own**, is the only candidate at the top
score, and the name matches exactly after normalisation. A candidate carrying a
*different* Spotify URL is positive evidence of a different band and stays
queued. Costs one extra lookup per queued artist, and only runs for artists the
URL join already failed.

**Expected**: 17% → roughly 2-3%. **Untested** — that number is a projection,
not a measurement.

**Trigger:** do this before the release pass matters, since an unresolved artist
contributes nothing to the feed. Not before the flow works end to end.

### Re-measured on the full roster, 2026-09-20

A complete resolve pass over 1,556 artists (both lists) **resolved 0 of the 315
it attempted** in 42 minutes: 264 queued, 52 with no MusicBrainz record, 2 that
MusicBrainz was too busy to answer for.

Reading the queue's own payloads rather than a sample of 55:

| Of the 264 pending | n |
|---|---|
| exactly one candidate at score 100, and its name is the only exact match | 188 |
| one at 100, but other candidates share that exact name | 56 |
| one at 100, whose name is not an exact match | 14 |
| several candidates tied at 100 | 6 |
| best candidate below 100 | 0 |

So the queue is not mostly recording doubt. **188 of 264 have one exact-named
candidate and nothing competing** — the rule's absence, not ambiguity.

**A stricter rule, tested against the real queue.** Auto-accept when there is
exactly one candidate at score 100, its normalised name is the only exact match
in the candidate list, **and** no other candidate scores ≥90. That accepts
**186** and leaves **78** for a human.

Checked for the merge this section warns about: across those 186 acceptances
there are **186 distinct MBIDs and zero collisions**, so it does not reproduce
the WITCH failure on this roster. That is one roster, not a proof — the
no-Spotify-URL condition above is still the stronger signal and the two should
probably be combined rather than chosen between.

**Still untested against the eval set.** `npm run eval:matcher` has not been run
against this rule, and per CLAUDE.md a matcher change has to prove itself there
before it ships.

## L02 · Triage cannot reach a name MusicBrainz files differently · degrades

**Lifted, mostly.** Triage now auto-accepts a name search when one candidate
survives every rule (decision 044, `docs/TRIAGE.md`), and searching aliases as well
as names fixed the transliteration class. Simulated over the 264 pending rows:
**200 accepted, 64 left, zero MBID collisions.**

What remains is narrower. Triage can only choose among the candidates the
search returned, so a name MusicBrainz holds under neither its name nor an
alias is unreachable by any rule. `Tripes` was rescued by the alias query;
nothing rescues a band whose MusicBrainz entry has no alias recorded and a
differently transliterated title.

**What would lift it:** nothing cheap. Fuzzy matching across scripts is the
obvious idea and is exactly the guess the whole design refuses.

**Trigger:** if a Greek or Cyrillic band you follow keeps appearing in the
review queue with no plausible candidate, it is this. Adding the alias to
MusicBrainz upstream fixes it for everyone.

## L03 · MusicBrainz throughput is far worse than its documented rate · degrades

**Measured:** about 8 seconds per artist over a real roster, against the ~1.1s
the documented one-request-per-second pacing implies. Two calls per artist
(identity, then links) plus frequent 503 retries account for the gap. Late in
the run it degraded further, to about **2 artists per minute**, so a full 625
roster is over an hour and can be considerably worse.

Decision 033 measured the cause: MusicBrainz's search cluster 503s in bursts
unrelated to our pacing — slowing from 1100ms to 2000ms made the success rate
*worse*, not better.

**What would lift it:**

- Skip the links call when an artist already has links, halving calls on re-runs.
- Persist which artists have been *attempted* and when, so a re-run does not
  retry a permanently-absent artist every time.
- Nothing will make this fast. It is a background job and should be scheduled,
  not waited on.

**Trigger:** when the scheduler exists. Until then the CLI says how long it will
take and resumes on Ctrl-C, which is enough.

## L04 · Upcoming releases are rare, and Spotify has none · degrades

**Fixture gap closed.** `tests/fixtures/musicbrainz-releases.json` now carries
two future-dated release-groups (Boy Harsher — *GET MEAN*, Tramhaus —
*Blister*) alongside all three date precisions, so the lookahead path is
covered by real recorded data.

**What remains is a product constraint, not a coverage gap.** Measured across
60 artists and 542 albums, Spotify returns **zero** future-dated releases
(decision 039) — so the lookahead is MusicBrainz-only. It is thin there too:
two upcoming release-groups across the four recorded artists, and none across
the first ten of a wider sample.

**Consequence for the feed:** the upcoming section will often be short or
empty. It needs an empty state that reads as *nothing announced yet* rather
than as a failure — and per the copy rule, must not imply we searched more
thoroughly than we did.

**Trigger:** when the upcoming section is designed. The data shape is known
now; what is undecided is how it looks holding two items.

## L05 · Half of all release dates carry no day · degrades

**Measured** across a 2-month window: 1,112 day-precision, 32 month-precision,
**1,238 year-only** — 52% of the corpus. A year-only release cannot be placed on
a timeline at all.

**Decided** (with the user, 2026-09-06): year-only releases are exempt from the
window rule rather than pinned to a false date, and keep
`release_date_precision` so a card can say "2026" and mean it.

**Column now exists.** `release_details.date_precision` was added by migration 1
(decision 040) and defaults to `'day'`.

**Done in the pipeline:** the release pass stores precision and admits
year-only records to the window by comparing years rather than dropping them or
widening them to a day. Verified end to end — a mutation widening year to day
fails five checks.

**Still unbuilt:** the UI treatment for an undated release. There is a real
design question here — an "announced, no date" bucket is not the same as a
dated feed item and probably should not look like one.

**Trigger:** the feed. What remains is purely how an undated release looks on
screen.

## L06 · Duplicate editions are understood but unhandled · degrades

One record appears once per format and territory — vinyl, CD, SHM-CD, digital —
each a distinct release under a shared release-group MBID. Observed in the live
window query: Rubber Soul (Super Deluxe) appeared 3×, two others 2×.

**Decided:** collapse on release-group, keep the editions as detail, and use
`total_tracks` to keep genuine deluxe editions apart from mere repressings
(Haken's *Fauna* at 9 tracks vs *Fauna (Deluxe Edition)* at 18, same day).

**Smaller than it looked.** Browsing *release-groups* collapses the editions for
free: Haken's *Fauna* and *Fauna (Deluxe Edition)* are **one release-group** in
MusicBrainz, and the recorded fixture shows a single Fauna entry. The
duplication observed earlier was at the *release* level, in the window search
this project no longer uses.

So the `total_tracks` tie-break is not needed to separate a deluxe from its
standard edition at this level. It stays relevant only if we later fetch
individual releases for format detail.

**Not yet built.** The release pass does not exist.

**Also unmeasured:** how often a single release-group spans genuinely different
records. Assumed rare; not checked.

**Trigger:** the release pass, same as L05 — the collapse rule has to exist
before rows are written, or the feed shows one record six times.

## L07 · The gig sources are unbuilt and largely unmeasured · blocks-flow

Half the product. `docs/VENUES.md` lists 58 Berlin venues as targets, and three of
those domains were already wrong when the list was written.

What is known: Resident Advisor's GraphQL endpoint answers 200 while its HTML
pages return 403, so the API is the way in. Greyzone serves plain HTML with no
structured data at all, making it the most fragile crawler in the plan and the
one whose fixture matters most.

What is **not** known: whether Ticketmaster's Berlin coverage is any good, what
Eventim's undocumented endpoint actually returns, or how often venue names
differ enough between sources to need their own alias matching (`src/matcher/`
handles artists, not venues).

**Trigger:** after releases work end to end. Two half-finished halves is worse
than one working one.

## L08 · Nothing schedules anything · blocks-flow

Every job runs by hand from the CLI. The artifact is `docker compose up` doing
this on its own; today it does nothing on its own.

**Trigger:** once releases land, because a radar nobody triggers is not a radar.

## L11 · MusicBrainz itself sometimes holds a record twice · cosmetic

The release pass dedupes on release-group MBID, which is the right key — but
MusicBrainz occasionally files one record under **two release-groups**. Seen on
the first live sweep:

```
78ac8b67…  ENERGY  2026-07-17  Single  Gordo + WhoMadeWho
a7af6ebe…  ENERGY  2026-07-17  Single  Gordo + WhoMadeWho
```

Identical title, date, type and artist credit. Two ids, so two feed rows.

**Measured on the full sweep: 1 redundant row in 225 (0.4%).** The 20-artist
sample suggested 1-in-6, which would have justified fixing it immediately; the
real rate does not. Waiting for the full measurement was the right call.

**What would lift it:** a second-tier collapse on (artist, title, date) after
the MBID dedup, keeping the earliest-seen row. Cheap — a local query over rows
we already have. The risk is a genuine same-day double release by one artist,
rare but real (a split single and its parent EP, say), and at 0.4% that risk
is larger than the problem.

**Trigger:** only if the rate climbs, or if a duplicate appears somewhere it
actually reads badly — two identical cards adjacent in the feed. Not worth
pre-empting.

## L10 · The name-search fallback ignores aliases and renames · degrades

Checking the 13 artists the run reported as having no MusicBrainz record, at
least 3 of them **are** in MusicBrainz and the query simply could not reach
them:

| Roster name | MusicBrainz name | Why missed |
|---|---|---|
| Thee Oh Sees | Osees | the band renamed; MB stores the current name |
| SKIADARESES | Σκιαδαρέσες | Greek script; carries the alias "Skiadareses" |
| Heimerinoi Kolymvites | Χειμερινοί Κολυμβητές | Greek script, transliterated on Spotify |

The fallback runs `artist:"<name>"`, an exact-phrase match against the primary
name. It does not search the `alias` field, so an artist stored under its
original script or a former name is invisible even when MusicBrainz has an
alias saying exactly that.

**Measured honestly:** of those 13, **2 are genuinely absent** (Hidden Pillars,
Spectralfire — no hits under any query), 3 are confirmed misses as above, and 8
are unconfirmed. A loose search returned score-100 hits for those 8, but
MusicBrainz's score is relevance, not name equality — "Herr Rosen" ~ "Dale Herr"
is a different act, not a rename. So: at least 2 truly absent, at most 10.

**What would lift it:** query `alias:"<name>"` alongside `artist:"<name>"`, and
apply the project's own normalisation to the query rather than sending the raw
Spotify string. Decision 009 already built two normalisation keys for exactly
this class of problem; they are not wired into the MusicBrainz query.

**Trigger:** alongside L01's auto-accept work — both change how the fallback
tier behaves, and doing them together means one re-run of the roster rather than
two.

---

## L12 · Nothing plays, and no release links to its own album · degrades

**Measured.** `release_details.spotify_album_id` exists and is never written:
`src/adapters/musicbrainz.ts` hardcodes `spotifyAlbumId: null`, because releases
come from MusicBrainz release-groups and MusicBrainz does not carry a Spotify
album id. So both list pages link the **artist**, not the record — you land on
the artist page and find the album yourself.

**What an embed would cost, verified 2026-09-19 with tokenless requests:**

- `GET https://open.spotify.com/embed/album/{id}` returns **200 with no token,
  no registered app and no OAuth** — measured, as does the iFrame API script at
  `/embed/iframe-api/v1`. The embed appears to sit **outside** the 5-allowlisted-
  user ceiling that constrains every Web API call in this project.
- **Thin intel, flagged:** there is no official statement that embeds are exempt
  from quota modes. The [quota modes page](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
  simply never mentions embeds. The conclusion rests on that silence plus the
  measured tokenless 200s, so it is the same risk category as the undocumented
  Eventim endpoint: fine for a personal instance, not a guarantee.
- Anonymous playback is a **preview clip, not the record**: the embed HTML ships
  `"isAnonymous":true` and an `audioPreview` MP3_96 URL, measured at 325,067
  bytes ≈ 27s. Full tracks need that browser logged into Spotify with Premium.
  The owner already needs Premium for the app to work at all, so on a personal
  instance this is mostly moot — but copy must never promise full playback.
- **Premium is no longer detectable.** The Feb 2026 migration removed `product`
  from `GET /me`, so no UI may be gated on it, ever.
- oEmbed's returned HTML carries `border-radius: 12px`, so the iframe has to be
  hand-built to satisfy the zero-radius rule.

**What would lift it:** a resolve pass matching MusicBrainz release-groups to
Spotify albums via `GET /search?type=album`, which survived the Feb 2026
migration — but with `limit` cut from 50 to 10, so disambiguation has a smaller
candidate pool than the artist matcher enjoys. That pass has the same
false-match risk the artist matcher has, and would need its own eval set before
a wrong album link could be trusted on a page. Then the iframe, with
`allow="encrypted-media"` or every viewer is forced to previews.

**Trigger:** when the playlist is in daily use and the artist link is the thing
that slows a listen down. Deliberately after the lists, so the matching risk
lands on a screen that already works.

---

## L13 · Liked artists have no picture, and the one free source is discarded · cosmetic

**Measured.** Of 1,408 liked artists, 935 have no Spotify image: `/me/tracks`
nests only id and name, and the batch artist endpoint is gone (see
`docs/SPOTIFY.md`). MusicBrainz carries an `image` URL relation pointing at
Wikimedia Commons, which has a free thumbnail API — verified end to end with
Pink Floyd. `src/jobs/resolve.ts` drops it: `KEPT_LINK_KINDS` does not include
`image`. Counts are from the `liked-songs-list` handover, before the full
resolve pass of 2026-09-20; not re-measured since.

**What would lift it:** keep the `image` relation in resolve, then a checkpointed
thumbnail pass against Commons, stamped per artist like the cover pass so a
missing image is asked once. Needs a resolve re-run to backfill.

**Trigger:** when artist pictures appear anywhere in the UI. Today type carries
the hierarchy and no screen shows an artist image, which is why this is
cosmetic.

---

## Deliberately not limits

Things that look like gaps and are not, so nobody "fixes" them:

- **Spotify is not the release source.** Not an oversight — its album endpoint
  is quota-limited to a 24-hour lockout (decision 032). Do not retry this.
- **The MusicBrainz window search is not used.** Fast but drops ~22% of rows per
  sweep, differently each run (decision 033). Browse is slower and correct.
- **Name search never auto-accepts an MBID.** The two WITCHes are why
  (decision 034). Any change here needs to beat that case first.
- **Five allowlisted Spotify users, owner needs Premium.** A platform ceiling,
  not a bug. Self-hosting is the answer, per *The Spotify ceiling* in
  `CLAUDE.md`.
