# Bandelion

A self-hosted music radar. It takes the artists you follow on Spotify — and the
artists behind your liked songs — and tells you what is actually happening with
them: new releases, announced releases, gigs in your city, videos, reviews. One
feed, filterable.

Band + dandelion. Seeds scattering.

---

## Why you have to run your own copy

In February 2026 Spotify closed its API to everyone except large businesses.
An app in development mode is capped at **5 authorised users**, and the only
tier above that requires a registered company with **250,000 monthly active
users**. There is no step in between and no self-serve upgrade.

So there is no hosted Bandelion for you to sign up to. Instead you run your own
instance with your own Spotify app, where you are the owner and authorised by
default. Setup takes about five minutes.

This is Spotify's constraint, not ours.

---

## Setup

**You need:** Docker, and a Spotify account with **Premium** (Spotify requires
the app owner to have it, or the API stops responding).

### 1. Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in.
2. **Create app**. Name and description can be anything.
3. Redirect URI: `http://127.0.0.1:3000/api/auth/callback/spotify`
   — the loopback IP, not `localhost`. Spotify rejects `localhost` outright, and
   it matches the URI byte for byte, so a mismatch fails at the callback.
4. Under APIs used, tick **Web API**.
5. Save, then open **Settings** to find your **Client ID** and **Client secret**.

### 2. Configure

```bash
cp .env.example .env
```

Fill in:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
BANDELION_CITY=Berlin
```

Everything else has a working default. The one worth knowing about:

**`SPOTIFY_LINK_TARGET`** — where an artist link goes. `app`, the default,
hands the link to the Spotify desktop app and falls back to the web player when
nothing takes it. A browser cannot ask whether an app is installed, so that
fallback is a short wait rather than a check; set this to `web` if you have no
desktop app and would rather skip it.

### 3. Run

```bash
docker compose up
```

Open `http://127.0.0.1:3000` and connect your Spotify account.

### 4. Import your artists

Two lists, imported separately:

```bash
npm run ingest          # artists you follow
npm run ingest liked    # artists behind your liked songs
```

Both are fast — reading 2,000 liked songs takes about ten seconds. What takes
time is the step after: every artist needs a MusicBrainz ID before its releases
can be fetched, and MusicBrainz allows one request per second.

```bash
npm run ingest resolve  # artist identities. The slow one.
npm run ingest releases # then the actual releases
```

**How slow:** measured on a real library, a 625-artist followed roster resolves
in a bit over an hour. A 1,400-artist liked list took about twelve, because
obscure artists fall through to a name search rather than an exact ID match.
Run it overnight. `npm run ingest resolve 60` does a bounded sample first if you
want to see the hit rate before committing.

You do not have to wait for any of it. The feed works as soon as the first
releases land and fills in behind you. Stopping is safe: every job checkpoints
and resumes where it stopped.

### 5. Decide the ambiguous names

Resolution never guesses. Most artists are matched automatically, but when
several MusicBrainz acts genuinely share a name the artist goes to a queue
rather than being matched, and an artist without a MusicBrainz ID produces no
releases.

Open **Review** in the nav. Each row links your artist on Spotify and every
MusicBrainz candidate with its description, so you can check before deciding.
Picking one records it, so the same name is not asked about twice.

Measured on a real 1,556-artist library: 264 artists reached the queue, and the
triage rules in `docs/TRIAGE.md` decide about 200 of them without asking. What is
left is the real thing — two bands called Steak, five called Spindrift.

An artist with no MusicBrainz entry stays unresolved and that is expected:
small acts, one-off collaborations and DJ aliases are often genuinely not in
the database.

---

## The two lists

Following an artist on Spotify is a deliberate act. Liking a song is a smaller
one, and there are usually far more of them — so the two are kept apart rather
than merged into one roster.

- **Followed** — artists from `/me/following`.
- **Liked songs** — every artist credited on a track you saved, including
  collaborators and featured guests.

