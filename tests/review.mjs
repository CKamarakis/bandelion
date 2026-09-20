/**
 * The review queue: the query, and the route that decides a row.
 *
 * The real handler from src/app/api/review/[id]/, called directly. No server,
 * no network.
 *
 * The assertions that matter:
 *  - a queued row carries BOTH sides of the comparison, because a row without
 *    the Spotify id is a question you cannot check before answering
 *  - an mbid that is not one of the row's own candidates is refused, so a
 *    stale tab cannot attach an unrelated act to an artist
 *  - confirming writes the alias, which is what stops the same name being
 *    asked about again
 *  - a decided row leaves the queue, and the count follows it
 */

import { normalizeName } from '../src/matcher/normalize.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

process.env.SPOTIFY_CLIENT_ID = 'fake-id';
process.env.SPOTIFY_CLIENT_SECRET = 'fake-secret';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_PATH = ':memory:';

const { POST } = await import('../src/app/api/review/[id]/route.ts');
const { db: getDb } = await import('../src/auth/session.ts');
const {
  upsertArtist,
  followArtist,
  queueForReview,
  getReviewQueue,
  getReviewCount,
  getAliases,
} = await import('../src/db/index.ts');

const db = getDb();
const USER = 1;

const MBID_A = '11111111-2222-3333-4444-555555555555';
const MBID_B = '66666666-7777-8888-9999-000000000000';
const MBID_C = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SPOTIFY_ID = '62hFQUkqSQ2LxYFBVuvjKg';

/* Two acts called Steak, which is the real case this page exists for. */
const artistId = upsertArtist(db, {
  name: 'Steak',
  nameNormalized: normalizeName('Steak'),
  externalId: { source: 'spotify', id: SPOTIFY_ID },
});
followArtist(db, USER, artistId, 'spotify');

const payload = JSON.stringify({
  method: 'name-search',
  candidates: [
    { mbid: MBID_A, name: 'Steak', score: 100, disambiguation: 'UK stoner rock band' },
    { mbid: MBID_B, name: 'Steak', score: 95, disambiguation: 'German melodic hard-rock band' },
  ],
});

const queueId = queueForReview(db, {
  rawName: 'Steak',
  source: 'musicbrainz',
  candidateArtistId: artistId,
  score: 1,
  payload,
});

const post = (id, body) =>
  POST(new Request('http://localhost/api/review/' + id, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  });

// ─── the query ──────────────────────────────────────────────────────────────

let rows = getReviewQueue(db, USER);
check(rows.length === 1, 'the queued artist is in the review list');
check(rows[0].rawName === 'Steak', 'the row carries the name as Spotify gave it');
check(
  rows[0].spotifyId === SPOTIFY_ID,
  'the row carries the Spotify id, so you can hear yours before deciding',
);
check(rows[0].followed === true, 'the row says which list it came from');
check(rows[0].candidates.length === 2, 'both candidates are on the row');
check(
  rows[0].candidates[0].disambiguation === 'UK stoner rock band',
  'the disambiguation is kept: it is usually the deciding fact',
);
check(getReviewCount(db) === 1, 'the count agrees with the list');

// ─── the route rejects what it should ───────────────────────────────────────

check((await post('abc', { reject: true })).status === 400, 'a non-numeric id is refused');
check((await post(queueId, {})).status === 400, 'a body naming no decision is refused');
check(
  (await post(queueId, { mbid: 'not-a-uuid' })).status === 400,
  'an mbid that is not a uuid is refused',
);
check(
  (await post(queueId, { mbid: MBID_A, reject: true })).status === 400,
  'accepting and rejecting at once is refused',
);
/*
 * The one that protects the data. A well-formed mbid that was never a
 * candidate for THIS row would otherwise attach a stranger's releases to the
 * artist, and nothing on the feed would show it was wrong.
 */
