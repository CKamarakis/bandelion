/**
 * Database access.
 *
 * Uses `node:sqlite`, built into Node 22.5+, rather than better-sqlite3.
 *
 * Why: better-sqlite3 is a native module and needs a C++ toolchain, which it
 * did not find on this machine and would not find on many self-hosters'. The
 * built-in has the same synchronous shape, no compile step, and one fewer
 * dependency — which also keeps the Docker image small. Synchronous is right
 * here regardless: every query is local, sub-millisecond, and single-user.
 *
 * Queries live in this file rather than scattered through routes, so the data
 * layer stays portable if this ever moves to Postgres.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DB = DatabaseSync;

let instance: DB | null = null;

/**
 * Locate schema.sql.
 *
 * `import.meta.dirname` is undefined once Next bundles this module, so a plain
 * join against it throws only inside the app and never in the suites, which run
 * the source directly under Node. Resolving from cwd is the fallback that
 * works in both: the server always starts at the project root.
 */
function schemaPath(): string {
  const here = import.meta.dirname;
  return here ? join(here, 'schema.sql') : join(process.cwd(), 'src', 'db', 'schema.sql');
}

/**
 * Schema changes that must reach a database which already exists.
 *
 * `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so it builds a new database
 * correctly and does nothing at all to an old one. Adding a column there alone
 * means it appears for new installs and is silently missing for everyone with
 * data — which, for a self-hosted app, is everyone who has been using it.
 *
 * Tracked with `PRAGMA user_version`, SQLite's built-in integer, so there is no
 * migrations table to keep in step. Append only: each entry runs once, in
 * order, and the version becomes the array length.
 *
 * Every statement must be safe to run against a database that has already been
 * built fresh from `schema.sql`, because a new install runs both.
 */
const MIGRATIONS: { id: number; describe: string; sql: string[] }[] = [
  {
    id: 1,
    describe: 'release date precision, and when an artist was last checked',
    sql: [
      /*
       * Half of all MusicBrainz release dates carry no day (measured: 1,238 of
       * 2,382 in a 2-month window are year-only). Storing "2027" as
       * "2027-12-31" would make a guess indistinguishable from a real date, so
       * the precision travels with the date and the UI can say "2027".
       */
      `ALTER TABLE release_details ADD COLUMN date_precision TEXT NOT NULL DEFAULT 'day'`,
      // Tiered polling needs to know when an artist was last looked at, so a
      // sweep can skip the ones checked recently rather than redoing all 625.
      `ALTER TABLE artists ADD COLUMN last_release_check_at TEXT`,
    ],
  },
  {
    id: 2,
    describe: 'per-list flags on user_artists, so one artist can be in both',
    sql: [
      /*
       * Liked Songs is a second list of artists, and an artist can be in both.
       * The old single `source` column could not say so: `INSERT OR IGNORE`
       * against PK (user_id, artist_id) keeps whichever list arrived first and
       * silently discards the second — for 477 of 1,408 artists, measured.
       *
       * Flags rather than a wider primary key: widening it means a full table
       * rebuild (SQLite cannot alter a PK in place), and it would put one row
       * per source in a table every feed query joins, so each of those queries
       * would need DISTINCT or start double-counting. Two columns and an index
       * do the same work additively.
       */
      `ALTER TABLE user_artists ADD COLUMN followed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE user_artists ADD COLUMN liked INTEGER NOT NULL DEFAULT 0`,
      // Every existing row came from the roster import, which is the only
      // writer that has ever run. Backfill rather than assume a default: the
      // flags must describe the rows that are already there.
      `UPDATE user_artists SET followed = 1 WHERE source = 'spotify'`,
      `CREATE INDEX IF NOT EXISTS idx_user_artists_lists ON user_artists(user_id, followed, liked)`,
    ],
  },
  {
    id: 3,
    describe: 'when a release was checked for cover art',
    sql: [
      /*
       * `cover_url IS NULL` cannot mean "no art" and "not looked yet" at once.
       *
       * Most of a back catalogue has no cover in the archive, so without this
       * stamp every sweep would re-request every coverless release forever, at
       * one request a second. The timestamp separates a checked absence from
       * an unchecked one, exactly as `last_release_check_at` does for artists.
       */
      `ALTER TABLE release_details ADD COLUMN cover_checked_at TEXT`,
    ],
  },
  {
    id: 4,
    describe: 'the playlist and listened flags on event_state',
    sql: [
      /*
       * Two more flags, so the feed can be read once and worked through later.
       *
       * `favorited` was already in schema.sql and unused; these join it rather
       * than replacing it, because the three are independent answers and not
       * stages of one. Hearting a record does not take it off the playlist —
       * that was a product decision (see CLAUDE.md) and it is why this is three
       * booleans on one row rather than a single `state` column holding one of
       * 'queued' | 'listened' | 'liked'. A state machine here would make
       * "listened but did not like it" unrepresentable, which is the most
       * common outcome of actually using the list.
       */
      `ALTER TABLE event_state ADD COLUMN queued INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE event_state ADD COLUMN listened INTEGER NOT NULL DEFAULT 0`,
      /*
       * One index per list page, each covering the flag it filters on.
       *
       * Not one index on (user_id, queued, favorited): the playlist filters on
       * queued and the favs page on favorited, and a composite would only help
       * whichever came first. No rows exist yet — nothing has ever written to
       * this table — so there is nothing to backfill, unlike migration 2.
       */
      `CREATE INDEX IF NOT EXISTS idx_state_queued ON event_state(user_id, queued)`,
      `CREATE INDEX IF NOT EXISTS idx_state_favorited ON event_state(user_id, favorited)`,
    ],
  },
];

