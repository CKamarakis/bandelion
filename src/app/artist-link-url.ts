/**
 * The two URLs an artist link can point at.
 *
 * Split out of ArtistLink.tsx so the suite can import them. The runner uses
 * `node --experimental-strip-types`, which erases types without transforming
 * JSX, so a `.tsx` file cannot be imported by a test at all — and these are
 * the part worth asserting, since a wrong scheme in an href is the failure
 * that looks fine on a machine with the desktop app and is a dead link on
 * every other one.
 */

/** The web player. Always safe: it works with or without the desktop app. */
export const webUrl = (artistId: string) => `https://open.spotify.com/artist/${artistId}`;

/**
 * The desktop app's URI scheme.
 *
 * Only ever navigated to from a click handler, never placed in an href — see
 * the note in ArtistLink.tsx.
 */
export const appUri = (artistId: string) => `spotify:artist:${artistId}`;
