# Bandelion

A self-hosted music radar. It takes the artists you follow on Spotify and tells
you what is actually happening with them: new releases, announced releases, gigs
in your city, videos, reviews. One feed, filterable.

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
3. Redirect URI: `http://localhost:3000/api/auth/callback/spotify`
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

### 3. Run

```bash
docker compose up
```

Open `http://localhost:3000` and connect your Spotify account.

### 4. Wait for the first import

The first import is slow, and deliberately so. MusicBrainz — where artist IDs
and links come from — allows one request per second, so a few thousand followed
artists takes around half an hour.

You do not have to wait. The feed works as soon as the first artists land, and
fills in behind you. Progress is shown as counts. Stopping the container is
safe: the import resumes where it stopped.

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
| Spotify | followed artists, releases | official |
| MusicBrainz | canonical artist IDs, links | official |
| Ticketmaster | large-venue gigs | official |
| Eventim | German mid-size gigs | undocumented endpoint |
| Resident Advisor | club and electronic listings | undocumented endpoint |
| Promoter sites | small-venue gigs, support acts | scraped |

The last three are what make the local coverage good, and they can break without
warning. When one does, it is marked degraded and the rest of the feed carries
on. Check `/health` to see the current state of each.

---

## Documentation

| File | What it is |
|---|---|
| `CLAUDE.md` | How the project is built and why. Read first. |
| `TESTING.md` | Each test suite and the bug that caused it. |
| `PLAYBOOK.md` | Decisions worth making before writing code. |
| `.claude/skills/copy/SKILL.md` | Voice rules for user-facing text. `/copy` |

`PLAYBOOK.md` and parts of `TESTING.md` came from an earlier, different project
(an offline single-file prototype). The shapes transfer; the specifics do not.
Where they conflict with `CLAUDE.md`, `CLAUDE.md` wins.