/** Bring an existing database up to the current schema version. */
function migrate(db: DB): void {
  const current = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version ?? 0,
  );

  for (const migration of MIGRATIONS) {
    if (migration.id <= current) continue;
    for (const statement of migration.sql) {
      try {
        db.exec(statement);
      } catch (err) {
        const message = String(err);
        /*
         * Two survivable cases, both meaning "the schema already says this":
         *
         *  - duplicate column: a fresh database built from schema.sql already
         *    has it, and a new install runs both.
         *  - no such table: the statement targets a table this database does
         *    not have. openDatabase always runs schema.sql first so production
         *    never sees it, but a caller migrating a partial database should
         *    get a skipped statement rather than a crash on startup.
         *
         * Anything else is a real failure and must not be swallowed.
         */
        const benign =
          /duplicate column name/i.test(message) || /no such table/i.test(message);
        if (!benign) throw err;
      }
    }
    db.exec(`PRAGMA user_version = ${migration.id}`);
  }
}

/**
 * Exported only so a test can drive a migration against a database built the
 * old way. Production code goes through `openDatabase`, which calls it.
 */
export const migrateForTest = migrate;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // WAL so the scheduler can write while the UI reads.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(readFileSync(schemaPath(), 'utf8'));
  // After the schema, so a new database gets its tables first and then simply
  // records that it is already at the current version.
  migrate(db);

  return db;
}

