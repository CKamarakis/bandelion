/**
 * Whether a Spotify account is connected, for the UI to render against.
 *
 * Reports the stored grant only. It deliberately does not call Spotify: a
 * status endpoint that makes a network request turns a page load into an
 * upstream dependency, and the 403 allowlist case is better surfaced when the
 * roster is actually fetched.
 */

import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../config.ts';
import { loadTokens } from '../../../../db/index.ts';
import { LOCAL_USER_ID, db } from '../../../../auth/session.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = loadConfig();
  const configured = Boolean(cfg.spotify.clientId && cfg.spotify.clientSecret);

  let connected = false;
  let scope: string | null = null;
  try {
    const tokens = loadTokens(db(), LOCAL_USER_ID, 'spotify');
    connected = tokens !== null;
    scope = tokens?.scope ?? null;
  } catch (err) {
    // A missing or unreadable database is a setup problem, not a crash. The
    // page still renders and says what is wrong.
    console.error('[auth/status] could not read tokens:', err);
  }

  return NextResponse.json({ configured, connected, scope });
}
