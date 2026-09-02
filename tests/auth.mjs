/**
 * OAuth: token encryption, PKCE, the code exchange and the refresh.
 *
 * Every network call is a stub. Nothing here touches accounts.spotify.com — the
 * whole point of the fixture is that this suite keeps passing when Spotify is
 * down, and fails when Spotify's *shape* changes rather than its uptime.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadKey,
  encryptToken,
  decryptToken,
  TokenCryptoError,
} from '../src/auth/crypto.ts';
import {
  createPkcePair,
  createState,
  statesMatch,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  isExpired,
  SPOTIFY_SCOPES,
  SpotifyAuthError,
} from '../src/auth/spotify.ts';
import { openDatabase, saveTokens, loadTokens, deleteTokens } from '../src/db/index.ts';

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

const throws = async (fn, msg) => {
  try {
    await fn();
    check(false, msg, 'expected it to throw, it did not');
  } catch {
    check(true, msg);
  }
};

/** A fetch that never reaches the network and asserts what it was asked for. */
function stubFetch(handler) {
  return async (url, init) => {
    const result = handler(String(url), init ?? {});
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      headers: new Headers(result.headers ?? {}),
      async text() {
        return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      },
      async json() {
        return typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
      },
    };
  };
}

// --- Token encryption -------------------------------------------------------

const KEY_HEX = 'a'.repeat(64);
const key = loadKey({ TOKEN_ENCRYPTION_KEY: KEY_HEX });

check(key.length === 32, 'loadKey returns a 32-byte key');

const secret = 'AQBv8example_refresh_token_value_here';
const sealed = encryptToken(secret, key);

check(sealed !== secret, 'encryptToken does not return the plaintext');
check(!sealed.includes(secret), 'ciphertext does not contain the plaintext');
check(sealed.startsWith('v1.'), 'stored format is version-prefixed');
check(decryptToken(sealed, key) === secret, 'round-trips back to the original');
check(encryptToken(secret, key) !== sealed, 'a fresh IV each time: same input, different output');

// The reason for GCM. A silently-mangled token would be sent to Spotify as if
// it were real, and the resulting 400 would be blamed on the wrong thing.
const parts = sealed.split('.');
const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64url')].join('.');
try {
  decryptToken(tampered, key);
  check(false, 'tampered ciphertext is rejected');
} catch (e) {
  check(e instanceof TokenCryptoError, 'tampered ciphertext is rejected');
}

try {
  decryptToken(sealed, loadKey({ TOKEN_ENCRYPTION_KEY: 'b'.repeat(64) }));
  check(false, 'decrypting with the wrong key fails');
} catch (e) {
  check(e instanceof TokenCryptoError, 'decrypting with the wrong key fails');
}

for (const [label, bad] of [
  ['missing', undefined],
  ['too short', 'abc'],
  ['not hex', 'z'.repeat(64)],
]) {
  try {
    loadKey({ TOKEN_ENCRYPTION_KEY: bad });
    check(false, `loadKey rejects a ${label} key`);
  } catch (e) {
    check(e instanceof TokenCryptoError, `loadKey rejects a ${label} key`);
  }
}

// --- PKCE and state ---------------------------------------------------------

const pkce = createPkcePair();
check(pkce.verifier.length >= 43, 'PKCE verifier meets the RFC 7636 minimum length');
check(pkce.challenge !== pkce.verifier, 'challenge is not the verifier in plaintext');
check(createPkcePair().verifier !== pkce.verifier, 'a new verifier each time');
check(!/[+/=]/.test(pkce.challenge), 'challenge is base64url, not standard base64');

check(statesMatch('abc', 'abc'), 'matching states compare equal');
check(!statesMatch('abc', 'abd'), 'differing states do not match');
check(!statesMatch('abc', 'abcd'), 'different-length states do not match');
check(!statesMatch(undefined, 'abc'), 'a missing cookie state never matches');
check(!statesMatch('abc', undefined), 'a missing query state never matches');
check(!statesMatch(undefined, undefined), 'two missing states do not match');
check(createState() !== createState(), 'state is random per request');

// --- The authorize URL ------------------------------------------------------

const authUrl = new URL(
  buildAuthorizeUrl({
    clientId: 'fake-id',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback/spotify',
    state: 'test_state',
    codeChallenge: pkce.challenge,
  }),
);

check(authUrl.origin + authUrl.pathname === 'https://accounts.spotify.com/authorize', 'authorize URL points at Spotify');
check(authUrl.searchParams.get('response_type') === 'code', 'requests an authorization code');
check(authUrl.searchParams.get('code_challenge_method') === 'S256', 'uses S256, not plain');
check(authUrl.searchParams.get('code_challenge') === pkce.challenge, 'carries the challenge');
check(!authUrl.search.includes(pkce.verifier), 'the verifier never appears in the authorize URL');
check(
  authUrl.searchParams.get('redirect_uri') === 'http://127.0.0.1:3000/api/auth/callback/spotify',
  'redirect_uri is passed through byte for byte',
);

