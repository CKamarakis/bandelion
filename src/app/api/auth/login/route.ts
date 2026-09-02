/**
 * Starts the Spotify OAuth flow.
 *
 * Generates the PKCE pair and CSRF state, stashes both in httpOnly cookies, and
 * redirects to Spotify. The verifier never leaves the server-set cookie; only
 * its hash travels in the URL.
 */

import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../config.ts';
import { buildAuthorizeUrl, createPkcePair, createState } from '../../../../auth/spotify.ts';
import {
  STATE_COOKIE,
  VERIFIER_COOKIE,
  oauthCookieOptions,
} from '../../../../auth/session.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = loadConfig();

  if (!cfg.spotify.clientId || !cfg.spotify.clientSecret) {
    // A setup error, not an auth failure. Say which file to edit.
    return NextResponse.json(
      {
        error: 'Spotify is not configured',
        detail: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env, then restart.',
      },
      { status: 500 },
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();

  const res = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: cfg.spotify.clientId,
      redirectUri: cfg.spotify.redirectUri,
      state,
      codeChallenge: challenge,
    }),
  );

  const opts = oauthCookieOptions(cfg.spotify.redirectUri);
  res.cookies.set(STATE_COOKIE, state, opts);
  res.cookies.set(VERIFIER_COOKIE, verifier, opts);

  return res;
}
