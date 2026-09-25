# The Spotify ceiling

What the Spotify Web API allows a project like this, measured rather than read.
**Verified during planning. Do not spend effort working around it.**

`README.md` explains the consequence for users (why you run your own copy);
this file is the evidence.

---

## Quota

- Development mode allows **5 allowlisted users per app**. The allowlist is on
  *your app*, not on their accounts: a non-allowlisted user can complete OAuth,
  then every API call returns **403**.
- The app owner must hold **Spotify Premium** or the app stops working.
- Extended quota mode — the only tier above 5 users — requires a registered
  business, a launched service, and **250,000+ MAU**. Individuals are not
  eligible. There is no intermediate tier and no self-serve upgrade.

**Self-hosting is the answer to this**, not a workaround for it: each person
runs their own instance with their own Spotify app, is their own owner, and is
allowlisted by default.

---

## Endpoints and fields

- `GET /artists` (batch) was **removed** in Feb 2026. Fetch individually via
  `GET /artists/{id}`. The local cache is therefore load-bearing, not an
  optimisation. `/me/following` and `/me/top/artists` survived.

  Re-verified 2026-09-17 with a live call on an allowlisted token: `/me` 200,
  `GET /artists/{id}` 200, `GET /artists?ids=` **403**. The [reference page for
  Get Several Artists](https://developer.spotify.com/documentation/web-api/reference/get-multiple-artists)
  is still published and its "Deprecated" labels sit on *fields*, not on the
  endpoint — so the docs read as though batch still works. It does not. Trust
  the 403 over the page. This is why liked artists have no images: the
  alternative is one request per artist (`docs/LIMITS.md` L13).

- Separately, `genres`, `popularity` and `followers` are **deprecated fields**
  and already return empty/null on live responses (measured the same day:
  Pitbull came back with `genres: []` and `popularity: null`). `images` is
  unaffected. `RosterEntry` still carries genres and popularity; nothing reads
  them, and nothing should start.

- **Liked Songs has no playlist id**, so `/me/tracks` is the only way in
  (spotify/web-api#1417), and
  `/me/tracks` takes no `fields` parameter. Together with the batch 403, that
  closes off three plausible optimisations for the liked-songs import.

---

## Sources

[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
[Feb 2026 migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide),
[extended access criteria](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access).
