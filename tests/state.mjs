/**
 * Event flags: the playlist, the tick and the heart.
 *
 * The assertions that matter:
 *   - migration 4 adds the columns to a database that predates them
 *   - setting one flag never clears another (the bug the shape exists for)
 *   - the lists are what the flags say, and un-flagging empties them
 *   - a partial write leaves the untouched flags alone
 *   - getFeed carries the flags, so a card knows its own state
 *
 * In-memory databases throughout. Nothing here touches data/bandelion.db, and
 * nothing here calls a live API.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  migrateForTest,
  openDatabase,
  setEventFlags,
  getFlaggedEvents,
  getListCounts,
  getFeed,
  upsertArtist,
  linkExternalId,
  setArtistList,
  insertReleaseEvent,
} from '../src/db/index.ts';
import { normalizeName } from '../src/matcher/normalize.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

// --- Migration against a database that predates the flags --------------------
// Not the current schema.sql: the point is an install built before migration 4,
// which is every install that already exists.

{
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
    CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mbid TEXT UNIQUE, name TEXT NOT NULL, name_normalized TEXT NOT NULL,
      image_url TEXT, created_at TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, artist_id INTEGER, title TEXT NOT NULL,
      event_date TEXT, announced_at TEXT, source TEXT NOT NULL,
      source_event_id TEXT NOT NULL, source_url TEXT, payload_json TEXT,
      confidence REAL NOT NULL DEFAULT 1.0, first_seen_at TEXT,
      UNIQUE (source, source_event_id)
    );
    CREATE TABLE release_details (
      event_id INTEGER PRIMARY KEY, release_type TEXT NOT NULL, cover_url TEXT,
      total_tracks INTEGER, tracklist_json TEXT, spotify_album_id TEXT,
      is_upcoming INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_artists (
      user_id INTEGER NOT NULL, artist_id INTEGER NOT NULL,
      followed_at TEXT, source TEXT NOT NULL DEFAULT 'spotify',
      PRIMARY KEY (user_id, artist_id)
    );
    -- event_state as it shipped originally: favorited, seen, dismissed only.
    CREATE TABLE event_state (
      user_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
      favorited INTEGER NOT NULL DEFAULT 0,
      seen INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, event_id)
    );
    CREATE TABLE adapter_health (
      source TEXT PRIMARY KEY, last_success_at TEXT, last_failure_at TEXT,
      last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE jobs (
      name TEXT PRIMARY KEY, cursor TEXT, status TEXT, updated_at TEXT,
      items_done INTEGER NOT NULL DEFAULT 0, items_total INTEGER, last_error TEXT
    );
    CREATE TABLE artist_external_ids (
      artist_id INTEGER NOT NULL, source TEXT NOT NULL, external_id TEXT NOT NULL,
      PRIMARY KEY (source, external_id)
    );
    CREATE TABLE artist_aliases (
      artist_id INTEGER NOT NULL, alias_normalized TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual', created_at TEXT,
      PRIMARY KEY (artist_id, alias_normalized)
    );
    CREATE TABLE artist_links (
      artist_id INTEGER NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
      source TEXT NOT NULL, verified_at TEXT,
      PRIMARY KEY (artist_id, kind, url)
    );
    CREATE TABLE review_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
      raw_name TEXT NOT NULL, candidate_artist_id INTEGER, score REAL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT
    );
    CREATE TABLE oauth_tokens (
      user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      access_token TEXT NOT NULL, refresh_token TEXT, expires_at TEXT,
      scope TEXT, PRIMARY KEY (user_id, provider)
    );
    PRAGMA user_version = 3;
  `);

  // A pre-existing flagged row, to prove the migration preserves data rather
  // than starting the table over.
  db.exec(`INSERT INTO artists (name, name_normalized) VALUES ('Old Act', 'old act')`);
  db.exec(
    `INSERT INTO events (type, artist_id, title, source, source_event_id)
     VALUES ('release', 1, 'Old Record', 'musicbrainz', 'rg-old')`,
  );
  db.exec(`INSERT INTO event_state (user_id, event_id, favorited) VALUES (1, 1, 1)`);

  migrateForTest(db);

  const columns = db
    .prepare(`PRAGMA table_info(event_state)`)
    .all()
    .map((c) => c.name);
  check(columns.includes('queued'), 'migration 4 adds event_state.queued');
  check(columns.includes('listened'), 'migration 4 adds event_state.listened');

  const kept = db.prepare(`SELECT favorited, queued, listened FROM event_state`).get();
  check(kept.favorited === 1, 'an existing favorited row survives the migration');
  check(
    kept.queued === 0 && kept.listened === 0,
    'the new flags default to off on an existing row',
    `got queued=${kept.queued} listened=${kept.listened}`,
  );

  const version = db.prepare('PRAGMA user_version').get().user_version;
  check(version >= 4, 'the database reports at least version 4', `got ${version}`);
}

// --- The flags themselves ----------------------------------------------------

/** A database with one artist and one release, ready to flag. */
function seeded() {
  const db = openDatabase(':memory:');
  const artistId = upsertArtist(db, {
    name: 'Sleaford Mods',
    nameNormalized: normalizeName('Sleaford Mods'),
  });
  linkExternalId(db, artistId, 'spotify', 'sm-1');
  setArtistList(db, 1, artistId, { followed: true });
  insertReleaseEvent(db, {
    artistId,
    title: 'West End Girls',
    eventDate: '2026-09-14',
    datePrecision: 'day',
    releaseType: 'album',
    sourceEventId: 'rg-1',
    sourceUrl: null,
    payload: null,
    isUpcoming: false,
  });
  const eventId = db.prepare('SELECT id FROM events').get().id;
  return { db, artistId, eventId };
}