/** Process-wide handle. Tests open their own instead of using this. */
export function getDatabase(path: string): DB {
  if (!instance) instance = openDatabase(path);
  return instance;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

// ─── Artists ────────────────────────────────────────────────────────────────

export interface ArtistRow {
  id: number;
  mbid: string | null;
  name: string;
  name_normalized: string;
  image_url: string | null;
}

/**
 * Insert or return an existing artist.
 *
 * Matching on normalised name rather than raw: "The Notwist" and "Notwist"
 * arriving from two sources must not create two rows. MBID is filled in later
 * by the resolution job, so it cannot be the identity key at insert time.
 */
export function upsertArtist(
  db: DB,
  artist: {
    name: string;
    nameNormalized: string;
    mbid?: string | null;
    imageUrl?: string | null;
    /**
     * The source's own id for this artist, when it has one.
     *
     * Supplying it is what keeps two different acts with the same name apart.
     * Found the hard way: a real roster of 625 followed artists produced 623
     * rows, because WITCH (Zambian zamrock) and Witch (American doom) share a
     * normalised name, as do the two Pentagrams. Name matching silently merged
     * them, which is worse than an error: the roster was simply short.
     */
    externalId?: { source: string; id: string };
  },
): number {
  /*
   * An id from the source beats a name match.
   *
   * Name matching is still right for the cross-source case it exists for
   * ("The Notwist" from MusicBrainz and "Notwist" from Eventim are one act).
   * But when a source hands us an id it is making a stronger claim than a
   * string similarity can, in both directions: same id means same artist, and
   * a different id for the same name means genuinely different artists.
   */
  if (artist.externalId) {
    const byExternal = db
      .prepare(
        `SELECT artist_id AS id FROM artist_external_ids
          WHERE source = ? AND external_id = ?`,
      )
      .get(artist.externalId.source, artist.externalId.id) as { id: number } | undefined;

    if (byExternal) {
      backfill(db, byExternal.id, artist);
      return byExternal.id;
    }

    // No row for this id yet. If a same-named artist exists but already carries
    // a DIFFERENT id from this source, they are two acts sharing a name, so
    // this one needs its own row.
    const sameName = db
      .prepare(
        `SELECT a.id,
                (SELECT COUNT(*) FROM artist_external_ids e
                  WHERE e.artist_id = a.id AND e.source = ?) AS ids
           FROM artists a
          WHERE a.name_normalized = ?
          ORDER BY ids ASC`,
      )
      .all(artist.externalId.source, artist.nameNormalized) as { id: number; ids: number }[];

    // Prefer a same-named artist that has no id from this source: that is the
    // one this id belongs to. If every candidate already has one, this is a new
    // artist that happens to share the name.
    const unclaimed = sameName.find((row) => row.ids === 0);
    if (unclaimed) {
      backfill(db, unclaimed.id, artist);
      linkExternalId(db, unclaimed.id, artist.externalId.source, artist.externalId.id);
      return unclaimed.id;
    }

    const created = insertArtist(db, artist);
    linkExternalId(db, created, artist.externalId.source, artist.externalId.id);
    return created;
  }

  const existing = db
    .prepare('SELECT id FROM artists WHERE name_normalized = ?')
    .get(artist.nameNormalized) as { id: number } | undefined;

  if (existing) {
    backfill(db, existing.id, artist);
    return existing.id;
  }

  return insertArtist(db, artist);
}

/** Fill in fields a later source knew and an earlier one did not. */
function backfill(
  db: DB,
  artistId: number,
  artist: { mbid?: string | null; imageUrl?: string | null },
): void {
  if (!artist.mbid && !artist.imageUrl) return;
  // COALESCE so a poorer source cannot erase a value a richer one supplied.
  db.prepare(
    `UPDATE artists
        SET mbid = COALESCE(mbid, ?),
            image_url = COALESCE(image_url, ?)
      WHERE id = ?`,
  ).run(artist.mbid ?? null, artist.imageUrl ?? null, artistId);
}

function insertArtist(
  db: DB,
  artist: { name: string; nameNormalized: string; mbid?: string | null; imageUrl?: string | null },
): number {
  const r = db
    .prepare(
      `INSERT INTO artists (mbid, name, name_normalized, image_url)
       VALUES (?, ?, ?, ?)`,
    )
    .run(artist.mbid ?? null, artist.name, artist.nameNormalized, artist.imageUrl ?? null);

  return Number(r.lastInsertRowid);
}

export function linkExternalId(
  db: DB,
  artistId: number,
  source: string,
  externalId: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO artist_external_ids (artist_id, source, external_id)
     VALUES (?, ?, ?)`,
  ).run(artistId, source, externalId);
}

/**
 * Put an artist on a list, without taking them off any other.
 *
 * The `OR` in the upsert is the whole point: the liked import must not clear
 * `followed`, and a later roster import must not clear `liked`. Written as a
 * plain INSERT OR IGNORE it silently keeps whichever list ran first — which is
 * the bug this table's flags exist to fix, so it would be an easy one to
 * reintroduce.
 *
 * Never unsets. Leaving a list is not observable from a partial import, for
 * the same reason `roster.ts` never deletes: an interrupted run would look
 * exactly like an unfollow. Whatever handles that has to see a complete list
 * first.
 */
export function setArtistList(
  db: DB,
  userId: number,
  artistId: number,
  lists: { followed?: boolean; liked?: boolean },
): void {
  const followed = lists.followed ? 1 : 0;
  const liked = lists.liked ? 1 : 0;
  // `source` records which list introduced the artist; ON CONFLICT leaves it.
  const source = lists.followed ? 'spotify' : 'liked';

  db.prepare(
    `INSERT INTO user_artists (user_id, artist_id, followed_at, source, followed, liked)
     VALUES (?, ?, datetime('now'), ?, ?, ?)
     ON CONFLICT (user_id, artist_id) DO UPDATE SET
       followed = MAX(user_artists.followed, excluded.followed),
       liked    = MAX(user_artists.liked,    excluded.liked)`,
  ).run(userId, artistId, source, followed, liked);
}

/** The roster import's entry point. Kept so its call sites read unchanged. */
export function followArtist(db: DB, userId: number, artistId: number, source = 'spotify'): void {
  if (source !== 'spotify') throw new Error(`unknown roster source: ${source}`);
  setArtistList(db, userId, artistId, { followed: true });
}

export interface FeedItem {
  eventId: number;
  artistId: number;
  artist: string;
  title: string;
  /** May be partial: '2027', '2027-03' or '2027-03-14'. */
  eventDate: string | null;
  datePrecision: 'day' | 'month' | 'year';
  releaseType: string;
  isUpcoming: boolean;
  sourceUrl: string | null;
  firstSeenAt: string;
  /** Which list this artist is on. Both can be true; see user_artists. */
  followed: boolean;
  liked: boolean;
  /** Sleeve art, when the Cover Art Archive had any. Usually null. */
  coverUrl: string | null;
  /**
   * The artist's own Spotify id, for linking out. Nullable by type because an
   * artist matched by name from a future source may not have one, even though
   * every artist in the database today does.
   */
  spotifyArtistId: string | null;
  /** On the playlist: saved from the feed to hear later. */
  queued: boolean;
  /** Played. Independent of `favorited` — see event_state. */
  listened: boolean;
  /** Liked, after hearing it. Stays on the playlist as well. */
  favorited: boolean;
}

/** The flags a user can set on an event. One column each; see event_state. */
export interface EventFlags {
  queued?: boolean;
  listened?: boolean;
  favorited?: boolean;
}

/**
 * Set one or more flags on an event, creating the state row if needed.
 *
 * UPSERT rather than a read-modify-write: the row usually does not exist yet,
 * and the first thing anyone does to a release is toggle one flag on it. Only
 * the keys present in `flags` are written, so toggling the heart cannot clear
 * the tick — the bug this shape exists to prevent.
 */
export function setEventFlags(
  db: DB,
  userId: number,
  eventId: number,
  flags: EventFlags,
): void {
  const columns: string[] = [];
  const values: number[] = [];

  // Whitelisted, not iterated from the caller's keys: these names are
  // interpolated into SQL, so the set of legal ones is closed here rather than
  // trusted from a request body.
  for (const name of ['queued', 'listened', 'favorited'] as const) {
    const value = flags[name];
    if (value === undefined) continue;
    columns.push(name);
    values.push(value ? 1 : 0);
  }

  if (columns.length === 0) return;

  const assignments = columns.map((c) => `${c} = excluded.${c}`).join(', ');

  db.prepare(
    `INSERT INTO event_state (user_id, event_id, ${columns.join(', ')})
          VALUES (?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT (user_id, event_id)
       DO UPDATE SET ${assignments}, updated_at = datetime('now')`,
  ).run(userId, eventId, ...values);
}

/**
 * The saved lists: what is on the playlist, or what has been hearted.
 *
 * An INNER JOIN on event_state, unlike getFeed's LEFT JOIN: a row with no state
 * row has never been flagged, so it belongs on neither list. Ordered by when
 * the flag was set, newest first — the playlist is a thing you add to and work
 * through, so the order that matters is the order you saved them, not the
 * release dates the feed sorts by.
 */
export function getFlaggedEvents(
  db: DB,
  userId: number,
  flag: 'queued' | 'favorited',
): FeedItem[] {
  // Interpolated, but `flag` is a union of two literals rather than a string
  // from a request: there is no path from user input to this line.
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.artist_id AS artistId, a.name AS artist,
              e.title, e.event_date AS eventDate, e.source_url AS sourceUrl,
              e.first_seen_at AS firstSeenAt,
              rd.release_type AS releaseType,
              rd.date_precision AS datePrecision,
              rd.is_upcoming AS isUpcoming,
              rd.cover_url AS coverUrl,
              (SELECT external_id FROM artist_external_ids
                WHERE artist_id = e.artist_id AND source = 'spotify') AS spotifyArtistId,
              COALESCE(ua.followed, 0) AS followed,
              COALESCE(ua.liked, 0) AS liked,
              es.queued, es.listened, es.favorited
         FROM event_state es
         JOIN events e ON e.id = es.event_id
         JOIN artists a ON a.id = e.artist_id
         LEFT JOIN release_details rd ON rd.event_id = e.id
         LEFT JOIN user_artists ua ON ua.artist_id = e.artist_id
        WHERE es.user_id = ? AND es.${flag} = 1
        ORDER BY es.updated_at DESC, e.id DESC`,
    )
    .all(userId) as unknown as RawFeedRow[];

  // Arrow rather than a bare reference: Array.map passes the index as the
  // second argument, which would land in toFeedItem's `today` parameter.
  const today = todayIso();
  return rows.map((r) => toFeedItem(r, today));
}

/** Counts for the nav, so each link says how much is behind it. */
export function getListCounts(db: DB, userId: number): { queued: number; favorited: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(queued), 0) AS queued,
              COALESCE(SUM(favorited), 0) AS favorited
         FROM event_state WHERE user_id = ?`,
    )
    .get(userId) as { queued: number; favorited: number };
}

/** SQLite hands back 0/1 for every boolean; one place converts them. */
type RawFeedRow = Omit<
  FeedItem,
  'isUpcoming' | 'followed' | 'liked' | 'queued' | 'listened' | 'favorited'
> & {
  isUpcoming: number;
  followed: number;
  liked: number;
  queued: number | null;
  listened: number | null;
  favorited: number | null;
};

/*
 * Today, as a plain 'YYYY-MM-DD' string in UTC.
 *
 * Matches how event dates are stored, so the comparison is string-to-string
 * with no parsing and no timezone. Computed per call rather than per row: a
 * 600-row feed would otherwise build the same string 600 times, and a sweep
 * that straddles midnight should still label one page consistently.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toFeedItem(r: RawFeedRow, today: string = todayIso()): FeedItem {
  return {
    ...r,
    /*
     * Derived from the date, not read from the column.
     *
     * `release_details.is_upcoming` is a snapshot of what was true when the
     * ingest ran, and it goes stale the moment a date passes: measured on the
     * real database on 2026-09-19, four releases dated 2026-09-18 still claimed
     * is_upcoming=1 while eighteen others on the same date said 0. The stored
     * column stays because the sweep and the sort still use it, but nothing a
     * reader sees may depend on it.
     *
     * A date-only release counts as out on its own day: '2026-09-18' is not
     * after '2026-09-18', so it reads as released on the 18th rather than at
     * some invented hour. A partial date ('2026' or '2026-09') compares as the
     * start of its period, which is the same honest position byDate() sorts it
     * at. A row with no date at all cannot be upcoming.
     */
    isUpcoming: r.eventDate ? r.eventDate > today : false,
    followed: r.followed === 1,
    liked: r.liked === 1,
    // NULL when the LEFT JOIN found no state row, which means not flagged.
    queued: r.queued === 1,
    listened: r.listened === 1,
    favorited: r.favorited === 1,
  };
}

/**
 * The feed: one filterable list of everything we know about.
 *
 * Sorted newest-first within each of upcoming and released, which is
 * chronological rather than by urgency. The urgency rule in CLAUDE.md is about
 * gigs, where the on-sale date is the thing you can miss; a release has no
 * equivalent deadline, so date order is the honest one until gigs arrive and
 * the two have to share a sort.
 *
 * `datePrecision` travels with every row so the caller can render "2027"
 * rather than inventing a day it does not know.
 */
export function getFeed(
  db: DB,
  opts: { limit?: number; type?: 'release' | 'gig'; userId?: number } = {},
): FeedItem[] {
  const rows = db
    .prepare(
      `SELECT e.id AS eventId, e.artist_id AS artistId, a.name AS artist,
              e.title, e.event_date AS eventDate, e.source_url AS sourceUrl,
              e.first_seen_at AS firstSeenAt,
              rd.release_type AS releaseType,
              rd.date_precision AS datePrecision,
              rd.is_upcoming AS isUpcoming,
              rd.cover_url AS coverUrl,
              (SELECT external_id FROM artist_external_ids
                WHERE artist_id = e.artist_id AND source = 'spotify') AS spotifyArtistId,
              COALESCE(ua.followed, 0) AS followed,
              COALESCE(ua.liked, 0) AS liked,
              -- LEFT JOIN: most events have no state row at all, and NULL here
              -- means "never flagged", which toFeedItem reads as false.
              es.queued, es.listened, es.favorited
         FROM events e
         JOIN artists a ON a.id = e.artist_id
         LEFT JOIN event_state es ON es.event_id = e.id AND es.user_id = ?
         LEFT JOIN release_details rd ON rd.event_id = e.id
         -- LEFT JOIN, and one row per artist: the flags live on a single
         -- user_artists row, so an artist on both lists cannot duplicate the
         -- event here. An artist on no list still shows: releases are read per
         -- artist, and dropping one because a list row is missing would empty
         -- the feed for a reason no screen could explain.
         LEFT JOIN user_artists ua ON ua.artist_id = e.artist_id
        WHERE e.type = COALESCE(?, e.type)
        ORDER BY rd.is_upcoming DESC,
                 CASE WHEN rd.is_upcoming = 1 THEN e.event_date END ASC,
                 CASE WHEN rd.is_upcoming = 0 THEN e.event_date END DESC
        LIMIT ?`,
    )
    // Bind order follows the query text, not the options object: the
    // event_state join sits above the WHERE clause, so userId is first.
    .all(opts.userId ?? 1, opts.type ?? null, opts.limit ?? 200) as unknown as RawFeedRow[];

  // See getFlaggedEvents: `map` would otherwise pass the index as `today`.
  const today = todayIso();
  return rows.map((r) => toFeedItem(r, today));
}

/** Counts for the feed header. Separate query so the list can be paged later. */
export function getFeedCounts(db: DB): { total: number; upcoming: number; artists: number } {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE type = 'release') AS total,
         -- Derived from the date, matching what the feed actually shows.
         -- Counting is_upcoming here reported 42 against a feed showing 38,
         -- because the stored flag is a snapshot from the last ingest.
         (SELECT COUNT(*) FROM events
           WHERE type = 'release' AND event_date > date('now')) AS upcoming,
         (SELECT COUNT(DISTINCT artist_id) FROM events WHERE type = 'release') AS artists`,
    )
    .get() as { total: number; upcoming: number; artists: number };
}

