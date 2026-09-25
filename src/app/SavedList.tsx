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

import { useMemo, useState } from 'react';
import type { FeedItem } from '../db/index.ts';
import type { LinkTarget } from '../config.ts';
import { ArtistLink } from './ArtistLink.tsx';
import { formatEventDate, monthGroup, releaseTypeLabel } from './feed-format.ts';
import { groupByMonth, visibleList, type ListOrderId } from './feed-filters.ts';
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

/*
 * The order control.
 *
 * Labels name what the order IS, not what pressing does: these are two views
 * of one list, and `aria-pressed` carries which one you are in. "By month" and
 * "Recently added" are the two questions the list answers.
 */
const ORDER_LABEL = 'Order';
const ORDERS = [
  { id: 'month', label: 'By month' },
  { id: 'added', label: 'Recently added' },
] as const;

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
  linkTarget,
}: {
  items: FeedItem[];
  empty: string;
  listFlag: 'queued' | 'favorited';
  /** Where an artist link goes. Read from config by the page. */
  linkTarget: LinkTarget;
}) {
  const { overlay, toggle, isPending } = useEventFlags();
  const [order, setOrder] = useState<ListOrderId>('month');

  /*
   * Rows taken off this list are gone from it at once.
   *
   * An earlier version kept them in place, struck through, so nothing moved
   * under the cursor and a misclick was one press from being undone. That was
   * the wrong trade: the page then showed records that were no longer on the
   * list it is named after, which reads as a bug rather than as a safety net.
   * A row is removed the moment its flag goes, and the count follows it.
   */
  const ordered = useMemo(
    () => visibleList(items, (i) => flagOf(i, overlay, listFlag), order),
    [items, overlay, listFlag, order],
  );
  /*
   * Grouped only when the order is by month. In `added` order the sections
   * would be meaningless: consecutive rows come from wherever you happened to
   * save them, so a month band would open and close every row or two.
   */
  const groups = useMemo(
    () =>
      order === 'month'
        ? groupByMonth(ordered, (i) => monthGroup(i.eventDate, i.datePrecision))
        : [{ month: null, items: ordered }],
    [ordered, order],
  );

  // `ordered`, not `items`: emptying the list by removing its last row has to
  // land on the same empty state as arriving with nothing on it.
  if (ordered.length === 0) {
    return <p className="list-empty">{empty}</p>;
  }

  /* One row, rendered the same inside a month section or outside one. */
  const renderRow = (item: FeedItem) => {
    const listened = flagOf(item, overlay, 'listened');
    const favorited = flagOf(item, overlay, 'favorited');

    return (
            <li
              key={item.eventId}
              className={`list-row${item.isUpcoming ? ' is-upcoming' : ''}`}
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
                  <ArtistLink
                    className="list-artist"
                    artistId={item.spotifyArtistId}
                    name={item.artist}
                    linkTarget={linkTarget}
                  />
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
  };

  return (
    <>
      <div className="list-head">
        {/* Counts the rows shown, not the rows the server sent: removing one
            has to move this number too. */}
        <p className="cat list-count">{COUNT(ordered.length)}</p>

        {/*
          Two views of one list, as a pair of toggles rather than a dropdown.

          The feed uses selects for its five filters because there are five of
          them; two mutually exclusive options read faster as buttons, and both
          labels stay visible so the alternative is nameable without opening
          anything. `aria-pressed` carries which one is active for a screen
          reader; the inked block carries it for everyone else.
        */}
        <div className="list-orders" role="group" aria-label={ORDER_LABEL}>
          {ORDERS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`list-orderbtn${order === o.id ? ' is-on' : ''}`}
              aria-pressed={order === o.id}
              onClick={() => setOrder(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.month ?? 'all'} className="list-section">
          {/*
            A month band, only when grouping. Static rather than collapsible,
            unlike the feed's: these lists are short by nature, so a control to
            hide part of a seven-row list would be a control nobody presses.
          */}
          {group.month ? (
            <div className="list-monthband">
              <span>{group.month}</span>
              <span className="list-bandcount">{COUNT(group.items.length)}</span>
            </div>
          ) : null}

          <ul className="list">{group.items.map(renderRow)}</ul>
        </section>
      ))}
    </>
  );
}