{
  const { db, eventId } = seeded();

  // Nothing flagged: no state row exists at all, which must read as "off"
  // rather than as missing data.
  check(getFlaggedEvents(db, 1, 'queued').length === 0, 'the playlist starts empty');
  check(getFlaggedEvents(db, 1, 'favorited').length === 0, 'favs starts empty');
  const fresh = getFeed(db, { type: 'release', userId: 1 })[0];
  check(
    fresh.queued === false && fresh.listened === false && fresh.favorited === false,
    'a feed row with no state row reports every flag off',
    `got ${JSON.stringify({ q: fresh.queued, l: fresh.listened, f: fresh.favorited })}`,
  );

  // Saving from the feed.
  setEventFlags(db, 1, eventId, { queued: true });
  const queued = getFlaggedEvents(db, 1, 'queued');
  check(queued.length === 1, 'saving puts the release on the playlist');
  check(queued[0].title === 'West End Girls', 'the saved row is the right release');
  check(
    queued[0].spotifyArtistId === 'sm-1',
    'the saved row carries the Spotify artist id, for the link out',
  );
  check(queued[0].releaseType === 'album', 'the saved row carries its release type');
  check(
    getFlaggedEvents(db, 1, 'favorited').length === 0,
    'saving to the playlist does not heart it',
  );

  // The tick and the heart, set one at a time as the UI sets them.
  setEventFlags(db, 1, eventId, { listened: true });
  setEventFlags(db, 1, eventId, { favorited: true });

  /*
   * Straight from the row, for the same reason as the un-hearting check below:
   * a clobbering write zeroes `queued`, and a playlist lookup would then fail
   * by finding no row rather than by naming the flag that was lost.
   */
  const both = db
    .prepare('SELECT queued, listened, favorited FROM event_state WHERE event_id = ?')
    .get(eventId);
  check(
    both.queued === 1 && both.listened === 1 && both.favorited === 1,
    'all three flags can be on at once: a later write does not clear an earlier one',
    `got ${JSON.stringify(both)}`,
  );
  check(
    getFlaggedEvents(db, 1, 'favorited').length === 1,
    'hearting puts it in favs',
  );
  check(
    getFlaggedEvents(db, 1, 'queued').length === 1,
    'hearting leaves it on the playlist: the lists overlap, they are not a pipeline',
  );

  /*
   * The bug this shape exists to prevent. A read-modify-write, or an upsert
   * writing all three columns, would clear the tick here.
   */
  setEventFlags(db, 1, eventId, { favorited: false });
  /*
   * Read the row directly rather than through getFlaggedEvents.
   *
   * A write that clobbers the other columns sets queued to 0, which drops the
   * row off the playlist entirely — so a list-based assertion fails by crashing
   * on an absent row instead of reporting which flag was lost. Verified by
   * breaking setEventFlags deliberately: this reports the cleared tick, the
   * list lookup reported a TypeError.
   */
  const state = db
    .prepare('SELECT queued, listened, favorited FROM event_state WHERE event_id = ?')
    .get(eventId);
  check(
    state.listened === 1,
    'un-hearting does not clear the listened tick',
    `got ${JSON.stringify(state)}`,
  );
  check(
    state.queued === 1,
    'un-hearting does not take it off the playlist',
    `got ${JSON.stringify(state)}`,
  );
  check(getFlaggedEvents(db, 1, 'favorited').length === 0, 'un-hearting empties favs');

  // And the other direction: un-ticking must not un-save.
  setEventFlags(db, 1, eventId, { listened: false });
  const unticked = getFlaggedEvents(db, 1, 'queued')[0];
  check(unticked.queued === true, 'un-ticking does not take it off the playlist');

  // Removing from the playlist.
  setEventFlags(db, 1, eventId, { queued: false });
  check(getFlaggedEvents(db, 1, 'queued').length === 0, 'un-saving empties the playlist');
}

