/**
 * The liked-songs data layer: migration 2 and the list flags.
 *
 * The assertions that matter:
 *   - migrating a database built the OLD way keeps every existing follow
 *   - setting one list flag never clears the other (the bug the flags exist for)
 *   - the liked import writes `liked` and leaves `followed` alone, in both orders
 *
 * In-memory databases throughout. Nothing here touches data/bandelion.db.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateForTest, setArtistList, followArtist, upsertArtist } from '../src/db/index.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const root = join(import.meta.dirname, '..');

// --- Migration against a database built the old way --------------------------
// Not the current schema.sql: the point is a database that predates the flags,
// which is what every existing install is.

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
    CREATE TABLE user_artists (
      user_id INTEGER NOT NULL,
      artist_id INTEGER NOT NULL,
      followed_at TEXT,
      source TEXT NOT NULL DEFAULT 'spotify',
      PRIMARY KEY (user_id, artist_id)
    );
    CREATE TABLE release_details (event_id INTEGER PRIMARY KEY, release_type TEXT NOT NULL);
  `);

  for (let i = 1; i <= 625; i++) {
    db.prepare('INSERT INTO artists (name, name_normalized) VALUES (?, ?)').run(`A${i}`, `a${i}`);
    db.prepare(
      `INSERT INTO user_artists (user_id, artist_id, followed_at, source)
       VALUES (1, ?, '2026-01-01', 'spotify')`,
    ).run(i);
  }

  const before = db.prepare('SELECT COUNT(*) n FROM user_artists').get().n;
  check(before === 625, 'the old-shape database starts with 625 follows');

  migrateForTest(db);

  const after = db.prepare('SELECT COUNT(*) n FROM user_artists').get().n;
  check(after === 625, 'every row survives the migration', `${before} -> ${after}`);

  const followed = db.prepare('SELECT COUNT(*) n FROM user_artists WHERE followed = 1').get().n;
  check(followed === 625, 'every migrated row is marked followed', `got ${followed}`);

  const liked = db.prepare('SELECT COUNT(*) n FROM user_artists WHERE liked = 1').get().n;
  check(liked === 0, 'nothing is marked liked by the migration', `got ${liked}`);

  const version = db.prepare('PRAGMA user_version').get().user_version;
  check(Number(version) === 2, 'user_version reaches 2', `got ${version}`);

  // Running it twice must be a no-op, because openDatabase migrates on every
  // start and a self-hoster restarts the container often.
  migrateForTest(db);
  const again = db.prepare('SELECT COUNT(*) n FROM user_artists WHERE followed = 1').get().n;
  check(again === 625, 'migrating twice changes nothing');

  db.close();
}

// --- The real upgrade path: schema.sql THEN migrate, on a file -------------
//
// The case the in-memory tests above cannot reach. `openDatabase` runs
// schema.sql before migrate(), so anything in schema.sql that names a column
// only a migration adds fails on every existing install — while passing every
// test that builds a fresh database or calls migrateForTest directly.
//
// This is how it actually broke: an index on (user_id, followed, liked) in
// schema.sql took down `npm run ingest liked` with "no such column: followed",
// after the whole suite went green.

{
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { openDatabase, closeDatabase } = await import('../src/db/index.ts');

  const dir = mkdtempSync(join(tmpdir(), 'bandelion-migrate-'));
  const path = join(dir, 'old.db');

  // A database as it existed before this feature: schema.sql as it was, at
  // user_version 1. Written out rather than derived, so a later edit to
  // schema.sql cannot quietly make this test agree with itself.
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
    CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mbid TEXT UNIQUE, name TEXT NOT NULL, name_normalized TEXT NOT NULL,
      image_url TEXT, last_release_check_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_artists (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      followed_at TEXT,
      source TEXT NOT NULL DEFAULT 'spotify',
      PRIMARY KEY (user_id, artist_id)
    );
    PRAGMA user_version = 1;
  `);
  old.prepare("INSERT INTO artists (name, name_normalized) VALUES ('Kept', 'kept')").run();
  old.prepare('INSERT INTO user_artists (user_id, artist_id, source) VALUES (1, 1, ?)').run(
    'spotify',
  );
  old.close();

  let opened = null;
  let error = null;
  try {
    opened = openDatabase(path);
  } catch (err) {
    error = err;
  }

  check(error === null, 'opening a pre-flags database does not throw', String(error));

  if (opened) {
    const row = opened.prepare('SELECT * FROM user_artists WHERE artist_id = 1').get();
    check(row?.followed === 1, 'the existing follow survives a real open', JSON.stringify(row));

    const idx = opened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_artists'")
      .all()
      .map((r) => r.name);
    check(
      idx.includes('idx_user_artists_lists'),
      'the list index exists after a real open',
      idx.join(', '),
    );

    opened.close();
  }

  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
}

// --- A fresh database gets the same shape ------------------------------------

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(root, 'src', 'db', 'schema.sql'), 'utf8'));
  migrateForTest(db);
  return db;
}

{
  const db = freshDb();
  const cols = db
    .prepare('PRAGMA table_info(user_artists)')
    .all()
    .map((c) => c.name);
  check(cols.includes('followed'), 'a fresh database has the followed column');
  check(cols.includes('liked'), 'a fresh database has the liked column');
  db.close();
}

// --- The flags: setting one never clears the other ---------------------------

{
  const db = freshDb();
  const artistId = upsertArtist(db, {
    name: 'Both Lists',
    nameNormalized: 'both lists',
    externalId: { source: 'spotify', id: 'sp1' },
  });

  // Followed first, then liked — the order a real install hits.
  followArtist(db, 1, artistId);
  let row = db.prepare('SELECT * FROM user_artists WHERE artist_id = ?').get(artistId);
  check(row.followed === 1 && row.liked === 0, 'following sets followed only');

  setArtistList(db, 1, artistId, { liked: true });
  row = db.prepare('SELECT * FROM user_artists WHERE artist_id = ?').get(artistId);
  check(row.followed === 1, 'liking does NOT clear followed', JSON.stringify(row));
  check(row.liked === 1, 'liking sets liked');

  const rows = db.prepare('SELECT COUNT(*) n FROM user_artists WHERE artist_id = ?').get(artistId).n;
  check(rows === 1, 'an artist on both lists is still one row', `got ${rows}`);

  db.close();
}

{
  // The reverse order: liked import runs first, then the roster. A self-hoster
  // who sets up liked songs before ever importing their roster hits this.
  const db = freshDb();
  const artistId = upsertArtist(db, {
    name: 'Liked First',
    nameNormalized: 'liked first',
    externalId: { source: 'spotify', id: 'sp2' },
  });

  setArtistList(db, 1, artistId, { liked: true });
  followArtist(db, 1, artistId);

  const row = db.prepare('SELECT * FROM user_artists WHERE artist_id = ?').get(artistId);
  check(row.liked === 1, 'following does NOT clear liked', JSON.stringify(row));
  check(row.followed === 1, 'following sets followed after a like');

  db.close();
}

{
  // Re-running an import must be idempotent: every writer runs repeatedly.
  const db = freshDb();
  const artistId = upsertArtist(db, {
    name: 'Repeat',
    nameNormalized: 'repeat',
    externalId: { source: 'spotify', id: 'sp3' },
  });

  for (let i = 0; i < 3; i++) setArtistList(db, 1, artistId, { liked: true });
  const rows = db.prepare('SELECT COUNT(*) n FROM user_artists WHERE artist_id = ?').get(artistId).n;
  check(rows === 1, 'repeating an import does not duplicate the row', `got ${rows}`);

  db.close();
}

// --- The counts the UI reads -------------------------------------------------

{
  const db = freshDb();
  const { likedStatus } = await import('../src/jobs/liked.ts');

  const mk = (name, id, lists) => {
    const artistId = upsertArtist(db, {
      name,
      nameNormalized: name.toLowerCase(),
      externalId: { source: 'spotify', id },
    });
    setArtistList(db, 1, artistId, lists);
  };

  mk('Only Followed', 'f1', { followed: true });
  mk('Only Liked', 'l1', { liked: true });
  mk('Only Liked Two', 'l2', { liked: true });
  mk('Both', 'b1', { followed: true });
  setArtistList(db, 1, 4, { liked: true });

  const status = likedStatus(db, 1);
  check(status.imported === 3, 'liked count includes the overlap', `got ${status.imported}`);
  check(status.alsoFollowed === 1, 'overlap is counted separately', `got ${status.alsoFollowed}`);

  db.close();
}

console.log(failed === 0 ? '\nliked-db: all checks passed' : `\nliked-db: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
