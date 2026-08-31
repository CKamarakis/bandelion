-- Bandelion schema.
--
-- SQLite because there is one user per instance (see CLAUDE.md). Written so the
-- data layer stays swappable: no SQLite-specific types beyond the usual, and
-- every table carries user_id even though the UI is single-user today.
--
-- Dates are ISO 8601 strings ('2026-03-14' or full timestamps), never epoch
-- integers: they are read directly in a SQLite browser during debugging, and
-- half our upstream sources hand us date-only values with no time at all.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The local instance auto-uses user 1. Multi-user schema, single-user UX.
INSERT OR IGNORE INTO users (id) VALUES (1);

CREATE TABLE IF NOT EXISTS artists (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mbid             TEXT UNIQUE,          -- canonical id; NULL until resolved
  name             TEXT NOT NULL,
  name_normalized  TEXT NOT NULL,        -- see src/matcher/normalize.ts
  image_url        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artists_normalized ON artists(name_normalized);

-- One row per (artist, source). Lets us match an Eventim listing back to the
-- Spotify artist without either source knowing about the other.
CREATE TABLE IF NOT EXISTS artist_external_ids (
  artist_id    INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ext_artist ON artist_external_ids(artist_id);

-- Learned aliases. Every manual confirmation in the review queue writes here,
-- so a name is decided once and never asked about again.
CREATE TABLE IF NOT EXISTS artist_aliases (
  artist_id        INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  alias_normalized TEXT NOT NULL,
  source           TEXT NOT NULL DEFAULT 'manual',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (artist_id, alias_normalized)
);
CREATE INDEX IF NOT EXISTS idx_alias_norm ON artist_aliases(alias_normalized);

-- Links are best-effort. Absence means "we did not find one", never "none
-- exists" — the UI must not imply a complete profile.
CREATE TABLE IF NOT EXISTS artist_links (
  artist_id    INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,  -- website|instagram|bandcamp|spotify|soundcloud|tiktok|youtube
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,  -- musicbrainz|spotify|manual
  verified_at  TEXT,
  PRIMARY KEY (artist_id, kind, url)
);

CREATE TABLE IF NOT EXISTS user_artists (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id    INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  followed_at  TEXT,
  source       TEXT NOT NULL DEFAULT 'spotify',
  PRIMARY KEY (user_id, artist_id)
);

-- One events table, discriminated by type. The feed is the product; releases
-- and gigs are event kinds flowing into it.
CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  type             TEXT NOT NULL CHECK (type IN ('release','gig')),
  artist_id        INTEGER REFERENCES artists(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  event_date       TEXT,
  announced_at     TEXT,
  source           TEXT NOT NULL,
  source_event_id  TEXT NOT NULL,
  source_url       TEXT,
  payload_json     TEXT,          -- verbatim upstream record
  confidence       REAL NOT NULL DEFAULT 1.0,  -- matcher confidence, 1.0 = exact
  first_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_artist ON events(artist_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, event_date);

CREATE TABLE IF NOT EXISTS release_details (
  event_id          INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  release_type      TEXT NOT NULL,
  cover_url         TEXT,
  total_tracks      INTEGER,
  tracklist_json    TEXT,
  spotify_album_id  TEXT,
  is_upcoming       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gig_details (
  event_id          INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  venue_name        TEXT,
  venue_url         TEXT,
  city              TEXT,
  ticket_url        TEXT,
  on_sale_date      TEXT,
  -- 'unknown' is the honest default and must stay distinct from 'not_on_sale'.
  sale_status       TEXT NOT NULL DEFAULT 'unknown',
  support_acts_json TEXT,
  price_text        TEXT
);

CREATE TABLE IF NOT EXISTS event_state (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  favorited  INTEGER NOT NULL DEFAULT 0,
  seen       INTEGER NOT NULL DEFAULT 0,
  dismissed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_state_user ON event_state(user_id, dismissed);

-- Medium-confidence matches land here rather than in the feed. Confirming one
-- writes an alias, so the decision is made once.
CREATE TABLE IF NOT EXISTS match_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_name            TEXT NOT NULL,
  source              TEXT NOT NULL,
  source_url          TEXT,
  candidate_artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  score               REAL NOT NULL,
  payload_json        TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','rejected')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON match_queue(status, created_at);

-- User-visible, not just logged. An empty feed must be able to say WHY.
CREATE TABLE IF NOT EXISTS adapter_health (
  source               TEXT PRIMARY KEY,
  status               TEXT NOT NULL DEFAULT 'ok',
  last_success_at      TEXT,
  last_attempt_at      TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

-- Checkpointed jobs. The roster is thousands of artists and MusicBrainz allows
-- one request per second, so first-run resolution takes ~30 minutes. Killing
-- the container mid-ingest must resume, not restart.
CREATE TABLE IF NOT EXISTS job_state (
  job_name     TEXT PRIMARY KEY,
  cursor       TEXT,           -- opaque, job-defined resume point
  total        INTEGER,        -- for progress display; NULL when unknown
  done         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'idle'
               CHECK (status IN ('idle','running','failed','complete')),
  last_error   TEXT,
  started_at   TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TEXT,
  scope         TEXT,
  PRIMARY KEY (user_id, provider)
);
