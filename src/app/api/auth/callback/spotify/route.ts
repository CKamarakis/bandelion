/**
 * The Spotify OAuth callback.
 *
 * This path is registered on the Spotify app as the Redirect URI and must match
 * SPOTIFY_REDIRECT_URI byte for byte, or Spotify refuses the exchange.
 *
 * Order matters: validate state before touching the code. A callback arriving
 * without a matching state cookie is either CSRF or a stale tab, and in neither
 * case should its code be exchanged.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '../../../../../config.ts';
import { exchangeCode, statesMatch } from '../../../../../auth/spotify.ts';
import { encryptToken, loadKey } from '../../../../../auth/crypto.ts';
import { saveTokens } from '../../../../../db/index.ts';
import {
  LOCAL_USER_ID,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  db,
} from '../../../../../auth/session.ts';

export const dynamic = 'force-dynamic';

/** Send the user back to a page that explains what happened, not to raw JSON. */
function fail(req: NextRequest, reason: string) {
  const url = new URL('/', req.url);
  url.searchParams.set('auth_error', reason);
  const res = NextResponse.redirect(url);
  // The transient cookies are spent either way; leaving them makes the next
  // attempt fail against a stale state.
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const cfg = loadConfig();
  const params = req.nextUrl.searchParams;

  // The user pressed Cancel on the consent screen. Not an error worth a stack.
  const denied = params.get('error');
  if (denied) return fail(req, denied === 'access_denied' ? 'cancelled' : denied);

  const code = params.get('code');
  if (!code) return fail(req, 'no_code');

  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  const verifier = req.cookies.get(VERIFIER_COOKIE)?.value;

  if (!statesMatch(cookieState, params.get('state') ?? undefined)) {
    return fail(req, 'state_mismatch');
  }
  if (!verifier) return fail(req, 'missing_verifier');

  if (!cfg.spotify.clientId || !cfg.spotify.clientSecret) {
    return fail(req, 'not_configured');
  }

  try {
    const tokens = await exchangeCode({
      code,
      redirectUri: cfg.spotify.redirectUri,
      codeVerifier: verifier,
      clientId: cfg.spotify.clientId,
      clientSecret: cfg.spotify.clientSecret,
    });

    const key = loadKey();
    saveTokens(db(), LOCAL_USER_ID, 'spotify', {
      accessToken: encryptToken(tokens.accessToken, key),
      refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken, key) : null,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
  } catch (err) {
    // Never echo the upstream message into a URL: it can carry request detail.
    console.error('[auth/callback] token exchange failed:', err);
    return fail(req, 'exchange_failed');
  }

  const done = new URL('/', req.url);
  done.searchParams.set('connected', 'spotify');
  const res = NextResponse.redirect(done);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}