check(
  (await post(queueId, { mbid: '99999999-9999-9999-9999-999999999999' })).status === 400,
  'an mbid that is not one of this row\'s candidates is refused',
);
check(getReviewCount(db) === 1, 'no refused request decided the row');

// ─── confirming ─────────────────────────────────────────────────────────────

const ok = await post(queueId, { mbid: MBID_A });
check(ok.status === 200, 'picking a candidate is accepted');

rows = getReviewQueue(db, USER);
check(rows.length === 0, 'a decided row leaves the queue');
check(getReviewCount(db) === 0, 'the count follows the decision');

const aliases = getAliases(db);
check(
  aliases.some((a) => a.artistId === artistId && a.aliasNormalized === normalizeName('Steak')),
  'confirming writes the alias, so the name is not asked about twice',
);

check(
  (await post(queueId, { mbid: MBID_B })).status === 404,
  'a row already decided cannot be decided again',
);

// ─── a resolved artist leaves the queue behind ──────────────────────────────

{
  /*
   * The bug this catches shipped and was invisible.
   *
   * Triage resolves artists an earlier run had queued. It set the MBID and
   * left the old row `pending`, so the first real run finished with 206 rows
   * claiming to await a decision that had already been made. Nothing on screen
   * showed it, because both review queries join on `mbid IS NULL` — the table
   * was simply lying, quietly, to anything that read it directly.
   */
  const queued = upsertArtist(db, {
    name: 'Mount Hush',
    nameNormalized: normalizeName('Mount Hush'),
    externalId: { source: 'spotify', id: '13clfeXxTPsDsqzSlLIBZJ' },
  });
  followArtist(db, USER, queued, 'spotify');
  const staleRow = queueForReview(db, {
    rawName: 'Mount Hush',
    source: 'musicbrainz',
    candidateArtistId: queued,
    score: 1,
    payload: JSON.stringify({ candidates: [{ mbid: MBID_C, name: 'Mount Hush', score: 100, disambiguation: '' }] }),
  });

  check(getReviewCount(db) === 1, 'the artist is queued before it is resolved');

  // What resolveOne does when triage accepts: set the id, then close the row.
  const { closeQueueForResolved } = await import('../src/db/index.ts');
  db.prepare('UPDATE artists SET mbid = ? WHERE id = ?').run(MBID_C, queued);
  closeQueueForResolved(db, queued);

  const row = db.prepare('SELECT status FROM match_queue WHERE id = ?').get(staleRow);
  check(
    row.status === 'confirmed',
    'resolving an artist closes its pending queue row rather than leaving it',
    `status is ${row.status}`,
  );
  check(getReviewCount(db) === 0, 'and the count agrees');
}

// ─── rejecting ──────────────────────────────────────────────────────────────

const other = upsertArtist(db, {
  name: 'Ziggy Was',
  nameNormalized: normalizeName('Ziggy Was'),
  externalId: { source: 'spotify', id: '5XCGXSCkTReAcfa10ectlT' },
});
followArtist(db, USER, other, 'spotify');
const otherQueue = queueForReview(db, {
  rawName: 'Ziggy Was',
  source: 'musicbrainz',
  candidateArtistId: other,
  score: 1,
  payload: JSON.stringify({ candidates: [{ mbid: MBID_B, name: 'Ziggy Was', score: 100, disambiguation: '' }] }),
});

check(getReviewCount(db) === 1, 'the second artist is queued');
check((await post(otherQueue, { reject: true })).status === 200, '"none of these" is accepted');
check(getReviewCount(db) === 0, 'a rejected row leaves the queue too');
/*
 * Rejection must not resolve the artist. A rejected row means "we do not know
 * which act this is", and an artist that came out of it with an MBID would be
 * carrying a match nobody chose.
 */
const stillUnresolved = db.prepare('SELECT mbid FROM artists WHERE id = ?').get(other);
check(stillUnresolved.mbid === null, 'rejecting leaves the artist unresolved rather than guessing');

console.log(failed === 0 ? '\nall review checks passed' : `\nreview: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
