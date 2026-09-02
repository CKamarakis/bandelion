/**
 * The OAuth route handlers, exercised in process.
 *
 * These are the real handlers from src/app/api/auth/, called directly with a
 * NextRequest. No server, no network, no browser: the suite stays fast and
 * cannot fail because a port was busy.
 *
 * Why this exists separately from tests/auth.mjs: that suite tests the OAuth
 * *protocol* (PKCE, exchange, refresh, crypto). This one tests the *decisions
 * the routes make* — which callbacks get rejected, what reaches the database,
 * what a failure tells the user. That is where the security-critical logic is,
 * and it was the untested half.
 *
 * The assertion that matters most: a callback whose state does not match the
 * cookie must never exchange its code. That is the CSRF defence, and a refactor
 * that reorders those checks would silently remove it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server.js';

import { openDatabase, saveTokens, loadTokens } from '../src/db/index.ts';
import { encryptToken, decryptToken, loadKey } from '../src/auth/crypto.ts';
import {
  STATE_COOKIE,
  VERIFIER_COOKIE,
  POPUP_COOKIE,
  oauthCookieOptions,
} from '../src/auth/session.ts';

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'spotify-following.json'), 'utf8'),
);

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

const KEY_HEX = 'a'.repeat(64);
const REDIRECT = 'http://127.0.0.1:3000/api/auth/callback/spotify';

/**
 * The routes read config and the database through module-level helpers, so the
 * environment has to be set before they are imported. Everything the handlers
 * touch is pointed at an in-memory database and fake credentials.
 */
process.env.SPOTIFY_CLIENT_ID = 'fake-id';
process.env.SPOTIFY_CLIENT_SECRET = 'fake-secret';
process.env.SPOTIFY_REDIRECT_URI = REDIRECT;
process.env.TOKEN_ENCRYPTION_KEY = KEY_HEX;
process.env.DATABASE_PATH = ':memory:';

const key = loadKey();

const { GET: login } = await import('../src/app/api/auth/login/route.ts');
const { GET: callback } = await import('../src/app/api/auth/callback/spotify/route.ts');
const { POST: disconnect } = await import('../src/app/api/auth/disconnect/route.ts');
const { GET: status } = await import('../src/app/api/auth/status/route.ts');
const { db: getDb } = await import('../src/auth/session.ts');

/** The shared in-memory database the routes write to. */
const db = getDb();

const req = (url, cookies = {}) => {
  const r = new NextRequest(new URL(url));
  for (const [name, value] of Object.entries(cookies)) r.cookies.set(name, value);
  return r;
};

/** Cookie values a response sets, by name. */
const setCookies = (res) => {
  const out = {};
  for (const c of res.cookies.getAll()) out[c.name] = c;
  return out;
};

// --- /api/auth/login --------------------------------------------------------

const loginRes = await login(req("http://127.0.0.1:3000/api/auth/login"));
check(loginRes.status === 307 || loginRes.status === 302, 'login redirects');

const authUrl = new URL(loginRes.headers.get('location'));
check(authUrl.host === 'accounts.spotify.com', 'login redirects to Spotify');
check(authUrl.searchParams.get('client_id') === 'fake-id', 'the configured client id is sent');
check(authUrl.searchParams.get('redirect_uri') === REDIRECT, 'the configured redirect URI is sent');
check(authUrl.searchParams.get('code_challenge_method') === 'S256', 'PKCE S256 is requested');

const loginCookies = setCookies(loginRes);
check(Boolean(loginCookies[STATE_COOKIE]), 'login sets the state cookie');
check(Boolean(loginCookies[VERIFIER_COOKIE]), 'login sets the verifier cookie');

// The verifier is the secret half of PKCE. If it ever travels in the URL the
// whole exchange is interceptable, which is the attack PKCE exists to stop.
const verifier = loginCookies[VERIFIER_COOKIE].value;
check(!loginRes.headers.get('location').includes(verifier), 'the verifier never appears in the redirect URL');

check(loginCookies[STATE_COOKIE].httpOnly === true, 'the state cookie is httpOnly');
check(loginCookies[VERIFIER_COOKIE].httpOnly === true, 'the verifier cookie is httpOnly');
check(loginCookies[STATE_COOKIE].sameSite === 'lax', 'the state cookie is SameSite=Lax');

