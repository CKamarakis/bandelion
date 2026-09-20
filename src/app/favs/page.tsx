/**
 * Favs: the records you liked after hearing them.
 *
 * The same list as the playlist, filtered on the other flag. Both pages share
 * SavedList, so a change to a row happens once.
 */

import { loadConfig } from '../../config.ts';
import { getFlaggedEvents, type FeedItem } from '../../db/index.ts';
import { LOCAL_USER_ID, db } from '../../auth/session.ts';
import { Masthead } from '../Masthead.tsx';
import { SavedList } from '../SavedList.tsx';

export const dynamic = 'force-dynamic';

const HEADING = 'Favs';
/*
 * Rule 8: says what this list holds and what puts something in it, without
 * claiming where you were when you pressed the heart. An earlier draft read
 * "press the heart on a record in your playlist", which names a route that is
 * only one of two — the heart is on every row of both pages — and which sends
 * you to a second empty screen when the playlist is empty too.
 *
 * Rule 7: no INTRO on this page. "Records you liked" restates the heading, and
 * the count above the list already says how many there are.
 */
const EMPTY = 'Nothing hearted yet. The heart on a record keeps it here.';

export default async function FavsPage() {
  const cfg = loadConfig();

  let items: FeedItem[] = [];
  try {
    const database = db();
    items = getFlaggedEvents(database, LOCAL_USER_ID, 'favorited');
  } catch (err) {
    console.error('[favs] could not read the list:', err);
  }

  return (
    <main style={S.page}>
      <Masthead city={cfg.city} here="/favs" />
      <hr style={S.rule} />

      <section style={S.section}>
        <h2 style={S.heading}>{HEADING}</h2>
        <SavedList
          items={items}
          empty={EMPTY}
          listFlag="favorited"
          linkTarget={cfg.spotifyLinkTarget}
        />
      </section>
    </main>
  );
}

/* Identical to the playlist sheet: the same object, a different cut of it. */
const S: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '48px 32px 96px',
    background: 'rgba(255, 255, 255, 0.9)',
    borderLeft: 'var(--rule-width) solid var(--ink)',
    borderRight: 'var(--rule-width) solid var(--ink)',
    minHeight: '100vh',
  },
  rule: { height: '6px', background: 'var(--ink)', border: 'none', margin: '0' },
  section: { marginTop: '2rem' },
  heading: { margin: '0' },
  intro: { margin: '0.75rem 0 0', fontSize: '0.9rem' },
};
