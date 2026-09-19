/**
 * The flags you set on a release: on the playlist, listened, liked.
 *
 * POST with any subset of them. Only the keys present in the body are written,
 * so the heart and the tick cannot clobber each other — the client sends one
 * flag per toggle and the other two keep whatever they had.
 *
 * No GET: the flags travel with every feed row already (see getFeed), so a
 * client that wanted to read one has the answer before it could ask.
 */

import { NextResponse } from 'next/server';
import { LOCAL_USER_ID, db } from '../../../../../auth/session.ts';
import { setEventFlags, type EventFlags } from '../../../../../db/index.ts';

export const dynamic = 'force-dynamic';

/** The three writable flags. Anything else in the body is ignored. */
const FLAGS = ['queued', 'listened', 'favorited'] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const eventId = Number(id);
  // Number('') is 0 and Number('abc') is NaN: both have to fail here rather
  // than reaching SQLite as a binding that quietly matches nothing.
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: 'bad_event_id' }, { status: 400 });
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

  /*
   * Booleans only, and only these three names.
   *
   * A truthy check would let "false" — the string — turn a flag on, which is
   * exactly the kind of bug that makes a toggle un-untoggleable.
   */
  const flags: EventFlags = {};
  for (const name of FLAGS) {
    const value = (body as Record<string, unknown>)[name];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      return NextResponse.json({ error: 'bad_flag', detail: name }, { status: 400 });
    }
    flags[name] = value;
  }

  if (Object.keys(flags).length === 0) {
    return NextResponse.json({ error: 'no_flags' }, { status: 400 });
  }

  try {
    setEventFlags(db(), LOCAL_USER_ID, eventId, flags);
  } catch (err) {
    /*
     * The foreign key on event_state means an unknown event id lands here
     * rather than writing a row that points at nothing. Reported as 404
     * because that is what it is: the id does not exist.
     */
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('FOREIGN KEY')) {
      return NextResponse.json({ error: 'unknown_event' }, { status: 404 });
    }
    console.error('[events/state] write failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, flags });
}