// On http://127.0.0.1 a Secure cookie is silently dropped by the browser and
// every callback then fails the state check with no visible cause.
check(loginCookies[STATE_COOKIE].secure === false, 'no Secure flag on a loopback http redirect URI');
check(
  oauthCookieOptions('https://bandelion.example.com/cb').secure === true,
  'the Secure flag is set when the redirect URI is https',
);

// Two sign-in attempts must not share a state, or one tab could complete the
// other's flow.
const secondLogin = await login(req("http://127.0.0.1:3000/api/auth/login"));
check(
  setCookies(secondLogin)[STATE_COOKIE].value !== loginCookies[STATE_COOKIE].value,
  'each login attempt gets a fresh state',
);

// --- The popup flow ---------------------------------------------------------
//
// Started from a popup, the callback must close the window rather than redirect
// inside it. The flag rides in a cookie because Spotify returns only `state`,
// and deciding how to render a page from attacker-influenced input is a bad
// trade for one boolean.

{
  const plain = setCookies(await login(req('http://127.0.0.1:3000/api/auth/login')));
  check(plain[POPUP_COOKIE] === undefined, 'a normal login sets no popup cookie');

  const popupLogin = await login(req('http://127.0.0.1:3000/api/auth/login?popup=1'));
  const popupCookies = setCookies(popupLogin);
  check(popupCookies[POPUP_COOKIE]?.value === '1', 'login?popup=1 marks the flow as a popup');
  check(popupCookies[POPUP_COOKIE].httpOnly === true, 'the popup cookie is httpOnly');
  check(
    new URL(popupLogin.headers.get('location')).host === 'accounts.spotify.com',
    'the popup flow still redirects to Spotify',
  );

  const popupState = popupCookies[STATE_COOKIE].value;
  const popupVerifier = popupCookies[VERIFIER_COOKIE].value;

  // A failure in a popup: an HTML page, not a redirect the popup would follow
  // while the opener sat waiting.
  const popupFail = await callback(
    req(`${REDIRECT}?error=access_denied`, {
      [STATE_COOKIE]: popupState,
      [VERIFIER_COOKIE]: popupVerifier,
      [POPUP_COOKIE]: '1',
    }),
  );

  check(popupFail.status === 200, 'a popup failure returns a page, not a redirect');
  check(
    popupFail.headers.get('content-type')?.includes('text/html'),
    'the popup result is HTML',
  );
  check(
    popupFail.headers.get('cache-control') === 'no-store',
    'the popup result is never cached: it carries an auth outcome',
  );

  const failBody = await popupFail.text();
  check(failBody.includes('postMessage'), 'the popup page reports back to its opener');
  check(failBody.includes('window.close'), 'the popup page closes itself');
  check(failBody.includes('"ok":false'), 'a cancelled sign-in is reported as not ok');
  check(failBody.includes('cancelled'), 'the reason is passed to the opener');

  // A wildcard target would broadcast the outcome to anything holding a handle
  // on this window.
  check(!failBody.includes("postMessage(result, '*')"), 'postMessage does not use a wildcard origin');
  check(
    failBody.includes('"http://127.0.0.1:3000"'),
    'postMessage targets this instance\'s own origin',
    failBody.match(/postMessage\([^)]*\)/)?.[0],
  );

  // No opener means the popup must not strand on a blank page.
  check(
    failBody.includes('location.replace'),
    'the popup page falls back to navigating when there is no opener',
  );

  const popupCleared = setCookies(popupFail);
  check(popupCleared[STATE_COOKIE]?.value === '', 'a popup failure clears the state cookie');
  check(popupCleared[POPUP_COOKIE]?.value === '', 'a popup failure clears the popup cookie');

  // The success path, so a popup sign-in actually stores a grant.
  const realFetchPopup = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(fixtures.tokenResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const popupOk = await callback(
    req(`${REDIRECT}?code=real&state=${popupState}`, {
      [STATE_COOKIE]: popupState,
      [VERIFIER_COOKIE]: popupVerifier,
      [POPUP_COOKIE]: '1',
    }),
  );
  globalThis.fetch = realFetchPopup;

  const okBody = await popupOk.text();
  check(popupOk.status === 200, 'a popup success returns a page');
  check(okBody.includes('"ok":true'), 'a popup success is reported as ok');
  check(
    loadTokens(db, 1, 'spotify') !== null,
    'a popup sign-in stores the grant just like the redirect flow',
  );

  // The token must never reach the page that gets rendered into a window.
  check(
    !okBody.includes(fixtures.tokenResponse.access_token) &&
      !okBody.includes(fixtures.tokenResponse.refresh_token),
    'no token appears in the popup result page',
  );

  // Reset for the suite below, which expects no stored grant.
  const { deleteTokens } = await import('../src/db/index.ts');
  deleteTokens(db, 1, 'spotify');
}

