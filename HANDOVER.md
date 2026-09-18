# Handover: the liked-songs branch

Written at the end of the session that built `liked-songs-list`. Everything
here is either a decision someone will want the reasoning for, or a trap that
cost time and will cost it again.

`CLAUDE.md` is still the place for rules. This file is state: what is done,
what is half-done, and what to do next.

---

## Where things stand

Branch `liked-songs-list`, 16 commits, pushed, `npm run verify` green.
**Not merged to `main`.**

The database on this machine holds:

| | |
|---|---|
| Artists | 1,556 (625 followed · 1,408 liked · 477 both) |
| Resolved to a MusicBrainz id | 1,241 |
| Queued for human review | 392 |
| No MusicBrainz record at all | 89 |
| Releases | 600 |
| Releases with cover art | 491 of 552 checked (89%) |

---

## What was built

**Liked songs as a second artist list.** `/me/tracks` is the only way in:
Liked Songs has no playlist id (spotify/web-api#1417), so 42 paged calls it is.
Artists are one `user_artists` row carrying `followed` and `liked` flags rather
than a row per source, because the overlap is the normal case and a row per
source would need `DISTINCT` on every feed query.

**Cover art** from the Cover Art Archive, keyed by the same MBIDs MusicBrainz
uses. `cover_checked_at` is a separate column from `cover_url` because
"no art" and "not asked yet" cannot both be null: without it every sweep would
re-request every coverless release forever at one request a second.

**The feed** is cards in a three-column grid, grouped into collapsible month
sections, paged at 100 with whole months per page, filtered by type, status,
list, month and calendar week.

**The look**: a striped ground drawn in CSS, an opaque 90% sheet over it, the
mark in the masthead, and `PALETTE.md` recording every colour with its measured
contrast.

---

## Decisions worth not relitigating

- **Flags, not rows per source.** Measured: 477 of 1,408 liked artists are also
  followed. A third list is a third flag; past four or five, a join table
  starts to earn itself.
- **Album artists are admitted only when they also perform a track you liked.**
  That drops "Various Artists" and the label or curator credited on a DJ mix,
  structurally, with no blocklist of ids to maintain. 62 of 2,081 tracks.
- **Nothing is ever removed.** No unfollow, no unlike. Neither is observable
  from a partial import, so an interrupted run would look exactly like
  unfollowing everything after the point it stopped.
- **A release without a day is in no week.** Half of MusicBrainz dates carry no
  day, and placing `2026-09` in one of its five weeks invents precision.
  Year-only releases keep their year on the card for the same reason: a blank
  where a date belongs reads as missing data rather than imprecise data.
- **Pages break once a page has reached its size, not before the next month
  would exceed it.** Breaking early gave a 30-row first page.
- **The catalogue number came off the rows.** It is still in the header and
  `catalogueNumber` still has its tests. `CLAUDE.md`'s design section was
  updated rather than quietly contradicted.

---

## Things that are true about Spotify, and were measured rather than read

- `GET /artists?ids=` (batch) returns **403** on an allowlisted token, while its
  reference page still reads as current. Re-verified with a live call. This is
  why liked artists have no images: the alternative is one request per artist.
- `genres`, `popularity` and `followers` are **already empty or null** on live
  responses, not merely deprecated. Pitbull came back with `genres: []`.
- Liked Songs has no playlist id and `/me/tracks` takes no `fields` parameter.
  Three plausible optimisations, all closed off.

---

## Traps that cost time here

- **An inline style beats a stylesheet rule regardless of order.** A `margin: 0`
  in `Feed.tsx` silently cancelled a `margin-top` in `globals.css`, and the gap
  measured 0px while both files looked correct. There is a comment in
  `globals.css` about an earlier instance of the same thing with `display`.
- **`npm run build` while the dev server is running corrupts `.next`** and the
  page renders with no CSS at all. Stop the server first.
- **A dead server can hold port 3000**, so the next one silently takes 3001 and
  screenshots capture the *old* build. Kill by port and verify the new build is
  actually serving something new before trusting a screenshot.
- **The test suite will pass while the screen is broken.** Three bugs this
  session were visible only in a screenshot: a `1556 of 625` counter, missing
  CSS, and a lost SQL join. Take the screenshot.
- **Do not use shell heredocs for anything with a regex or backticks.** It
  mangled a script here, exactly as `CLAUDE.md` warns.

---

## Next, in the order I would do it

1. **The review queue UI.** 392 artists — a quarter of the roster — are stuck
   behind a decision nobody can make, producing no releases. This is the
   highest-value thing left, and this feature is what made the queue that big.
2. **Band images.** `resolve.ts` currently *discards* the MusicBrainz `image`
   relation: `KEPT_LINK_KINDS` does not include it. That relation points at
   Wikimedia Commons, which has a free thumbnail API (verified end to end with
   Pink Floyd). It is the only image source available for the 935 liked artists
   that have no Spotify picture. Needs a resolve re-run.
3. **Merge to `main`**, once you are happy with the branch.

---

## Known, deliberate, and recorded

- **`--spotify-green` as text on "This Week" measures 1.54:1.** Every automated
  threshold rejects it. It ships because it was checked on the real screen and
  is legible there. The fallback, if it ever reads as invisible elsewhere, is a
  filled block with black type at 10.94:1 — the same treatment the connect
  button uses. The stylesheet says so at the rule.
- **`releases.mjs` failed once mid-run** and passed alone and on re-run, while
  the covers job was writing to the same SQLite file. Probably WAL contention,
  not a logic bug — but that is a guess, not a finding, and it has not
  recurred.