export function getRoster(db: DB, userId: number) {
  return db
    .prepare(
      `SELECT a.id AS artistId, a.name, a.name_normalized AS nameNormalized,
              a.mbid,
              (SELECT external_id FROM artist_external_ids
                WHERE artist_id = a.id AND source = 'spotify') AS spotifyId
         FROM artists a
         JOIN user_artists ua ON ua.artist_id = a.id
        WHERE ua.user_id = ?
        ORDER BY a.name COLLATE NOCASE`,
    )
    .all(userId) as {
    artistId: number;
    name: string;
    nameNormalized: string;
    mbid: string | null;
    spotifyId: string | null;
  }[];
}

/**
 * Record a proven MusicBrainz identity.
 *
 * Guarded on `mbid IS NULL` so a re-run cannot overwrite an identity that is
 * already set — including one a human confirmed through the review queue. An
 * MBID is a claim about which band this is, and the second writer is not
 * automatically righter than the first.
 */
export function setArtistMbid(db: DB, artistId: number, mbid: string): void {
  db.prepare('UPDATE artists SET mbid = ? WHERE id = ? AND mbid IS NULL').run(mbid, artistId);
}

/**
 * Store artist links, ignoring ones already known.
 *
 * The primary key is (artist_id, kind, url), so re-running resolution is
 * idempotent and a source that reports the same Bandcamp page twice writes one
 * row. `verified_at` records when we last saw the link asserted, which is the
 * honest thing to show next to a link we have not followed.
 */