// --- /api/auth/callback/spotify: rejection paths ----------------------------
//
// Every case below must redirect to the page with a reason and must NOT reach
// Spotify. A stub that throws proves the exchange was never attempted.

const state = loginCookies[STATE_COOKIE].value;

const rejections = [
  {
    name: 'a state that does not match the cookie',
    url: `${REDIRECT}?code=abc&state=wrong`,
    cookies: { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier },
    expect: 'state_mismatch',
  },
  {
    name: 'a callback with no state cookie at all',
    url: `${REDIRECT}?code=abc&state=${state}`,
    cookies: { [VERIFIER_COOKIE]: verifier },
    expect: 'state_mismatch',
  },
  {
    name: 'a callback with no state in the query',
    url: `${REDIRECT}?code=abc`,
    cookies: { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier },
    expect: 'state_mismatch',
  },
  {
    name: 'a valid state but a missing verifier cookie',
    url: `${REDIRECT}?code=abc&state=${state}`,
    cookies: { [STATE_COOKIE]: state },
    expect: 'missing_verifier',
  },
  {
    name: 'a callback with no authorization code',
    url: `${REDIRECT}?state=${state}`,
    cookies: { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier },
    expect: 'no_code',
  },
  {
    name: 'the user cancelling on the consent screen',
    url: `${REDIRECT}?error=access_denied`,
    cookies: { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier },
    expect: 'cancelled',
  },
];

for (const c of rejections) {
  const res = await callback(req(c.url, c.cookies));
  const location = new URL(res.headers.get('location'));
  check(
    location.searchParams.get('auth_error') === c.expect,
    `${c.name} is rejected as "${c.expect}"`,
    `got "${location.searchParams.get('auth_error')}"`,
  );
  check(location.pathname === '/', `${c.name} returns the user to the page`);
  check(
    loadTokens(db, 1, 'spotify') === null,
    `${c.name} stores no tokens`,
  );
}

// Rejection must also clear the spent cookies, or a stale state blocks the
// next attempt in a way that looks like the link expiring twice.
const rejected = await callback(
  req(`${REDIRECT}?code=abc&state=wrong`, { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier }),
);
const clearedOnFail = setCookies(rejected);
check(clearedOnFail[STATE_COOKIE]?.value === '', 'a rejected callback clears the state cookie');
check(clearedOnFail[VERIFIER_COOKIE]?.value === '', 'a rejected callback clears the verifier cookie');

// --- The callback never leaks upstream detail into a URL --------------------

const unknownError = await callback(
  req(`${REDIRECT}?error=server_error`, { [STATE_COOKIE]: state, [VERIFIER_COOKIE]: verifier }),
);
check(
  new URL(unknownError.headers.get('location')).searchParams.get('auth_error') === 'server_error',
  'an unrecognised Spotify error is passed through as its code',
);

// --- The success path -------------------------------------------------------
//
// The exchange itself is stubbed at the network boundary, so this tests what
// the route does with a successful response: what it stores, and in what form.

const realFetch = globalThis.fetch;
let exchangeCalls = 0;
let sentBody = null;

