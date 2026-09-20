/**
 * Where an artist link points.
 *
 *  - `loadConfig` reads SPOTIFY_LINK_TARGET, defaults to 'app', and only an
 *    exact 'web' turns the app mode off. A typo must not silently land in a
 *    mode nobody chose.
 *  - The two URL builders produce the shapes Spotify actually accepts.
 *
 * ## What this file deliberately does not test
 *
 * The component. The runner is `node --experimental-strip-types`, which erases
 * types without transforming JSX, so a `.tsx` file cannot be imported here at
 * all — that is why the builders live in their own `.ts` module.
 *
 * And the click handler's fallback, which waits on a real blur from a real
 * window manager. There is no OS in a test to hand a `spotify:` URI to, so any
 * assertion here would be testing a mock of the one thing that is uncertain.
 * Both are covered by hand; see the checklist at the bottom.
 */

import { loadConfig } from '../src/config.ts';
import { appUri, webUrl } from '../src/app/artist-link-url.ts';

let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else {
    console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`);
    failed++;
  }
};

/* An env in, a mode out. Built from an empty base so the real .env cannot
   decide the result of a test about defaults. */
const modeFor = (v) => loadConfig({ SPOTIFY_LINK_TARGET: v }).spotifyLinkTarget;

check(loadConfig({}).spotifyLinkTarget === 'app', 'unset defaults to app');
check(modeFor('app') === 'app', "'app' is app");
check(modeFor('web') === 'web', "'web' is web");
check(modeFor('WEB') === 'web', 'case does not matter');
check(modeFor('  web  ') === 'web', 'surrounding space does not matter');
/*
 * The one that would bite. An unrecognised value must not disable the app
 * handoff silently — it falls back to 'app', which still reaches Spotify
 * either way because the web fallback is built in.
 */
check(modeFor('desktop') === 'app', 'an unknown value falls back to app, not web');
check(modeFor('') === 'app', 'an empty value falls back to app');

const ID = '4Z8W4fKeB5YxbusRsdQVPb';

check(
  webUrl(ID) === `https://open.spotify.com/artist/${ID}`,
  'the web url is the open.spotify.com artist page',
);
check(appUri(ID) === `spotify:artist:${ID}`, 'the app uri is the spotify: scheme');
/*
 * The shape that matters: open.spotify.com uses a path, the desktop scheme
 * uses colons. Writing `spotify:artist/<id>` or `spotify://artist/<id>` gives
 * a URI that looks right and that the app will not open.
 */
check(!appUri(ID).includes('/'), 'the app uri has no slashes');
check(webUrl(ID).startsWith('https://'), 'the web url is https');

/*
 * By hand, on a machine with the desktop app, because no automated check can
 * watch an OS hand a URI to an application:
 *
 *  1. SPOTIFY_LINK_TARGET=app, click an artist — the desktop app comes
 *     forward and no web tab opens.
 *  2. Quit the desktop app entirely, click an artist — the web player opens
 *     in a new tab after a beat.
 *  3. SPOTIFY_LINK_TARGET=web, click an artist — the web player opens
 *     immediately, with no pause.
 *  4. In either mode, hover a link and read the status bar: it must show
 *     open.spotify.com, never spotify:. Middle-click must open the web player.
 */

console.log(failed === 0 ? '\nartist-link: all checks passed' : `\nartist-link: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
