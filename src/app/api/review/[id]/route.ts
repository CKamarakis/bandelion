/**
 * One decision from the review queue.
 *
 * POST `{ mbid }` to accept that candidate, or `{ reject: true }` to say none
 * of them is the artist. Exactly one of the two, because "accepted this one
 * and also rejected the row" is not a thing a reader can mean.
 *
 * No GET: the queue travels with the page that renders it, so a client that
 * wanted to read a row already has it.
 */

import { NextResponse } from 'next/server';
import { LOCAL_USER_ID, db } from '../../../../auth/session.ts';
import { confirmReviewMatch, getReviewQueue, rejectReviewMatch } from '../../../../db/index.ts';
import { normalizeName } from '../../../../matcher/normalize.ts';

export const dynamic = 'force-dynamic';

/**
 * A MusicBrainz id, which is a UUID.
 *
 * Checked rather than trusted: this value is written onto an artist row and
 * then used to fetch release-groups, so a malformed one becomes a permanently
 * broken artist that looks resolved. Cheaper to reject here.
 */
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queueId = Number(id);
  // Number('') is 0 and Number('abc') is NaN: both must fail here rather than
  // reaching SQLite as a binding that quietly matches nothing.
  if (!Number.isInteger(queueId) || queueId <= 0) {
    return NextResponse.json({ error: 'bad_queue_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }

  const { mbid, reject } = body as { mbid?: unknown; reject?: unknown };

  if (reject !== undefined && typeof reject !== 'boolean') {
    return NextResponse.json({ error: 'bad_reject' }, { status: 400 });
  }
  if (mbid !== undefined && typeof mbid !== 'string') {
    return NextResponse.json({ error: 'bad_mbid' }, { status: 400 });
  }
  if (reject === true && mbid !== undefined) {
    return NextResponse.json({ error: 'ambiguous_decision' }, { status: 400 });
  }

  const database = db();

  /*
   * Read the row back rather than trusting the body's mbid.
   *
   * The accepted id has to be one of the candidates actually recorded for this
   * row. Writing whatever arrived would let a stale tab — or a typo — attach
   * an unrelated MusicBrainz act to an artist, which then fetches somebody
   * else's releases into the feed with nothing to show it was wrong.
   */
  const row = getReviewQueue(database, LOCAL_USER_ID).find((r) => r.queueId === queueId);
  if (!row) {
    return NextResponse.json({ error: 'unknown_or_decided' }, { status: 404 });
  }

  if (reject === true) {
    rejectReviewMatch(database, queueId);
    return NextResponse.json({ ok: true, decision: 'rejected' });
  }

  if (typeof mbid !== 'string' || !MBID.test(mbid)) {
    return NextResponse.json({ error: 'bad_mbid' }, { status: 400 });
  }
  if (!row.candidates.some((c) => c.mbid.toLowerCase() === mbid.toLowerCase())) {
    return NextResponse.json({ error: 'not_a_candidate' }, { status: 400 });
  }

  try {
    /*
     * The alias is keyed on the name as Spotify gave it, normalised the same
     * way the matcher normalises everything else. That is what makes the
     * decision reusable: the next source to report this name matches without
     * asking again.
     */
    confirmReviewMatch(database, queueId, row.artistId, mbid, normalizeName(row.rawName));
  } catch (err) {
    console.error('[review] write failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, decision: 'confirmed', mbid });
}