// Scope creep is a real risk: it is one word in an array, and it silently asks
// a user for more access than the product needs.
const scopes = (authUrl.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
check(scopes.length === SPOTIFY_SCOPES.length, `requests exactly ${SPOTIFY_SCOPES.length} scopes`);
check(
  scopes.every((s) => !s.includes('modify') && !s.includes('playback')),
  'requests no write or playback scopes',
);

// --- Code exchange ----------------------------------------------------------

let capturedBody = null;
let capturedHeaders = null;

const tokens = await exchangeCode({
  code: 'test_code',
  redirectUri: 'http://127.0.0.1:3000/api/auth/callback/spotify',
  codeVerifier: pkce.verifier,
  clientId: 'fake-id',
  clientSecret: 'fake-secret',
  fetchImpl: stubFetch((url, init) => {
    capturedBody = new URLSearchParams(init.body);
    capturedHeaders = init.headers;
    check(url === 'https://accounts.spotify.com/api/token', 'exchange posts to the token endpoint');
    return { body: fixtures.tokenResponse };
  }),
});

check(capturedBody.get('grant_type') === 'authorization_code', 'exchange uses the authorization_code grant');
check(capturedBody.get('code_verifier') === pkce.verifier, 'exchange sends the PKCE verifier');
check(!capturedBody.has('client_secret'), 'the secret is not in the request body');
check(String(capturedHeaders.Authorization ?? '').startsWith('Basic '), 'the secret goes in the Basic auth header');
check(tokens.accessToken === fixtures.tokenResponse.access_token, 'access token is read from the response');
check(tokens.refreshToken === fixtures.tokenResponse.refresh_token, 'refresh token is read from the response');
check(tokens.scope === fixtures.tokenResponse.scope, 'granted scope is recorded');
check(!Number.isNaN(Date.parse(tokens.expiresAt)), 'expires_in is converted to an ISO timestamp');
check(Date.parse(tokens.expiresAt) > Date.now(), 'the computed expiry is in the future');

await throws(
  () =>
    exchangeCode({
      code: 'bad',
      redirectUri: 'http://127.0.0.1:3000/api/auth/callback/spotify',
      codeVerifier: pkce.verifier,
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: stubFetch(() => ({ status: 400, body: fixtures.tokenErrorResponse })),
    }),
  'a rejected code raises SpotifyAuthError',
);

// An HTML error page from a proxy must not surface as "Unexpected token <".
try {
  await exchangeCode({
    code: 'bad',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback/spotify',
    codeVerifier: pkce.verifier,
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: stubFetch(() => ({ status: 502, body: '<html>Bad Gateway</html>' })),
  });
  check(false, 'a non-JSON error body still reports the status');
} catch (e) {
  check(
    e instanceof SpotifyAuthError && e.status === 502 && !/JSON/i.test(e.message),
    'a non-JSON error body still reports the status',
    e.message,
  );
}

// --- Refresh ----------------------------------------------------------------

const refreshed = await refreshAccessToken({
  refreshToken: 'old-refresh',
  clientId: 'fake-id',
  clientSecret: 'fake-secret',
  fetchImpl: stubFetch((_url, init) => {
    const body = new URLSearchParams(init.body);
    check(body.get('grant_type') === 'refresh_token', 'refresh uses the refresh_token grant');
    check(body.get('refresh_token') === 'old-refresh', 'refresh sends the stored token');
    return { body: fixtures.tokenRefreshResponse };
  }),
});

check(refreshed.accessToken === fixtures.tokenRefreshResponse.access_token, 'refresh returns the new access token');
// The bug this guards: Spotify omits refresh_token on refresh. Writing null
// here would force a full re-auth an hour later, looking like a random logout.
check(refreshed.refreshToken === null, 'an omitted refresh_token reads as null, not undefined');

check(isExpired(null), 'a missing expiry counts as expired');
check(isExpired('not a date'), 'an unparseable expiry counts as expired');
check(isExpired(new Date(Date.now() - 1000).toISOString()), 'a past expiry is expired');
check(!isExpired(new Date(Date.now() + 3600_000).toISOString()), 'an hour out is not expired');
check(
  isExpired(new Date(Date.now() + 30_000).toISOString()),
  'a token expiring in 30s is treated as expired (clock skew margin)',
);

// --- Storage round-trip -----------------------------------------------------

const db = openDatabase(':memory:');

saveTokens(db, 1, 'spotify', {
  accessToken: encryptToken('access_1', key),
  refreshToken: encryptToken('refresh_1', key),
  expiresAt: '2026-09-02T12:00:00.000Z',
  scope: 'user-follow-read',
});

const loaded = loadTokens(db, 1, 'spotify');
check(loaded !== null, 'tokens round-trip through the database');
check(decryptToken(loaded.accessToken, key) === 'access_1', 'the stored access token decrypts');
check(decryptToken(loaded.refreshToken, key) === 'refresh_1', 'the stored refresh token decrypts');

// What is actually on disk. This is the assertion the encryption exists for.
const rawRow = db.prepare('SELECT access_token, refresh_token FROM auth_tokens WHERE user_id = 1').get();
check(!rawRow.access_token.includes('access_1'), 'no plaintext access token in the database file');
check(!rawRow.refresh_token.includes('refresh_1'), 'no plaintext refresh token in the database file');

// The refresh path: a new access token, and Spotify sent no refresh token.
saveTokens(db, 1, 'spotify', {
  accessToken: encryptToken('access_2', key),
  refreshToken: null,
  expiresAt: '2026-09-02T13:00:00.000Z',
  scope: null,
});

const afterRefresh = loadTokens(db, 1, 'spotify');
check(decryptToken(afterRefresh.accessToken, key) === 'access_2', 'a refresh updates the access token');
check(
  afterRefresh.refreshToken !== null && decryptToken(afterRefresh.refreshToken, key) === 'refresh_1',
  'a null refresh token preserves the stored one rather than clearing it',
);
check(afterRefresh.scope === 'user-follow-read', 'a null scope preserves the granted scope');

deleteTokens(db, 1, 'spotify');
check(loadTokens(db, 1, 'spotify') === null, 'disconnecting removes the tokens');
db.close();

console.log(failed ? `\n${failed} check(s) failed` : '\nall auth checks passed');
process.exit(failed ? 1 : 0);
