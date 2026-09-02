/**
 * Spotify OAuth (Authorization Code + PKCE) and token refresh.
 *
 * PKCE even though this is a confidential client with a secret: it costs a few
 * lines and removes the authorization-code interception class of bug entirely.
 *
 * Nothing here touches the database. The routes own persistence, this owns the
 * protocol — which is what makes it testable against fixtures without a DB.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/**
 * Read-only scopes, and no more than we use.
 *
 * `user-follow-read` is the roster. `user-top-read` is the fallback for the
 * case Spotify documents but does not explain: /me/following returns only
 * artists followed explicitly, and plenty of people mostly follow via playlists.
 * No write scopes: Bandelion never modifies a Spotify account.
 */
export const SPOTIFY_SCOPES = ['user-follow-read', 'user-top-read'] as const;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 S256. The verifier is kept in a cookie; only the challenge travels. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Constant-time compare for the CSRF state.
 *
 * `===` on a secret is a timing oracle. It is a small one here, but this is the
 * check standing between a callback and an attacker-chosen authorization code.
 */
export function statesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge_method: 'S256',
    code_challenge: opts.codeChallenge,
    scope: SPOTIFY_SCOPES.join(' '),
    // Force the consent screen so re-authenticating after a scope change
    // actually re-prompts instead of silently reusing the old grant.
    show_dialog: 'true',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp. Computed here so callers never juggle expires_in seconds. */
  expiresAt: string;
  scope: string | null;
}

export class SpotifyAuthError extends Error {
  // Assigned in the body rather than as a parameter property: Node's
  // --experimental-strip-types removes types without emitting code, and a
  // parameter property needs code generated. The suites import this source
  // directly, so it has to survive strip-only.
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Exchange an authorization code, or refresh an existing grant.
 *
 * Both Spotify endpoints are the same URL with a different grant_type and the
 * same response shape, so they share one function rather than two near-copies.
 */
async function requestToken(
  body: URLSearchParams,
  opts: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch },
): Promise<TokenResponse> {
  const doFetch = opts.fetchImpl ?? fetch;

  // Basic auth rather than client_secret in the body: both are accepted, and
  // this keeps the secret out of anything that logs request bodies.
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');

  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    // Spotify returns JSON errors, but not always — an HTML error page from a
    // proxy would otherwise throw a JSON parse error that hides the status.
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error_description || parsed.error || detail;
    } catch {
      /* keep the raw prefix */
    }
    throw new SpotifyAuthError(`Spotify token request failed (${res.status}): ${detail}`, res.status);
  }

  const json = JSON.parse(text);
  const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;

  return {
    accessToken: json.access_token,
    // Absent on refresh responses; the caller keeps the existing one.
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    scope: json.scope ?? null,
  };
}

export function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.codeVerifier,
    }),
    opts,
  );
}

export function refreshAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    }),
    opts,
  );
}

/**
 * True when the token is expired or close enough that a request would race it.
 *
 * 60s of slack because ingest makes long runs of calls: a token valid when the
 * job starts a page can expire before that page finishes.
 */
export function isExpired(expiresAt: string | null, skewMs = 60_000): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t - skewMs <= Date.now();
}
