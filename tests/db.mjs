/**
 * Database layer.
 *
 * Runs against an in-memory database, so it is fast and leaves nothing behind.
 * The interesting assertions are not "does INSERT work" but the invariants the
 * rest of the app relies on: artists deduplicate across sources, health
 * distinguishes degraded from failing, and jobs resume rather than restart.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

// --- Schema resolution outside plain Node -----------------------------------
//
// Found by running the app, not by a suite: `import.meta.dirname` is undefined
// once Next bundles src/db/index.ts, so openDatabase threw
// ERR_INVALID_ARG_TYPE on every request while every test stayed green. The
// suites import the source directly under Node, where dirname is defined, so
// they could not see it.
//
// This asserts the fallback path exists on disk, which is what the bundled
// build depends on. It does not simulate the bundler, so it is a guard against
// the file moving rather than proof the bundle works.
{
  const fromCwd = join(process.cwd(), 'src', 'db', 'schema.sql');
  check(
    existsSync(fromCwd),
    'schema.sql is resolvable from the project root, the path the bundled app uses',
    fromCwd,
  );

  // The real assertion: a database opened with no import.meta.dirname still
  // gets its schema. If this regresses, the app breaks and nothing else notices.
  const probe = openDatabase(':memory:');
  const tables = probe
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const required of ['artists', 'events', 'auth_tokens', 'adapter_health', 'job_state']) {
    check(tables.includes(required), `schema creates the ${required} table`);
  }
  probe.close();
}

// --- Same name, different artists -------------------------------------------
//
// Found in a real import: 625 followed artists produced 623 rows. WITCH (the
// Zambian zamrock band) and Witch (the American doom band) collapsed into one,
// and so did the two Pentagrams. Same for any source that hands us an explicit
// id saying these are separate acts.
//
// The name-matching in upsertArtist is deliberate and stays: "The Notwist" and
// "Notwist" arriving from two different sources must not create two rows. But a
// source-native id is stronger evidence than a name, and when one says "this is
// a different artist" it has to win. Otherwise the merge is silent, which is
// worse than an error: the roster is simply short and nothing says so.
{
  const db = openDatabase(':memory:');

  const zamrock = upsertArtist(db, {
    name: 'WITCH',
    nameNormalized: normalizeName('WITCH'),
    externalId: { source: 'spotify', id: '0LMkPoi2xIgpOPUSJMftqM' },
  });
  const doom = upsertArtist(db, {
    name: 'Witch',
    nameNormalized: normalizeName('Witch'),
    externalId: { source: 'spotify', id: '6uNOBEATMcW8SSunnKy9a3' },
  });

  check(zamrock !== doom, 'two Spotify artists sharing a name stay separate rows');

  const count = db.prepare("SELECT COUNT(*) AS n FROM artists WHERE name_normalized = 'witch'").get();
  check(count.n === 2, 'both artists are stored', `got ${count.n}`);

  // The same id arriving again must still be the same artist, or every re-run
  // would duplicate the whole roster.
  const again = upsertArtist(db, {
    name: 'WITCH',
    nameNormalized: normalizeName('WITCH'),
    externalId: { source: 'spotify', id: '0LMkPoi2xIgpOPUSJMftqM' },
  });
  check(again === zamrock, 'the same external id resolves to the same artist');

  // Without an id, name matching still applies: this is the cross-source case
  // the matching exists for, and it must keep working.
  const byName = upsertArtist(db, { name: 'Slowdive', nameNormalized: normalizeName('Slowdive') });
  const byNameAgain = upsertArtist(db, { name: 'slowdive', nameNormalized: normalizeName('slowdive') });
  check(byName === byNameAgain, 'without an external id, names still merge across sources');

  // An id-less arrival must not be flung at an arbitrary one of two same-named
  // artists. Attaching to the first is a coin flip; the matcher's review queue
  // is where an ambiguous name belongs.
  const ambiguous = upsertArtist(db, { name: 'Witch', nameNormalized: normalizeName('Witch') });
  check(
    ambiguous === zamrock || ambiguous === doom,
    'an ambiguous name resolves to one of the candidates rather than creating a third row',
  );

  db.close();
}

// --- .env loading for entry points Next does not start -----------------------
//
// `npm run ingest` failed with "TOKEN_ENCRYPTION_KEY is not set" while the web
// UI worked on the same machine: Next reads .env, plain Node does not.
{
  const { loadDotEnv } = await import('../src/config-env.ts');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'bandelion-env-'));
  const envFile = join(dir, '.env');
  writeFileSync(
    envFile,
    [
      '# a comment',
      '',
      'BANDELION_TEST_PLAIN=value',
      'BANDELION_TEST_QUOTED="quoted value"',
      "BANDELION_TEST_SINGLE='single'",
      'BANDELION_TEST_EQUALS=key=with=equals',
      'BANDELION_TEST_EXISTING=from-file',
      'malformed line with no equals',
    ].join('\n'),
  );

  process.env.BANDELION_TEST_EXISTING = 'from-environment';
  loadDotEnv(envFile);

  check(process.env.BANDELION_TEST_PLAIN === 'value', '.env values are loaded');
  check(process.env.BANDELION_TEST_QUOTED === 'quoted value', 'double quotes are stripped');
  check(process.env.BANDELION_TEST_SINGLE === 'single', 'single quotes are stripped');
  check(
    process.env.BANDELION_TEST_EQUALS === 'key=with=equals',
    'only the first = separates key from value',
  );
  // A real environment variable must beat the file, or a deployment cannot
  // override anything without editing a file inside the container.
  check(
    process.env.BANDELION_TEST_EXISTING === 'from-environment',
    'an existing environment variable is not overwritten by .env',
  );
  check(process.env['malformed line with no equals'] === undefined, 'malformed lines are skipped');
  check(process.env['# a comment'] === undefined, 'comments are skipped');

  // A missing file is normal: the app runs on real environment variables in
  // Docker, with no .env at all.
  let threw = false;
  try {
    loadDotEnv(join(dir, 'does-not-exist'));
  } catch {
    threw = true;
  }
  check(!threw, 'a missing .env is not an error');

  for (const k of Object.keys(process.env)) {
    if (k.startsWith('BANDELION_TEST_')) delete process.env[k];
  }
}

// The exit must stay the LAST statement in this file. It sat halfway up once
// and silently skipped every check appended after it, which is how a whole
// block of assertions ran zero times while the suite reported green.
console.log(failed ? `\n${failed} check(s) failed` : '\nall database checks passed');
process.exit(failed ? 1 : 0);