They overlap heavily. On a real library, 477 of 1,408 liked artists were also
followed, so an artist is one entry carrying both marks rather than two rows.
The feed's **From** filter switches between *All artists*, *Followed* and
*Liked songs*, and a release shows a **From liked songs** mark only when you do
not also follow that artist — the reason an unfamiliar name is in your feed.

What gets skipped: an album credited to someone who performs nothing you liked.
"Various Artists" on a compilation, a label or a curator on a DJ mix. They are
not acts, so they do not become artists. The import reports how many it skipped
rather than dropping them quietly.

Liked artists have no images. `/me/tracks` gives an artist's name and ID but no
picture, and the batch endpoint that could fetch 50 at a time now returns 403
despite its documentation page still reading as current. One request per artist
is the remaining option, and that is not worth an avatar.

---

## Adding other people

Up to four more, and each has to be authorised by you:

Spotify dashboard → your app → **Settings** → **User Management** → add their
name and Spotify account email.

Someone not on that list can still log in, but every request returns 403 and
they see an app that loads nothing. Five is the ceiling, including you.

---

## Where the data comes from

| Source | What it gives | Status |
|---|---|---|
| Spotify | followed artists, liked-song artists | official |
| MusicBrainz | canonical artist IDs, links, releases | official |
| Ticketmaster | large-venue gigs | **not built yet** |
| Eventim | German mid-size gigs | **not built yet** — undocumented endpoint |
| Resident Advisor | club and electronic listings | **not built yet** — undocumented endpoint |
| Promoter sites | small-venue gigs, support acts | **not built yet** — scraped |

Releases work today. **Gigs do not exist yet** — the four sources above are
planned, not shipped, and nothing in the feed is a concert listing.

When they arrive, the last three are what will make local coverage good, and
they can break without warning: each one is an undocumented endpoint or a
scrape. A broken source is recorded as degraded and the rest of the feed carries
on, rather than the whole feed emptying.

---

## What does not work yet

Honest list, because finding these yourself is worse.

- **No gigs.** Releases only. The gig sources in the table above are planned.
- **Ambiguous names are decided by hand.** Resolution never guesses, so when
  MusicBrainz has several acts under one name the artist waits in the Review
  screen until you pick. Triage accepts only the names it can prove: on a real
  1,556-artist library, 264 artists had reached the queue, and a re-run with
  triage resolved 203 and left 71 for you (`docs/TRIAGE.md`).
- **No unfollow or unlike.** Nothing is ever removed. Neither is observable from
  a partial import, so an interrupted run would look identical to unfollowing
  everything after the point it stopped.
- **Liked artists have no images**, as above.

`docs/LIMITS.md` tracks the full list and what would lift each one.

---

## Documentation

| File | What it is |
|---|---|
| `CLAUDE.md` | How the project is built: commands, architecture, constraints. Read first. |
| `openspec/specs/` | What the system does, one spec per capability. The source of truth for behaviour. |
| `openspec/changes/` | Work in flight. The roadmap is whatever is in here. |
| `docs/PRODUCT.md` | The product rules, each with why and what would change it. |
| `docs/DECISIONS.md` | A running log of what was decided while building, and why. History. |
| `docs/LIMITS.md` | What is deferred, and what would lift each limit. |
| `docs/DESIGN.md` | The look, the rules, and every colour with its measured contrast. |
| `docs/SPOTIFY.md` | What the Spotify API allows, measured, with sources. |
| `docs/TESTING.md` | Each test suite, the bug that caused it, and the traps. |
| `docs/TRIAGE.md` | How an artist gets a MusicBrainz identity, and the measurements behind each rule. |
| `docs/VENUES.md` | The Berlin venues the gig sources will target. |
| `.claude/skills/copy/SKILL.md` | Voice rules for user-facing text. `/copy` |
| `.claude/skills/triage/SKILL.md` | How to change the artist-matching rules safely. `/triage` |

Parts of `docs/TESTING.md` came from an earlier, different project (an offline
single-file prototype). The shapes transfer; the specifics do not. Where they
conflict with `CLAUDE.md` or a spec, those win.