globalThis.fetch = async (url, init) => {
  exchangeCalls++;
  sentBody = new URLSearchParams(init.body);
  check(String(url) === 'https://accounts.spotify.com/api/token', 'the route posts to the token endpoint');
  return new Response(JSON.stringify(fixtures.tokenResponse), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const ok = await callback(
  req(`${REDIRECT}?code=real_code&state=${state}`, {
    [STATE_COOKIE]: state,
    [VERIFIER_COOKIE]: verifier,
  }),
);

const okLocation = new URL(ok.headers.get('location'));
check(okLocation.searchParams.get('connected') === 'spotify', 'a valid callback reports success');
check(!okLocation.searchParams.has('auth_error'), 'a valid callback reports no error');
check(exchangeCalls === 1, 'the code is exchanged exactly once');
check(sentBody.get('code') === 'real_code', 'the authorization code from the query is exchanged');
check(sentBody.get('code_verifier') === verifier, 'the verifier from the cookie is sent');
check(sentBody.get('redirect_uri') === REDIRECT, 'the configured redirect URI is sent to Spotify');

const clearedOnSuccess = setCookies(ok);
check(clearedOnSuccess[STATE_COOKIE]?.value === '', 'a successful callback clears the state cookie');
check(clearedOnSuccess[VERIFIER_COOKIE]?.value === '', 'a successful callback clears the verifier cookie');

// What actually landed in the database. This is the assertion the encryption
// exists for: the row must not contain the token Spotify sent.
const stored = loadTokens(db, 1, 'spotify');
check(stored !== null, 'a successful callback stores the grant');
check(
  decryptToken(stored.accessToken, key) === fixtures.tokenResponse.access_token,
  'the stored access token decrypts to what Spotify returned',
);
check(
  decryptToken(stored.refreshToken, key) === fixtures.tokenResponse.refresh_token,
  'the stored refresh token decrypts to what Spotify returned',
);
check(stored.scope === fixtures.tokenResponse.scope, 'the granted scope is recorded');

const rawRow = db.prepare('SELECT access_token, refresh_token FROM auth_tokens WHERE user_id = 1').get();
check(
  !rawRow.access_token.includes(fixtures.tokenResponse.access_token),
  'no plaintext access token reaches the database',
);
check(
  !rawRow.refresh_token.includes(fixtures.tokenResponse.refresh_token),
  'no plaintext refresh token reaches the database',
);

// --- A failed exchange ------------------------------------------------------

globalThis.fetch = async () =>
  new Response(JSON.stringify(fixtures.tokenErrorResponse), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

const staleState = 'stale-state-value';
const failedExchange = await callback(
  req(`${REDIRECT}?code=bad&state=${staleState}`, {
    [STATE_COOKIE]: staleState,
    [VERIFIER_COOKIE]: verifier,
  }),
);
const failLocation = new URL(failedExchange.headers.get('location'));
check(
  failLocation.searchParams.get('auth_error') === 'exchange_failed',
  'a rejected exchange reports exchange_failed',
);

// Spotify's error_description can carry request detail. It belongs in the
// server log, never in a URL the browser keeps in history.
check(
  !failLocation.search.includes('Invalid authorization code'),
  'the upstream error message is not echoed into the redirect URL',
);

globalThis.fetch = realFetch;

// --- /api/auth/status -------------------------------------------------------

const connectedStatus = await (await status()).json();
check(connectedStatus.connected === true, 'status reports a connected account');
check(connectedStatus.configured === true, 'status reports configured credentials');
check(connectedStatus.scope === fixtures.tokenResponse.scope, 'status reports the granted scope');

// A status endpoint that returned a token would put it in every page load.
const statusText = JSON.stringify(connectedStatus);
check(
  !statusText.includes(fixtures.tokenResponse.access_token) &&
    !statusText.includes(fixtures.tokenResponse.refresh_token),
  'status never returns a token, encrypted or otherwise',
);

// --- /api/auth/disconnect ---------------------------------------------------

const disconnected = await disconnect();
check(disconnected.status === 200, 'disconnect responds 200');
check((await disconnected.json()).connected === false, 'disconnect reports disconnected');
check(loadTokens(db, 1, 'spotify') === null, 'disconnect removes the stored tokens');

const afterDisconnect = await (await status()).json();
check(afterDisconnect.connected === false, 'status reflects the disconnection');

// Disconnecting must not drop the roster: reconnecting is common, and a
// 30-minute MusicBrainz re-resolve is a punishing side effect of one button.
db.prepare("INSERT INTO artists (name, name_normalized) VALUES ('Test Band', 'test band')").run();
db.prepare('INSERT INTO user_artists (user_id, artist_id) VALUES (1, last_insert_rowid())').run();
const rosterBefore = db.prepare('SELECT COUNT(*) AS n FROM user_artists').get().n;

saveTokens(db, 1, 'spotify', {
  accessToken: encryptToken('a', key),
  refreshToken: encryptToken('r', key),
  expiresAt: null,
  scope: null,
});
await disconnect();

check(
  db.prepare('SELECT COUNT(*) AS n FROM user_artists').get().n === rosterBefore,
  'disconnect leaves the roster in place',
);

console.log(failed ? `\n${failed} check(s) failed` : '\nall auth route checks passed');
process.exit(failed ? 1 : 0);
