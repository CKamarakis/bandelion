/**
 * Database layer.
 *
 * Runs against an in-memory database, so it is fast and leaves nothing behind.
 * The interesting assertions are not "does INSERT work" but the invariants the
 * rest of the app relies on: artists deduplicate across sources, health
 * distinguishes degraded from failing, and jobs resume rather than restart.
 */

import { openDatabase, upsertArtist, linkExternalId, followArtist, getRoster,
         recordSuccess, recordFailure, getHealth, loadJob, saveJob } from '../src/db/index.ts';
import { normalizeName } from '../src/matcher/normalize.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const db = openDatabase(':memory:');

// ─── schema ─────────────────────────────────────────────────────────────────

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);

for (const t of ['artists', 'events', 'event_state', 'gig_details', 'release_details',
                 'match_queue', 'adapter_health', 'job_state', 'user_artists']) {
  check(tables.includes(t), `table ${t} exists`);
}

const user = db.prepare('SELECT id FROM users WHERE id = 1').get();
check(!!user, 'user 1 is seeded (single-user UX, multi-user schema)');

// ─── artist deduplication ───────────────────────────────────────────────────

const a1 = upsertArtist(db, { name: 'The Notwist', nameNormalized: normalizeName('The Notwist') });
const a2 = upsertArtist(db, { name: 'Notwist', nameNormalized: normalizeName('Notwist') });
check(a1 === a2, 'The Notwist and Notwist resolve to one artist',
      `got ids ${a1} and ${a2}`);

// A later source knowing the MBID must backfill it, not create a second row.
const a3 = upsertArtist(db, {
  name: 'The Notwist',
  nameNormalized: normalizeName('The Notwist'),
  mbid: 'abc-123',
});
check(a3 === a1, 'upsert with MBID returns the existing artist');
const withMbid = db.prepare('SELECT mbid FROM artists WHERE id = ?').get(a1);
check(withMbid.mbid === 'abc-123', 'MBID is backfilled onto the existing row');

// COALESCE must not wipe a known value with a null from a poorer source.
upsertArtist(db, { name: 'The Notwist', nameNormalized: normalizeName('The Notwist') });
const stillThere = db.prepare('SELECT mbid FROM artists WHERE id = ?').get(a1);
check(stillThere.mbid === 'abc-123', 'a later source without an MBID does not erase it');

linkExternalId(db, a1, 'spotify', 'spotify-notwist');
linkExternalId(db, a1, 'spotify', 'spotify-notwist'); // idempotent
const extCount = db
  .prepare('SELECT COUNT(*) c FROM artist_external_ids WHERE artist_id = ?')
  .get(a1);
check(extCount.c === 1, 'linking the same external id twice is idempotent');

followArtist(db, 1, a1);
const roster = getRoster(db, 1);
check(roster.length === 1, 'roster has the followed artist');
check(roster[0].spotifyId === 'spotify-notwist', 'roster carries the spotify id');
check(roster[0].mbid === 'abc-123', 'roster carries the mbid');

// ─── adapter health ─────────────────────────────────────────────────────────

// This is decision 003 made concrete: the UI must be able to say WHY a feed is
// empty, so the difference between one blip and a source being down must survive.

recordFailure(db, 'eventim', 'ECONNREFUSED');
let h = getHealth(db).find((x) => x.source === 'eventim');
check(h.status === 'degraded', 'one failure is degraded, not failing');
check(h.consecutiveFailures === 1, 'failure count starts at 1');

recordFailure(db, 'eventim', 'ECONNREFUSED');
recordFailure(db, 'eventim', 'ECONNREFUSED');
h = getHealth(db).find((x) => x.source === 'eventim');
check(h.status === 'failing', 'three consecutive failures is failing');
check(h.consecutiveFailures === 3, 'failure count accumulates');
check(h.lastError === 'ECONNREFUSED', 'last error is kept for the UI');

recordSuccess(db, 'eventim');
h = getHealth(db).find((x) => x.source === 'eventim');
check(h.status === 'ok', 'a success clears the failing state');
check(h.consecutiveFailures === 0, 'a success resets the counter');
check(h.lastError === null, 'a success clears the last error');
check(!!h.lastSuccessAt, 'a success records when it happened');

// A very long error must not blow up the row.
recordFailure(db, 'residentadvisor', 'x'.repeat(5000));
h = getHealth(db).find((x) => x.source === 'residentadvisor');
check(h.lastError.length <= 500, 'a long error is truncated', `got ${h.lastError.length} chars`);

// ─── job checkpointing ──────────────────────────────────────────────────────

// The roster is thousands of artists and MusicBrainz allows one request per
// second, so a first run takes ~30 minutes. Killing it must resume.

check(loadJob(db, 'mbid') === undefined, 'an unstarted job has no state');

saveJob(db, 'mbid', { cursor: '0', total: 2000, done: 0, status: 'running' });
let job = loadJob(db, 'mbid');
check(job.total === 2000 && job.done === 0, 'job records total and progress');

saveJob(db, 'mbid', { cursor: '340', done: 340 });
job = loadJob(db, 'mbid');
check(job.done === 340, 'progress advances');
check(job.cursor === '340', 'cursor advances');
check(job.status === 'running', 'a partial update does not clear status');
check(job.total === 2000, 'a partial update does not clear total');

saveJob(db, 'mbid', { status: 'complete' });
job = loadJob(db, 'mbid');
check(job.done === 340, 'completing does not reset progress');

console.log(failed ? `\n${failed} check(s) failed` : '\nall database checks passed');
process.exit(failed ? 1 : 0);
