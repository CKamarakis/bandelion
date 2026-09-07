# Known limits

What Bandelion does not do yet, or does worse than it should.

**The point of this file is sequencing, not confession.** The goal is a working
end-to-end flow first; improvement passes come after. Something is written here
so it can be *deliberately* deferred rather than forgotten, and so the second
pass has a work queue instead of a memory test.

## How this differs from the other docs

- `DECISIONS.md` — what was decided and why. Closed questions.
- `LIMITS.md` (this file) — what the decision costs, and what would lift it.
  Open questions, deliberately parked.
- `CLAUDE.md` — the rules. Not negotiable per-phase.

A limit graduates out of this file when it is fixed, or into `DECISIONS.md`
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

## L02 · The review queue has no UI · blocks-flow (eventually)

117 artists sit in `match_queue` with `status = 'pending'` and no
screen to decide them on. The rows are correct and carry their candidates; there
is simply nowhere to look at them.

**What would lift it:** a list screen with accept/reject per row, writing the
chosen MBID through `setArtistMbid`. Small, but it is UI work with a design pass
attached, so it is not a ten-minute job.

**Trigger:** when L01's auto-accept lands, whatever remains queued is genuinely
ambiguous and needs a human. That is the moment this stops being optional.

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

## L04 · No fixture covers an upcoming release · degrades

The album fixture was recorded from six artists, none with a future-dated
release, so the two-month lookahead path — the thing you most want the app for —
is exercised by no test and appears on no screen. `tests/seed.mjs` says so out
loud rather than pretending.

The scan that would have found one died on Spotify's daily quota (decision 032)
before reaching a suitable artist.

**What would lift it:** record from an artist with a known upcoming release. The
window query already found real candidates — Blood Red Shoes, Boy Harsher, The
Ocean all have dated 2026 releases.

**Trigger:** before building the feed's upcoming section. Building that against
data that never exercises it is how the empty-state bug ships.

## L05 · Half of all release dates carry no day · degrades

**Measured** across a 2-month window: 1,112 day-precision, 32 month-precision,
**1,238 year-only** — 52% of the corpus. A year-only release cannot be placed on
a timeline at all.

**Decided** (with the user, 2026-09-06): year-only releases are exempt from the
window rule rather than pinned to a false date, and keep
`release_date_precision` so a card can say "2026" and mean it.

**Not yet built:** the column does not exist, and neither does the UI treatment
for an undated release. There is a real design question here — an "announced,
no date" bucket is not the same as a dated feed item and probably should not
look like one.

**Trigger:** the release pass. It cannot be deferred past that, because writing
dates without precision loses information that cannot be recovered later.

## L06 · Duplicate editions are understood but unhandled · degrades

One record appears once per format and territory — vinyl, CD, SHM-CD, digital —
each a distinct release under a shared release-group MBID. Observed in the live
window query: Rubber Soul (Super Deluxe) appeared 3×, two others 2×.

**Decided:** collapse on release-group, keep the editions as detail, and use
`total_tracks` to keep genuine deluxe editions apart from mere repressings
(Haken's *Fauna* at 9 tracks vs *Fauna (Deluxe Edition)* at 18, same day).

**Not yet built.** The release pass does not exist.

**Also unmeasured:** how often a single release-group spans genuinely different
records. Assumed rare; not checked.

**Trigger:** the release pass, same as L05 — the collapse rule has to exist
before rows are written, or the feed shows one record six times.

## L07 · The gig sources are unbuilt and largely unmeasured · blocks-flow

Half the product. `VENUES.md` lists 58 Berlin venues as targets, and three of
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

## L09 · The feed does not exist · blocks-flow

46 seeded releases and 302 resolved artists render nowhere. There is a connect
screen and a roster import screen, and that is the whole UI.

This is the largest single gap and the reason everything above is sequenced
before it: a feed built on incomplete ingest would be designed around the wrong
shape of data.

**Trigger:** once the release pass writes real rows. Not before — the seeded
database exists precisely so the screen can be designed against real recorded
shapes rather than invented ones.

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
