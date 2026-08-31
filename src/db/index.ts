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

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // WAL so the scheduler can write while the UI reads.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const schemaPath = join(import.meta.dirname, 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));

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
  artist: { name: string; nameNormalized: string; mbid?: string | null; imageUrl?: string | null },
): number {
  const existing = db
    .prepare('SELECT id FROM artists WHERE name_normalized = ?')
    .get(artist.nameNormalized) as { id: number } | undefined;

  if (existing) {
    // Backfill fields a later source knew and an earlier one did not.
    if (artist.mbid || artist.imageUrl) {
      db.prepare(
        `UPDATE artists
            SET mbid = COALESCE(mbid, ?),
                image_url = COALESCE(image_url, ?)
          WHERE id = ?`,
      ).run(artist.mbid ?? null, artist.imageUrl ?? null, existing.id);
    }
    return existing.id;
  }

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

export function followArtist(db: DB, userId: number, artistId: number, source = 'spotify'): void {
  db.prepare(
    `INSERT OR IGNORE INTO user_artists (user_id, artist_id, followed_at, source)
     VALUES (?, ?, datetime('now'), ?)`,
  ).run(userId, artistId, source);
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
