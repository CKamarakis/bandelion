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
  POPUP_COOKIE,
  db,
} from '../../../../../auth/session.ts';

export const dynamic = 'force-dynamic';

/** The three transient cookies are spent once the callback has run. */
function clearOauthCookies(res: NextResponse) {
  // Leaving these makes the next attempt fail against a stale state, which
  // presents as the sign-in link expiring twice in a row.
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  res.cookies.delete(POPUP_COOKIE);
  return res;
}

/**
 * The page a popup lands on: report the outcome to the opener and close.
 *
 * Written as a self-contained document rather than a React route because it
 * exists for a few milliseconds and must work before any bundle loads.
 *
 * `targetOrigin` is this instance's own origin, never '*': a wildcard would
 * broadcast the result to whatever else has a handle on this window.
 *
 * If there is no opener (someone opened the callback URL directly, or the
 * browser severed the reference) it falls back to navigating, so the flow can
 * never dead-end on a blank page.
 */
function popupResult(req: NextRequest, payload: { ok: boolean; reason?: string }) {
  /*
   * The origin comes from the configured redirect URI, not from req.url.
   *
   * Behind Next's dev server req.url can read `localhost` while the browser is
   * on `127.0.0.1`. Those are different origins, so postMessage would be
   * dropped silently and the popup would hang with the opener still waiting.
   * The redirect URI is the one address the browser is guaranteed to be on:
   * Spotify only redirects here if it matched byte for byte.
   */
  const origin = new URL(loadConfig().spotify.redirectUri).origin;
  const target = new URL('/', req.url);
  if (payload.ok) target.searchParams.set('connected', 'spotify');
  else if (payload.reason) target.searchParams.set('auth_error', payload.reason);

  const body = `<!doctype html>
<meta charset="utf-8">
<title>Spotify</title>
<body style="font:14px ui-monospace,monospace;background:#fff;color:#333129;padding:24px">
Finishing sign-in.
<script>
(function () {
  var result = ${JSON.stringify({ type: 'bandelion:oauth', ...payload })};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(result, ${JSON.stringify(origin)});
      window.close();
      return;
    }
  } catch (e) {}
  // No opener to tell: behave like the redirect flow instead of stranding here.
  window.location.replace(${JSON.stringify(target.pathname + target.search)});
})();
</script>
</body>`;

  return clearOauthCookies(
    new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // This page carries an auth outcome; it must never be cached.
        'cache-control': 'no-store',
      },
    }),
  );
}

/** Send the user back to a page that explains what happened, not to raw JSON. */
function fail(req: NextRequest, reason: string) {
  if (req.cookies.get(POPUP_COOKIE)?.value === '1') {
    return popupResult(req, { ok: false, reason });
  }
  const url = new URL('/', req.url);
  url.searchParams.set('auth_error', reason);
  return clearOauthCookies(NextResponse.redirect(url));
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

  if (req.cookies.get(POPUP_COOKIE)?.value === '1') {
    return popupResult(req, { ok: true });
  }

  const done = new URL('/', req.url);
  done.searchParams.set('connected', 'spotify');
  return clearOauthCookies(NextResponse.redirect(done));
}
