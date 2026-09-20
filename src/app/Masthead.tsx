/**
 * The masthead, shared by every page.
 *
 * Extracted from page.tsx when the second and third pages arrived: three copies
 * of a header is three places for the catalogue number to drift. Server
 * component — it renders from values the caller already read.
 *
 * The nav sits in the masthead row rather than in a bar of its own, so the
 * page keeps one piece of header furniture. Each link names what it counts,
 * per the rule against a bare number.
 */

import Link from 'next/link';

const TITLE = 'Bandelion';
/* Names the destination, since the mark itself carries no text. */
const HOME_LABEL = 'Bandelion, home';
/* Distinct from the feed pager's "Pages", which is a nav landmark too. */
const NAV_LABEL = 'Sections';

/*
 * The nav labels, without counts.
 *
 * They carried "Playlist 7" and "Favs 2" for a while. The number is answered
 * immediately by the page itself, which prints its own count above the list, so
 * in the masthead it was a second place to keep the same fact in step and it
 * made the row noisier on a narrow screen for nothing.
 *
 * "Playlist" is the user's word for this list. Worth knowing that it is also
 * Spotify's word for a thing that plays, and this page plays nothing — if that
 * ever reads as a promise, the honest name is closer to "Queue".
 */
const NAV = [
  { href: '/', label: 'Feed' },
  { href: '/playlist', label: 'Playlist' },
  { href: '/favs', label: 'Favs' },
] as const;

export function Masthead({
  city,
  /** Which page this is, so its own link renders as a position and not a link. */
  here,
}: {
  city: string;
  here: '/' | '/playlist' | '/favs';
}) {
  return (
    <header style={S.masthead}>
      {/*
        The mark sits with the wordmark, the nav follows, and the catalogue
        labels stack hard right.

        alt is empty and the image decorative: the h1 beside it already says
        "Bandelion", so a screen reader would otherwise read the name twice.
      */}
      <div style={S.titleRow}>
        {/*
          Mark and wordmark together, as one link home.

          One anchor around both rather than two side by side: they read as a
          single lockup, and two adjacent links to the same place are two tab
          stops and two announcements for one target. The image keeps `alt=""`
          because the wordmark inside the same link already says the name.

          The h1 stays outside the anchor's own semantics — it wraps the
          heading's text, so the page still has exactly one h1 and a screen
          reader still finds it by heading.
        */}
        <Link href="/" className="masthead-home" aria-label={HOME_LABEL}>
          <img src="/logo.png" alt="" width={64} height={64} style={S.logo} />
          <h1 style={S.title}>{TITLE}</h1>
        </Link>

        {/*
          "Sections", not "Pages": the feed's pager is also a nav and is
          already called Pages, so two landmarks announced by the same name
          would be indistinguishable to anyone navigating by them.
        */}
        <nav className="nav" aria-label={NAV_LABEL}>
          {NAV.map((item) => {
            const label = item.label;

            /*
             * The current page is text, not a link to itself. aria-current says
             * so for a screen reader, and the inked block says so visually —
             * position plus weight, not colour.
             */
            return item.href === here ? (
              <span key={item.href} className="cat nav-here" aria-current="page">
                {label}
              </span>
            ) : (
              <Link key={item.href} href={item.href} className="cat nav-link">
                {label}
              </Link>
            );
          })}
        </nav>

        <div style={S.catStack}>
          <span className="cat">BND 0001</span>
          <span className="cat">{city.toUpperCase()}</span>
        </div>
      </div>
    </header>
  );
}

const S: Record<string, React.CSSProperties> = {
  masthead: { paddingBottom: '20px' },
  /*
   * Wraps, unlike the original single-line row: the nav added three items to a
   * row that already held a logo, a wordmark and a two-line stack, and at
   * 390px they cannot share one line. Without this the catalogue stack was
   * pushed past the right edge.
   */
  titleRow: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' },
  catStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
    alignSelf: 'flex-start',
  },
  /*
   * The mark, on its own black ground. No border: the artwork is already a
   * black circle, so a rule around it would draw a box around a circle.
   */
  logo: { display: 'block', flexShrink: 0, width: '64px', height: '64px' },
  /*
   * Sized to the mark rather than to the viewport.
   *
   * The global h1 is clamp(2.5rem, 9vw, 5.5rem), which at 960px renders near
   * 86px and towered over a 64px logo. 3.25rem caps the cap-height at roughly
   * the circle's diameter so the two read as one lockup, and the clamp still
   * lets it shrink on a narrow screen.
   */
  title: { fontSize: 'clamp(2rem, 6vw, 3.25rem)', lineHeight: 0.9 },
};
