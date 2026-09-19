/**
 * The playlist and the favs list: one row per record.
 *
 * Both pages render this. They differ only in which flag put a row here and in
 * what the empty state says, so a second component would be the same file with
 * a different WHERE clause — and the two would drift.
 *
 * A list rather than the feed's card grid: these pages are for working through
 * a shortlist, where a line per record fits more on screen and keeps the marks
 * in one column your eye can run down.
 */

'use client';

import type { FeedItem } from '../db/index.ts';
import { formatEventDate, releaseTypeLabel } from './feed-format.ts';
import { FlagMark, RemoveMark } from './FlagButtons.tsx';
import { flagOf, useEventFlags } from './use-event-flags.ts';

/*
 * Copy, hoisted. Rule 8 governs every line: the labels say what we know, and
 * the empty states distinguish "you have not saved anything" from "nothing
 * exists", which are different facts with different fixes.
 */
const UPCOMING_LABEL = 'Coming';
const RELEASED_LABEL = 'Out now';
/* Names what it counts, per the rule against a bare number. */
const COUNT = (n: number) => `${n} record${n === 1 ? '' : 's'}`;

export function SavedList({
  items,
  /** Shown when the list is empty. Each page says what would fill it. */
  empty,
  /**
   * Which flag put these rows here. A row un-flagged on its own page has to
   * stay put until the next load: removing it under the cursor moves every row
   * below up, and the next press lands on whatever slid into place.
   */
  listFlag,
}: {
  items: FeedItem[];
  empty: string;
  listFlag: 'queued' | 'favorited';
}) {
  const { overlay, toggle, isPending } = useEventFlags();

  if (items.length === 0) {
    return <p className="list-empty">{empty}</p>;
  }

  return (
    <>
      <p className="cat list-count">{COUNT(items.length)}</p>
      <ul className="list">
        {items.map((item) => {
          const listened = flagOf(item, overlay, 'listened');
          const favorited = flagOf(item, overlay, 'favorited');
          /*
           * Still on this list, per the overlay. A row toggled off keeps its
           * place and says so by the mark's state — it does not vanish.
           */
          const stillHere = flagOf(item, overlay, listFlag);

          return (
            <li
              key={item.eventId}
              className={`list-row${item.isUpcoming ? ' is-upcoming' : ''}${
                stillHere ? '' : ' is-removed'
              }`}
            >
              {/* alt empty: the artist and title sit beside it, so a screen
                  reader announcing the cover would read the same thing twice. */}
              {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="list-cover" loading="lazy" />
              ) : (
                <span className="list-cover-none" aria-hidden="true" />
              )}

              <div className="list-main">
                {/*
                  The artist, linking to their Spotify page.

                  The artist and not the record: we hold a Spotify id for the
                  artist, and releases come from MusicBrainz, so a title link
                  would have to guess an album id we never fetched.
                */}
                {item.spotifyArtistId ? (
                  <a
                    className="list-artist"
                    href={`https://open.spotify.com/artist/${item.spotifyArtistId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {item.artist}
                  </a>
                ) : (
                  <span className="list-artist">{item.artist}</span>
                )}
                <span className="list-title">{item.title}</span>
              </div>

              {/* Type and state, both as labels. Not colour, and not a glyph
                  on its own. */}
              <div className="list-meta">
                <span className="cat">{releaseTypeLabel(item.releaseType)}</span>
                <span className="cat">
                  {item.isUpcoming ? UPCOMING_LABEL : RELEASED_LABEL}
                </span>
                <span className="list-date">
                  {formatEventDate(item.eventDate, item.datePrecision, false)}
                </span>
              </div>

              {/*
                The marks at the row's end, as one group: heard it, liked it,
                and take it off. Remove is last, away from the two pressed
                often, so the destructive one is not found by accident.
              */}
              <div className="list-marks">
                <FlagMark
                  flag="listened"
                  on={listened}
                  pending={isPending(item.eventId, 'listened')}
                  onToggle={() => toggle(item.eventId, 'listened', !listened)}
                />
                <FlagMark
                  flag="favorited"
                  on={favorited}
                  pending={isPending(item.eventId, 'favorited')}
                  onToggle={() => toggle(item.eventId, 'favorited', !favorited)}
                />
                <RemoveMark
                  list={listFlag}
                  pending={isPending(item.eventId, listFlag)}
                  onRemove={() => toggle(item.eventId, listFlag, false)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
