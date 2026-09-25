# Product rules

Product decisions with their reasons. Format: **a bolded claim, then why, then
what would change it.**

The behaviour each rule produces is specified in `openspec/specs/`; this file
keeps the reasoning, which a spec does not carry. Rules about gigs describe the
plan for sources not built yet, so they have no spec.

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

> **An artist link tries the desktop app and falls back to the web.**
> `SPOTIFY_LINK_TARGET` defaults to `app`: the click navigates to
> `spotify:artist:<id>`, watches for the page losing focus, and opens the web
> player in a new tab if nothing took it within 600ms. A browser cannot ask
> whether a URI scheme has a handler — that is a deliberate fingerprinting
> guard — so this is an inference, not a detection, and the copy must never
> claim otherwise. The href stays the **web** URL in both modes, because it is
> what hover, copy-link and middle-click use, and a `spotify:` href is useless
> for all three. Would change if browsers ever expose a handler check, which
> would turn the timeout into a real branch.

> **Triage accepts what it can prove; everything else is a decision.**
> A name search auto-accepts only when one candidate survives every rule in
> `src/matcher/triage.ts`: same word count, exact name after normalisation, and
> exact spelling where several acts share the name. Collaboration credits
> (`A x B`) and non-musical MusicBrainz types are removed first. Every rule
> fails toward the human, because a wrong MBID is invisible in the feed and an
> extra queued row costs one click. `docs/TRIAGE.md` carries the measurements and
> the rules that were rejected; `.claude/skills/triage/SKILL.md` is the method.
>
> **The invariant above every rule: two artists never share an MBID.** The
> roster holds two WITCHes and two Pentagrams, and MusicBrainz answers both
> spellings with the same list. Spelling is what separates them, and
> `tests/resolve.mjs` asserts it directly. Would change only for a rule that
> keeps that assertion true.

> **An ambiguous name is a decision, and the decision is kept.**
> A name search resolves without a human only through triage (the rule above);
> every other name MusicBrainz could read two ways lands in `match_queue`.
> Measured on the real roster before triage existed: 315 unresolved artists
> were **264 queued, 52 with no MusicBrainz record, 2 unreachable** — and of
> the 264, **188 had exactly one candidate at score 100 whose name was the only
> exact match**. So the queue was mostly not ambiguous; it was the absence of a
> rule, which triage (decision 044) now is. The review page exists for the
> genuinely ambiguous remainder, and every confirmation writes
> `artist_aliases`, so a name is decided once and the queue does not refill
> with it. Rejecting marks the row `rejected` rather than deleting it, because
> a deleted row is re-asked on the next sweep. Would change if the queue
> shrinks to the point where a page is more furniture than help.
>
> Every row links **both sides**: your artist on Spotify and each candidate on
> MusicBrainz. "Which of these two bands called Steak is yours" cannot be
> answered from the row itself, and a question you cannot check is answered by
> coin toss.

> **Links are best-effort and say so.**
> Artist links come from MusicBrainz URL relationships, fetched in the same call
> as MBID resolution. TikTok is poorly covered and will often be missing. The UI
> must not imply a complete profile.

