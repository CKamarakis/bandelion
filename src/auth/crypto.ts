/**
 * Encryption for OAuth tokens at rest.
 *
 * Why bother, on a single-user local database: the SQLite file gets copied.
 * Backups, a `docker cp`, a volume snapshot, someone pasting a debug dump into
 * an issue. A Spotify refresh token is long-lived and grants the whole account
 * scope, so it should not sit in plaintext in a file whose whole design goal is
 * being easy to copy around.
 *
 * AES-256-GCM: authenticated, so a corrupted or tampered ciphertext fails loudly
 * rather than decrypting to garbage that then gets sent to Spotify as a token.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM standard nonce size
const KEY_BYTES = 32;

/**
 * The stored format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 *
 * Versioned from the start because rotating the algorithm later means reading
 * rows written by the old one, and an unprefixed blob gives you nothing to
 * branch on.
 */
const VERSION = 'v1';

export class TokenCryptoError extends Error {}

/**
 * Reads the key from env and validates it properly.
 *
 * A short or non-hex key is a configuration error worth failing loudly on: the
 * alternative is silently padding it and shipping weak encryption that looks
 * like it works.
 */
export function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new TokenCryptoError(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new TokenCryptoError(
      `TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes); got ${raw.length}.`,
    );
  }
  return Buffer.from(raw, 'hex');
}

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(`key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join('.');
}

export function decryptToken(stored: string, key: Buffer): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCryptoError('stored token is not in the expected v1 format');
  }
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, unb64(ivB64));
    decipher.setAuthTag(unb64(tagB64));
    return Buffer.concat([decipher.update(unb64(dataB64)), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, or the row was tampered with. Both mean "re-authenticate",
    // and neither should leak crypto internals into a log.
    throw new TokenCryptoError(
      'could not decrypt token: wrong TOKEN_ENCRYPTION_KEY, or the stored value is corrupt',
    );
  }
}

const b64 = (b: Buffer): string => b.toString('base64url');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url');
