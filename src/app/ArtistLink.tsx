/**
 * The artist name, as a link to Spotify.
 *
 * Both the feed and the saved lists link an artist the same way, so the rule
 * for WHERE that link goes lives here rather than twice in two components.
 *
 * ## Why this is not a detection
 *
 * The obvious reading of "open the desktop app if it is installed" is a check
 * followed by a decision. A browser cannot do that: there is no API that says
 * whether a URI scheme has a handler, deliberately, because it would be a
 * fingerprinting surface. Anything claiming to detect an installed app is
 * inferring it from timing.
 *
 * So this navigates to `spotify:` and watches for the page losing focus. A
 * handled URI hands the OS the foreground — the tab blurs, or goes hidden — and
 * that is the only signal available. If neither happens within GRACE_MS we
 * assume nothing took it and open the web player in a new tab.
 *
 * The inference is one-directional on purpose: a blur means something took the
 * link, but no blur does not prove the app is missing. A slow machine, a
 * browser that prompts before handing over ("Open Spotify?" steals focus in
 * some builds and not others), or a background tab can all miss the signal. The
 * cost of a false negative is an extra web tab, which is recoverable; the cost
 * of no fallback at all is a dead link, which is not. That trade is why the
 * timeout errs toward opening the web player.
 *
 * `linkTarget` decides whether any of this runs: at 'web' the anchor is an
 * ordinary link and no script touches it.
 */

'use client';

import type { LinkTarget } from '../config.ts';
import { appUri, webUrl } from './artist-link-url.ts';

/**
 * How long to wait for the OS to take the URI before falling back.
 *
 * 600ms is the compromise. Under ~400ms a cold app launch on Windows had not
 * blurred the tab yet and the fallback fired over a handoff that was working,
 * leaving a stray web tab every time. Much above a second and the delay reads
 * as a broken link on the machines where there is genuinely no app.
 */
const GRACE_MS = 600;

export function ArtistLink({
  artistId,
  name,
  linkTarget,
  className,
  style,
}: {
  artistId: string;
  name: string;
  linkTarget: LinkTarget;
  className?: string;
  style?: React.CSSProperties;
}) {
  /*
   * The href stays the web URL in both modes.
   *
   * It is what the status bar shows on hover, what "copy link address" yields
   * and where a middle-click goes, and a `spotify:` URI is useless for all
   * three. In app mode the click handler intercepts before the browser
   * follows it; anything that bypasses the handler gets the link that always
   * works, which is the right way round.
   */
  const href = webUrl(artistId);

  if (linkTarget === 'web') {
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer noopener" style={style}>
        {name}
      </a>
    );
  }

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    /*
     * Leave modified clicks alone. Ctrl/cmd-click, middle-click and shift-click
     * are the reader asking for a tab or a window explicitly, and hijacking
     * them to launch an app is the kind of surprise that makes people stop
     * trusting a link.
     */
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }

    e.preventDefault();

    let handed = false;
    const tookIt = () => {
      handed = true;
    };

    /*
     * Both signals, because neither fires everywhere: blur is what a desktop
     * handoff usually produces, and visibilitychange is what fires when the
     * browser itself is backgrounded wholesale.
     */
    window.addEventListener('blur', tookIt, { once: true });
    document.addEventListener('visibilitychange', tookIt, { once: true });

    /*
     * Assigning location rather than opening a window: a `spotify:` URI opened
     * with window.open leaves an orphaned blank tab behind in several browsers
     * when the scheme has no handler, which is a worse failure than the one
     * being avoided.
     */
    window.location.href = appUri(artistId);

    window.setTimeout(() => {
      window.removeEventListener('blur', tookIt);
      document.removeEventListener('visibilitychange', tookIt);

      // document.hidden covers the case where the blur landed before the
      // listener was attached, which happens when the handler is already warm.
      if (handed || document.hidden) return;

      window.open(href, '_blank', 'noopener,noreferrer');
    }, GRACE_MS);
  }

  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={style}
      onClick={onClick}
    >
      {name}
    </a>
  );
}
