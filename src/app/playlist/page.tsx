/**
 * The playlist: records saved from the feed to hear later.
 *
 * Server component, like the feed: the list is read from SQLite at request
 * time and arrives in the HTML, so there is no loading flash and no fetch on
 * mount. The marks are the only interactive part, and they live in a client
 * component below.
 */

import { loadConfig } from '../../config.ts';
import { getFlaggedEvents, type FeedItem } from '../../db/index.ts';
import { LOCAL_USER_ID, db } from '../../auth/session.ts';
import { Masthead } from '../Masthead.tsx';
import { SavedList } from '../SavedList.tsx';

export const dynamic = 'force-dynamic';

const HEADING = 'Playlist';
/*
 * Rule 8: says what would fill the list, not that nothing exists. An empty
 * playlist means nothing has been saved and the releases are all still in the
 * feed, so it names the action rather than reporting a void.
 */
const EMPTY = 'Nothing saved yet. The bolt on a release in the feed puts it here.';
/*
 * Rule 7: this survives where the favs page's intro did not, because the tick
 * is the one control whose purpose is not self-evident from its glyph — a
 * checkmark could plausibly mean "done", "keep" or "confirm". It says that one
 * thing once. "Records you saved to hear later" was cut from the front: the
 * heading and the count already carry it.
 */
const INTRO = 'Mark a record with the speaker once you have played it.';

export default async function PlaylistPage() {
  const cfg = loadConfig();

  let items: FeedItem[] = [];
  try {
    const database = db();
    items = getFlaggedEvents(database, LOCAL_USER_ID, 'queued');
  } catch (err) {
    // The page must render without a database. One broken dependency degrades
    // a section; it does not blank the screen.
    console.error('[playlist] could not read the list:', err);
  }

  return (
    <main style={S.page}>
      <Masthead city={cfg.city} here="/playlist" />
      <hr style={S.rule} />

      <section style={S.section}>
        <h2 style={S.heading}>{HEADING}</h2>
        <p style={S.intro}>{INTRO}</p>
        <SavedList items={items} empty={EMPTY} listFlag="queued" />
      </section>
    </main>
  );
}

/*
 * Layout only; colour and type live in globals.css so contrast stays testable.
 * The sheet matches the feed page exactly — the two are the same object seen
 * from different angles, and a different margin would read as a different app.
 */
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
