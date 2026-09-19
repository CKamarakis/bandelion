/**
 * The flag-writing route, exercised in process.
 *
 * The real handler from src/app/api/events/[id]/state/, called directly. No
 * server, no network: the suite cannot fail because a port was busy.
 *
 * The assertions that matter: a bad id or a non-boolean flag is rejected rather
 * than written, a partial body writes only the keys it names, and an unknown
 * event is a 404 rather than a 500 or a row pointing at nothing.
 */

import { openDatabase } from '../src/db/index.ts';
import { normalizeName } from '../src/matcher/normalize.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

/*
 * The handler reads config and the database through module-level helpers, so
 * the environment has to be set before it is imported.
 */
process.env.SPOTIFY_CLIENT_ID = 'fake-id';
process.env.SPOTIFY_CLIENT_SECRET = 'fake-secret';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_PATH = ':memory:';

const { POST } = await import('../src/app/api/events/[id]/state/route.ts');
const { db: getDb } = await import('../src/auth/session.ts');
const { upsertArtist, insertReleaseEvent } = await import('../src/db/index.ts');

const db = getDb();

const artistId = upsertArtist(db, {
  name: 'Yard Act',
  nameNormalized: normalizeName('Yard Act'),
});
insertReleaseEvent(db, {
  artistId,
  title: 'Dream Job',
  eventDate: '2026-10-02',
  datePrecision: 'day',
  releaseType: 'single',
  sourceEventId: 'rg-yard-1',
  sourceUrl: null,
  payload: null,
  isUpcoming: true,
});
const eventId = db.prepare('SELECT id FROM events').get().id;

/** Call the handler the way Next would, with the id as a route param. */
const post = (id, body) =>
  POST(
    new Request(`http://127.0.0.1:3000/api/events/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

/** The stored row, or undefined when nothing has been written. */
const stored = () =>
  db
    .prepare('SELECT queued, listened, favorited FROM event_state WHERE event_id = ?')
    .get(eventId);

// --- The happy path ----------------------------------------------------------

{
  const res = await post(eventId, { queued: true });
  check(res.status === 200, 'saving returns 200', `got ${res.status}`);
  const body = await res.json();
  check(body.ok === true, 'the response confirms the write');
  check(stored()?.queued === 1, 'the flag is in the database');
  check(stored()?.listened === 0, 'a flag the body did not name stays off');
}

// --- A partial body leaves the other flags alone -----------------------------
// The client sends one flag per toggle, so this is the normal case rather than
// an edge one.

{
  await post(eventId, { listened: true });
  const row = stored();
  check(
    row.queued === 1 && row.listened === 1,
    'writing one flag does not clear another',
    `got ${JSON.stringify(row)}`,
  );

  await post(eventId, { favorited: true });
  await post(eventId, { favorited: false });
  const after = stored();
  check(
    after.queued === 1 && after.listened === 1 && after.favorited === 0,
    'un-hearting through the route leaves the playlist and the tick intact',
    `got ${JSON.stringify(after)}`,
  );
}

// --- Rejected input ----------------------------------------------------------

{
  const res = await post('abc', { queued: true });
  check(res.status === 400, 'a non-numeric id is rejected', `got ${res.status}`);
}

{
  const res = await post('0', { queued: true });
  check(res.status === 400, 'a zero id is rejected', `got ${res.status}`);
}

{
  const res = await post('-5', { queued: true });
  check(res.status === 400, 'a negative id is rejected', `got ${res.status}`);
}

{
  /*
   * The string "false" is truthy in JavaScript. A handler doing `Boolean(value)`
   * would turn a flag ON here, which makes a toggle impossible to switch off —
   * so the type check has to be strict rather than coercive.
   */
  const res = await post(eventId, { queued: 'false' });
  check(res.status === 400, 'a string in place of a boolean is rejected', `got ${res.status}`);
  const body = await res.json();
  check(body.detail === 'queued', 'the rejection names the offending flag');
}

{
  const res = await post(eventId, { queued: 1 });
  check(res.status === 400, 'a number in place of a boolean is rejected', `got ${res.status}`);
}

{
  const res = await post(eventId, {});
  check(res.status === 400, 'a body naming no flags is rejected', `got ${res.status}`);
}

{
  /*
   * An unknown key must not be a silent no-op that reports success: the caller
   * would believe a write happened. With no recognised flag in the body this is
   * the same case as an empty one.
   */
  const res = await post(eventId, { dismissed: true });
  check(
    res.status === 400,
    'a body naming only unwritable flags is rejected',
    `got ${res.status}`,
  );
}

{
  const res = await post(eventId, 'not json at all');
  check(res.status === 400, 'a malformed body is rejected', `got ${res.status}`);
}

// --- An event that does not exist -------------------------------------------
// The foreign key is what catches this, so the check also proves foreign keys
// are actually on: without the PRAGMA this would write an orphan row and 200.

{
  const res = await post(999999, { queued: true });
  check(res.status === 404, 'an unknown event id is a 404', `got ${res.status}`);
  const orphans = db
    .prepare('SELECT COUNT(*) AS n FROM event_state WHERE event_id = 999999')
    .get();
  check(orphans.n === 0, 'no row is written for an event that does not exist');
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall state route checks passed');