export function addArtistLinks(
  db: DB,
  artistId: number,
  links: { kind: string; url: string }[],
  source: string,
): number {
  if (links.length === 0) return 0;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO artist_links (artist_id, kind, url, source, verified_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  );

  let written = 0;
  const run = db.prepare('BEGIN');
  run.run();
  try {
    for (const link of links) {
      written += Number(stmt.run(artistId, link.kind, link.url, source).changes);
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  return written;
}

/**
 * Put an ambiguous match in front of a human instead of guessing.
 *
 * Deliberately not deduplicated on raw_name: the same name arriving from two
 * *sources* is two separate judgements, and collapsing them would hide one.
 *
 * But the same artist from the same source is not — it is the same question
 * asked twice. Three resolution runs produced 343 rows for 117 artists, with
 * Nightstalker and friends queued three times each, which turns a review queue
 * into a chore. A pending row for this artist and source is left alone.
 */
export interface ReleaseEventRow {
  artistId: number;
  title: string;
  /** May be partial: '2027', '2027-03', '2027-03-14'. */
  eventDate: string | null;
  datePrecision: 'day' | 'month' | 'year';
  sourceEventId: string;
  sourceUrl: string | null;
  releaseType: string;
  isUpcoming: boolean;
  payload: string | null;
}

/**
 * Write a release, or leave the existing one alone.
 *
 * `ON CONFLICT DO NOTHING` on (source, source_event_id) rather than an upsert:
 * the release-group MBID is the novelty key, so a second sighting of the same
 * id is the same record and carries nothing new. Overwriting would also reset
 * `first_seen_at`, which is the only record of when *we* learned about it —
 * and that is what "new to you" means in the feed.
 *
 * Returns the number of rows actually written, so a caller can report "3 new"
 * rather than "47 seen".
 */
export function insertReleaseEvent(db: DB, row: ReleaseEventRow): number {
  const result = db
    .prepare(
      `INSERT INTO events
         (type, artist_id, title, event_date, announced_at, source,
          source_event_id, source_url, payload_json, confidence)
       VALUES ('release', ?, ?, ?, NULL, 'musicbrainz', ?, ?, ?, 1.0)
       ON CONFLICT (source, source_event_id) DO NOTHING`,
    )
    .run(row.artistId, row.title, row.eventDate, row.sourceEventId, row.sourceUrl, row.payload);

  if (Number(result.changes) === 0) return 0;

  db.prepare(
    `INSERT INTO release_details
       (event_id, release_type, cover_url, total_tracks, tracklist_json,
        spotify_album_id, is_upcoming, date_precision)
     VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(Number(result.lastInsertRowid), row.releaseType, row.isUpcoming ? 1 : 0, row.datePrecision);

  return 1;
}

/** Stamp when an artist was last swept, so tiered polling can skip it later. */
/**
 * Record the answer the Cover Art Archive gave, including "none".
 *
 * `cover_checked_at` is stamped either way. A null url with a stamp means the
 * archive has no art for this release, which is a fact worth keeping: without
 * the stamp the next run would ask again, and most of a back catalogue has no
 * cover.
 */
export function setCoverArt(db: DB, eventId: number, url: string | null): void {
  db.prepare(
    `UPDATE release_details
        SET cover_url = ?, cover_checked_at = datetime('now')
      WHERE event_id = ?`,
  ).run(url, eventId);
}

export function markReleaseCheck(db: DB, artistId: number, when = new Date()): void {
  db.prepare('UPDATE artists SET last_release_check_at = ? WHERE id = ?').run(
    when.toISOString(),
    artistId,
  );
}

export function queueForReview(
  db: DB,
  entry: {
    rawName: string;
    source: string;
    sourceUrl?: string | null;
    candidateArtistId?: number | null;
    score: number;
    payload?: string | null;
  },
): number {
  if (entry.candidateArtistId != null) {
    const pending = db
      .prepare(
        `SELECT id FROM match_queue
          WHERE candidate_artist_id = ? AND source = ? AND status = 'pending'`,
      )
      .get(entry.candidateArtistId, entry.source) as { id: number } | undefined;
    // Already awaiting the same decision. Re-queuing would not add information.
    if (pending) return pending.id;
  }

  const r = db
    .prepare(
      `INSERT INTO match_queue
         (raw_name, source, source_url, candidate_artist_id, score, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.rawName,
      entry.source,
      entry.sourceUrl ?? null,
      entry.candidateArtistId ?? null,
      entry.score,
      entry.payload ?? null,
    );
  return Number(r.lastInsertRowid);
}

/** One MusicBrainz act we might mean, as recorded in the queue payload. */
export interface ReviewCandidate {
  mbid: string;
  name: string;
  /** MusicBrainz's own search score, 0-100. Theirs, not ours. */
  score: number;
  /** MusicBrainz's one-line "which one is this" — often the deciding fact. */
  disambiguation: string;
}

export interface ReviewRow {
  queueId: number;
  artistId: number;
  /** The name as Spotify gave it, which is what you would recognise. */
  rawName: string;
  /** For the link out: both sides of the comparison must be checkable. */
  spotifyId: string | null;
  followed: boolean;
  liked: boolean;
  candidates: ReviewCandidate[];
}

/**
 * The review queue: artists MusicBrainz found more than one way to read.
 *
 * Joined to the Spotify id on purpose. A row asking "which of these two bands
 * called Steak is yours?" is unanswerable without a way to hear both, so the
 * page links the Spotify artist AND every MusicBrainz candidate. Without the
 * id the question is a guess with extra steps.
 *
 * Oldest first: the queue is worked through, and a stable order means a row
 * does not move under the cursor when another is decided.
 */
export function getReviewQueue(db: DB, userId: number, limit = 500): ReviewRow[] {
  const rows = db
    .prepare(
      `SELECT q.id AS queueId, q.raw_name AS rawName, q.payload_json AS payloadJson,
              q.candidate_artist_id AS artistId,
              e.external_id AS spotifyId,
              ua.followed, ua.liked
         FROM match_queue q
         JOIN artists a ON a.id = q.candidate_artist_id
         LEFT JOIN artist_external_ids e
                ON e.artist_id = q.candidate_artist_id AND e.source = 'spotify'
         LEFT JOIN user_artists ua
                ON ua.artist_id = q.candidate_artist_id AND ua.user_id = ?
        WHERE q.status = 'pending'
          AND a.mbid IS NULL
        ORDER BY q.id
        LIMIT ?`,
    )
    .all(userId, limit) as unknown as {
    queueId: number;
    rawName: string;
    payloadJson: string | null;
    artistId: number;
    spotifyId: string | null;
    followed: number | null;
    liked: number | null;
  }[];

  return rows.map((r) => {
    /*
     * A payload that will not parse is a row with no candidates, not a crash.
     * It still renders: "none of these" is a valid answer and the only one
     * available when we cannot show what was found.
     */
    let candidates: ReviewCandidate[] = [];
    try {
      const parsed = JSON.parse(r.payloadJson ?? '{}') as { candidates?: ReviewCandidate[] };
      if (Array.isArray(parsed.candidates)) candidates = parsed.candidates;
    } catch {
      candidates = [];
    }

    return {
      queueId: r.queueId,
      artistId: r.artistId,
      rawName: r.rawName,
      spotifyId: r.spotifyId,
      followed: r.followed === 1,
      liked: r.liked === 1,
      candidates,
    };
  });
}

/** How many decisions are waiting. Counts what getReviewQueue would return. */
export function getReviewCount(db: DB): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM match_queue q
         JOIN artists a ON a.id = q.candidate_artist_id
        WHERE q.status = 'pending' AND a.mbid IS NULL`,
    )
    .get() as { n: number };
  return r.n;
}

/**
 * Accept one candidate: the artist gets the MBID and the queue row is closed.
 *
 * In a transaction because the three writes are one decision. A confirmed row
 * with no MBID set would ask again next sweep; an MBID set against a still
 * pending row would show a decided artist in the queue forever.
 *
 * The alias is the point of the exercise. `artist_aliases` exists so a name is
 * decided once — the next source that reports "Steak" matches this artist
 * without asking, which is what stops the queue refilling with the same names.
 */
export function confirmReviewMatch(
  db: DB,
  queueId: number,
  artistId: number,
  mbid: string,
  aliasNormalized: string,
): void {
  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(mbid, artistId);
    db.prepare("UPDATE match_queue SET status = 'confirmed' WHERE id = ?").run(queueId);
    db.prepare(
      `INSERT OR IGNORE INTO artist_aliases (artist_id, alias_normalized, source)
       VALUES (?, ?, 'manual')`,
    ).run(artistId, aliasNormalized);
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

/**
 * "None of these." The artist keeps mbid NULL and the row stops coming back.
 *
 * Deliberately not a deletion: a rejected row is the record that someone
 * looked and said no. Deleting it would let the next sweep re-queue the same
 * name and ask the same question again.
 */
export function rejectReviewMatch(db: DB, queueId: number): void {
  db.prepare("UPDATE match_queue SET status = 'rejected' WHERE id = ?").run(queueId);
}

export function getAliases(db: DB) {
  return db
    .prepare('SELECT artist_id AS artistId, alias_normalized AS aliasNormalized FROM artist_aliases')
    .all() as { artistId: number; aliasNormalized: string }[];
}

// ─── Adapter health ─────────────────────────────────────────────────────────

/**
 * Health is user-visible, not just logged: an empty feed must be able to say
 * which source is down. See copy rule 8.
 */
export function recordSuccess(db: DB, source: string): void {
  db.prepare(
    `INSERT INTO adapter_health (source, status, last_success_at, last_attempt_at,
                                 last_error, consecutive_failures)
     VALUES (?, 'ok', datetime('now'), datetime('now'), NULL, 0)
     ON CONFLICT(source) DO UPDATE SET
       status = 'ok', last_success_at = datetime('now'),
       last_attempt_at = datetime('now'), last_error = NULL,
       consecutive_failures = 0`,
  ).run(source);
}

/**
 * One failure is 'degraded'; three consecutive is 'failing'.
 *
 * The distinction matters for what the UI says: a single blip should not tell
 * the user a source is broken, and a source down for three polls should not be
 * described as a blip.
 */
export function recordFailure(db: DB, source: string, error: string): void {
  db.prepare(
    `INSERT INTO adapter_health (source, status, last_attempt_at, last_error,
                                 consecutive_failures)
     VALUES (?, 'degraded', datetime('now'), ?, 1)
     ON CONFLICT(source) DO UPDATE SET
       consecutive_failures = consecutive_failures + 1,
       status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'failing' ELSE 'degraded' END,
       last_attempt_at = datetime('now'),
       last_error = excluded.last_error`,
  ).run(source, error.slice(0, 500));
}

export function getHealth(db: DB) {
  return db
    .prepare(
      `SELECT source, status, last_success_at AS lastSuccessAt,
              last_attempt_at AS lastAttemptAt, last_error AS lastError,
              consecutive_failures AS consecutiveFailures
         FROM adapter_health ORDER BY source`,
    )
    .all() as {
    source: string;
    status: string;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  }[];
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

/**
 * Checkpointing. The roster is thousands of artists and MusicBrainz allows one
 * request per second, so a first run takes ~30 minutes. Killing the container
 * mid-ingest must resume, not restart.
 */
export function loadJob(db: DB, jobName: string) {
  return db
    .prepare(
      `SELECT job_name AS jobName, cursor, total, done, status, last_error AS lastError
         FROM job_state WHERE job_name = ?`,
    )
    .get(jobName) as
    | {
        jobName: string;
        cursor: string | null;
        total: number | null;
        done: number;
        status: string;
        lastError: string | null;
      }
    | undefined;
}

export function saveJob(
  db: DB,
  jobName: string,
  patch: { cursor?: string | null; total?: number | null; done?: number; status?: string; lastError?: string | null },
): void {
  // A patch may omit any field, meaning "leave it alone". On the insert path
  // there is nothing to leave alone, so the NOT NULL columns take their
  // defaults — COALESCE against excluded.* runs only after a conflict, too late
  // to satisfy the constraint.
  db.prepare(
    `INSERT INTO job_state (job_name, cursor, total, done, status, last_error, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(job_name) DO UPDATE SET
       cursor = COALESCE(excluded.cursor, job_state.cursor),
       total = COALESCE(excluded.total, job_state.total),
       done = CASE WHEN ? IS NULL THEN job_state.done ELSE excluded.done END,
       status = CASE WHEN ? IS NULL THEN job_state.status ELSE excluded.status END,
       last_error = excluded.last_error,
       updated_at = datetime('now')`,
  ).run(
    jobName,
    patch.cursor ?? null,
    patch.total ?? null,
    // Insert defaults. The trailing sentinels below carry "was this in the
    // patch?", which the defaults have already destroyed.
    patch.done ?? 0,
    patch.status ?? 'idle',
    patch.lastError ?? null,
    patch.done ?? null,
    patch.status ?? null,
  );
}

// --- OAuth tokens -----------------------------------------------------------

/**
 * Tokens are encrypted by the caller, not here.
 *
 * This layer stays a dumb store: it never sees the key. That keeps the crypto
 * in one testable place (src/auth/crypto.ts) instead of spread across the data
 * layer, and it means a query-log dump cannot contain a usable token.
 */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
}

export function saveTokens(
  db: DB,
  userId: number,
  provider: string,
  tokens: StoredTokens,
): void {
  // Spotify omits refresh_token on a refresh response: it expects you to keep
  // using the one you have. COALESCE means a refresh never nulls it out, which
  // would silently force a full re-auth on the next expiry.
  db.prepare(
    `INSERT INTO auth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, auth_tokens.refresh_token),
       expires_at = excluded.expires_at,
       scope = COALESCE(excluded.scope, auth_tokens.scope)`,
  ).run(
    userId,
    provider,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresAt,
    tokens.scope,
  );
}

export function loadTokens(db: DB, userId: number, provider: string): StoredTokens | null {
  const row = db
    .prepare(
      `SELECT access_token AS accessToken, refresh_token AS refreshToken,
              expires_at AS expiresAt, scope
         FROM auth_tokens WHERE user_id = ? AND provider = ?`,
    )
    .get(userId, provider) as StoredTokens | undefined;
  return row ?? null;
}

export function deleteTokens(db: DB, userId: number, provider: string): void {
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND provider = ?').run(userId, provider);
}
