/**
 * Build a seeded database, so screens work without OAuth.
 *
 * The point is not test data — the suites make their own in memory. It is that
 * `npm run dev` on a fresh clone otherwise shows a connect screen and nothing
 * else, so no feed layout can be looked at, and constraint 5 says the way you
 * find real bugs is by rendering. A seeded database makes the screens
 * reviewable on a machine that has never held a Spotify token.
 *
 * Everything here is derived from tests/fixtures/spotify-albums.json — real
 * recorded upstream shapes, not invented ones. Data invented by hand agrees
 * with whatever the author assumed, which is exactly the assumption a fixture
 * exists to check. Where the fixture cannot supply something (an upcoming
 * release, if none was recorded), this file says so rather than fabricating a
 * plausible-looking row.
 *
 * Writes to a separate file by default (data/seed.db), because overwriting a
 * real roster with sample rows would be a rotten surprise.
 *
 * Usage:
 *   npm run seed              # data/seed.db
 *   npm run seed -- --force   # overwrite whatever is at DATABASE_PATH
 */

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv } from '../src/config-env.ts';

loadDotEnv();

const { openDatabase, upsertArtist, followArtist, saveJob, saveTokens } = await import('../src/db/index.ts');
const { normalizeName } = await import('../src/matcher/normalize.ts');
const { loadConfig } = await import('../src/config.ts');
const { encryptToken, loadKey } = await import('../src/auth/crypto.ts');

const root = join(import.meta.dirname, '..');
const force = process.argv.includes('--force');
const target = force ? loadConfig().databasePath : join(root, 'data', 'seed.db');

const SEED_USER_ID = 1;

/**
 * Rebuilt from scratch each run: a half-updated seed is worse than none.
 *
 * Windows locks an open SQLite file, so reseeding while `npm run dev` is
 * running fails with EPERM. That is the common case — you reseed *because* you
 * are looking at the app — so it gets a real message rather than a raw stack.
 */
if (existsSync(target)) {
  try {
    rmSync(target, { force: true });
    for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, { force: true });
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
      console.error(
        `Cannot rebuild ${target}: the file is in use.\n` +
          'Stop the dev server (or whatever has it open) and run this again.',
      );
      process.exit(1);
    }
    throw err;
  }
}

const fixturePath = join(root, 'tests', 'fixtures', 'spotify-albums.json');
if (!existsSync(fixturePath)) {
  console.error(
    'tests/fixtures/spotify-albums.json is missing.\n' +
      'Record it first: npm run fixtures:record -- roster-sample 6',
  );
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const db = openDatabase(target);

const today = new Date().toISOString().slice(0, 10);

const insertEvent = db.prepare(
  `INSERT INTO events (type, artist_id, title, event_date, announced_at,
                       source, source_event_id, source_url, payload_json, confidence)
   VALUES ('release', ?, ?, ?, ?, 'spotify', ?, ?, ?, 1.0)`,
);

const insertRelease = db.prepare(
  `INSERT INTO release_details (event_id, release_type, cover_url, total_tracks,
                                spotify_album_id, is_upcoming)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

let artistCount = 0;
let eventCount = 0;
let upcomingCount = 0;

db.exec('BEGIN');

for (const [spotifyId, entry] of Object.entries(fixture.artists ?? {})) {
  const name = entry.name ?? spotifyId;
  const items = entry.response?.items ?? [];

  const artistId = upsertArtist(db, {
    name,
    nameNormalized: normalizeName(name),
    imageUrl: items[0]?.images?.[0]?.url ?? null,
    externalId: { source: 'spotify', id: spotifyId },
  });
  followArtist(db, SEED_USER_ID, artistId, 'spotify');
  artistCount++;

  for (const album of items) {
    // Future-dated releases are the ones the 2-month lookahead is for, so the
    // flag is derived from the date rather than assumed false.
    const isUpcoming = album.release_date > today ? 1 : 0;
    if (isUpcoming) upcomingCount++;

    const eventId = insertEvent.run(
      artistId,
      album.name,
      album.release_date,
      null, // announced_at: Spotify does not tell us when it was announced
      album.id,
      album.external_urls?.spotify ?? null,
      JSON.stringify(album),
    ).lastInsertRowid;

    insertRelease.run(
      eventId,
      album.album_type ?? 'album',
      album.images?.[0]?.url ?? null,
      album.total_tracks ?? null,
      album.id,
      isUpcoming,
    );
    eventCount++;
  }
}

/*
 * A connected account, or the seeded screens are the connect screen.
 *
 * Found by screenshotting the first version of this file: it wrote 6 artists
 * and 46 releases, and the app still rendered "Connect Spotify to start",
 * because connectedness is decided by a row in auth_tokens and nothing else.
 * A seed that renders identically to an empty database is not a seed.
 *
 * The token is deliberately not a credential: a fixed non-secret string, and
 * already expired, so nothing here can be mistaken for a working login or
 * accidentally used against the live API. It is encrypted anyway, because
 * loadTokens hands whatever it finds to decryptToken, and a plaintext value
 * would throw rather than read as "connected".
 */
const key = loadKey();
saveTokens(db, SEED_USER_ID, 'spotify', {
  accessToken: encryptToken('seed-not-a-real-token', key),
  refreshToken: encryptToken('seed-not-a-real-refresh-token', key),
  expiresAt: new Date(0).toISOString(),
  scope: 'user-follow-read user-top-read',
});

// The seed represents a completed import, so the UI does not show a progress
// bar for a job that will never run.
saveJob(db, 'roster:spotify', {
  cursor: null,
  total: artistCount,
  done: artistCount,
  status: 'complete',
  lastError: null,
});

db.exec('COMMIT');
db.close();

const rel = target.replace(root + '\\', '').replace(root + '/', '');
console.log(`seeded ${rel}`);
console.log(`  ${artistCount} artists, ${eventCount} releases, ${upcomingCount} upcoming`);

if (upcomingCount === 0) {
  console.log(
    '\nNote: the fixture contains no future-dated release, so the upcoming\n' +
      'path is not exercised by this seed. Re-record from an artist with one\n' +
      'to review that state.',
  );
}
if (!force) {
  console.log(`\nRun against it with:  DATABASE_PATH=${rel} npm run dev`);
}
