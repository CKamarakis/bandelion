/**
 * Disconnects the Spotify account by deleting the stored tokens.
 *
 * POST, not GET: a GET would let any page on the internet log you out with an
 * <img> tag, and browsers prefetch GET links.
 *
 * The roster is deliberately left in place. Reconnecting is common (a scope
 * change, an expired grant) and dropping thousands of resolved artists — a
 * ~30-minute MusicBrainz re-resolve — would be a punishing side effect of a
 * button labelled "disconnect".
 */

import { NextResponse } from 'next/server';
import { deleteTokens } from '../../../../db/index.ts';
import { LOCAL_USER_ID, db } from '../../../../auth/session.ts';

export const dynamic = 'force-dynamic';

export async function POST() {
  deleteTokens(db(), LOCAL_USER_ID, 'spotify');
  return NextResponse.json({ connected: false });
}
