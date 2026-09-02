/**
 * Server-side helpers shared by the auth routes.
 *
 * One instance, one user: `LOCAL_USER_ID` is 1 everywhere. The schema carries
 * user_id regardless (see schema.sql) so this stays a single constant to change
 * rather than a migration, if that assumption ever breaks.
 */

import { getDatabase, loadTokens, saveTokens, type DB } from '../db/index.ts';
import { loadConfig } from '../config.ts';
import { decryptToken, encryptToken, loadKey } from './crypto.ts';
import { isExpired, refreshAccessToken } from './spotify.ts';

export const LOCAL_USER_ID = 1;

/** Cookie names. Short-lived: all are cleared as soon as the callback runs. */
export const STATE_COOKIE = 'bandelion_oauth_state';
export const VERIFIER_COOKIE = 'bandelion_oauth_verifier';

/**
 * Set when the flow was started from a popup, so the callback closes the window
 * instead of redirecting inside it.
 *
 * A cookie rather than a query parameter because Spotify returns only `state`,
 * and packing a flag into `state` would mean parsing attacker-influenced input
 * to decide how to render a page.
 */
export const POPUP_COOKIE = 'bandelion_oauth_popup';

export function db(): DB {
  return getDatabase(loadConfig().databasePath);
}

/**
 * Options for the two transient OAuth cookies.
 *
 * `secure` is conditional because the whole local flow runs on http://127.0.0.1
 * — a hard `secure: true` would mean the browser silently drops the cookie and
 * every callback fails the state check with no clue why.
 */
export function oauthCookieOptions(redirectUri: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: redirectUri.startsWith('https://'),
    path: '/',
    maxAge: 600, // ten minutes is plenty to click through a consent screen
  };
}

export class NotConnectedError extends Error {}

/**
 * A usable Spotify access token, refreshing it if needed.
 *
 * Every caller that talks to Spotify goes through here, so the refresh happens
 * in exactly one place. Callers never see ciphertext or expiry arithmetic.
 */
export async function getAccessToken(database: DB = db()): Promise<string> {
  const cfg = loadConfig();
  const stored = loadTokens(database, LOCAL_USER_ID, 'spotify');
  if (!stored) {
    throw new NotConnectedError('No Spotify account is connected.');
  }

  const key = loadKey();

  if (!isExpired(stored.expiresAt)) {
    return decryptToken(stored.accessToken, key);
  }

  if (!stored.refreshToken) {
    throw new NotConnectedError(
      'The Spotify session expired and no refresh token is stored. Reconnect the account.',
    );
  }

  if (!cfg.spotify.clientId || !cfg.spotify.clientSecret) {
    throw new NotConnectedError('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set.');
  }

  const fresh = await refreshAccessToken({
    refreshToken: decryptToken(stored.refreshToken, key),
    clientId: cfg.spotify.clientId,
    clientSecret: cfg.spotify.clientSecret,
  });

  saveTokens(database, LOCAL_USER_ID, 'spotify', {
    accessToken: encryptToken(fresh.accessToken, key),
    // Spotify usually omits this on refresh; saveTokens keeps the existing one.
    refreshToken: fresh.refreshToken ? encryptToken(fresh.refreshToken, key) : null,
    expiresAt: fresh.expiresAt,
    scope: fresh.scope,
  });

  return fresh.accessToken;
}

export function isConnected(database: DB = db()): boolean {
  return loadTokens(database, LOCAL_USER_ID, 'spotify') !== null;
}