// --- Counts, for the nav -----------------------------------------------------

{
  const { db, eventId } = seeded();
  check(
    getListCounts(db, 1).queued === 0,
    'counts start at zero, with no state row to sum',
  );

  setEventFlags(db, 1, eventId, { queued: true });
  let counts = getListCounts(db, 1);
  check(counts.queued === 1, 'the playlist count sees a saved row', `got ${counts.queued}`);
  check(counts.favorited === 0, 'the favs count is separate from the playlist count');

  setEventFlags(db, 1, eventId, { favorited: true });
  counts = getListCounts(db, 1);
  check(
    counts.queued === 1 && counts.favorited === 1,
    'one record on both lists counts once on each',
    `got ${JSON.stringify(counts)}`,
  );
}

// --- The feed carries the flags ----------------------------------------------
// Otherwise every card would have to ask the server on mount, and the stamp
// would flash off-then-on for anything already saved.

{
  const { db, eventId } = seeded();
  setEventFlags(db, 1, eventId, { queued: true, listened: true });

  const row = getFeed(db, { type: 'release', userId: 1 })[0];
  check(row.queued === true, 'a feed row reports that it is saved');
  check(row.listened === true, 'a feed row reports that it has been listened to');
  check(row.favorited === false, 'a flag that was never set reads as off');

  /*
   * Another user's flags must not leak onto this user's feed. Single-user today,
   * but the schema carries user_id and the join has to honour it — a missing
   * clause here would be invisible until the day it was not.
   */
  db.exec('INSERT OR IGNORE INTO users (id) VALUES (2)');
  setEventFlags(db, 2, eventId, { favorited: true });
  const mine = getFeed(db, { type: 'release', userId: 1 })[0];
  check(
    mine.favorited === false,
    "another user's heart does not appear on this user's feed",
  );
  check(
    getFlaggedEvents(db, 1, 'favorited').length === 0,
    "another user's heart does not appear in this user's favs",
  );
  check(
    getFlaggedEvents(db, 2, 'favorited').length === 1,
    'that other user does have it in their own favs',
  );
}

// --- "Coming" is derived from the date, not from the stored column -----------
/*
 * The bug this covers, reported from a screenshot and reproduced against the
 * real database on 2026-09-19: four releases dated 2026-09-18 still rendered as
 * COMING while eighteen others on the same date read OUT NOW. `is_upcoming` is
 * written once by the ingest and never revisited, so it is a snapshot that goes
 * stale the moment a date passes.
 */

{
  const { db } = seeded();
  const today = new Date().toISOString().slice(0, 10);

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Written the wrong way round on purpose: each row's stored flag contradicts
  // its date, which is exactly the state the real database was found in.
  const rows = [
    { id: 'rg-past', date: yesterday, stored: 1, expected: false, what: 'a past release' },
    { id: 'rg-today', date: today, stored: 1, expected: false, what: 'a release out today' },
    { id: 'rg-future', date: tomorrow, stored: 0, expected: true, what: 'a future release' },
  ];

  const { artistId } = { artistId: db.prepare('SELECT id FROM artists').get().id };
  for (const row of rows) {
    insertReleaseEvent(db, {
      artistId,
      title: row.id,
      eventDate: row.date,
      datePrecision: 'day',
      releaseType: 'album',
      sourceEventId: row.id,
      sourceUrl: null,
      payload: null,
      isUpcoming: row.stored === 1,
    });
  }

  const feed = getFeed(db, { type: 'release', userId: 1 });
  for (const row of rows) {
    const item = feed.find((f) => f.title === row.id);
    check(
      item.isUpcoming === row.expected,
      `${row.what} reads as ${row.expected ? 'coming' : 'out'}, whatever is_upcoming says`,
      `date ${row.date} vs today ${today}: stored ${row.stored}, got isUpcoming=${item.isUpcoming}`,
    );
  }

  // A release with no date cannot be coming: there is nothing to compare.
  insertReleaseEvent(db, {
    artistId,
    title: 'rg-undated',
    eventDate: null,
    datePrecision: 'year',
    releaseType: 'album',
    sourceEventId: 'rg-undated',
    sourceUrl: null,
    payload: null,
    isUpcoming: true,
  });
  const undated = getFeed(db, { type: 'release', userId: 1 }).find(
    (f) => f.title === 'rg-undated',
  );
  check(undated.isUpcoming === false, 'a release with no date is not coming');
}

// --- A write with nothing in it ----------------------------------------------

{
  const { db, eventId } = seeded();
  setEventFlags(db, 1, eventId, {});
  const rows = db.prepare('SELECT COUNT(*) AS n FROM event_state').get();
  check(
    rows.n === 0,
    'an empty flag set writes no row at all, rather than an all-zero one',
    `got ${rows.n} rows`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall event state checks passed');
