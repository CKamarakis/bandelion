/**
 * The feed: releases as a dated list.
 *
 * Client component because the filter is interactive, but it renders from data
 * the server already read — no fetch on mount, so there is no empty flash and
 * the list is present in the HTML.
 *
 * The design is the Factory idea from CLAUDE.md: the data *is* the ornament.
 * Dates, catalogue numbers and type labels set in monospace at real scale,
 * hard rules between rows, no decoration added on top. Upcoming records get
 * the dandelion block because they are the thing you came for; released ones
 * sit on white.
 */

'use client';

import { Fragment, useMemo, useState } from 'react';
import type { FeedItem } from '../db/index.ts';
import {
  formatEventDate,
  monthGroup,
  relativeDays,
  releaseTypeLabel,
} from './feed-format.ts';
import {
  byDate,
  inCategory,
  inSource,
  inStatus,
  type CategoryId,
  type SortId,
  type SourceId,
  type StatusId,
} from './feed-filters.ts';

/*
 * Copy, hoisted so every user-facing string is reviewable in one place against
 * the eight rules.
 *
 * Rule 8 governs the empty states. "No releases yet" would claim we looked and
 * found nothing; before a sweep has run we have not looked at all, and the two
 * must read differently.
 */
const HEADING = 'Releases';
const EMPTY_NOT_RUN = 'No releases imported yet.';
const EMPTY_NOT_RUN_HINT = 'Run npm run ingest releases to check your artists.';
const EMPTY_FILTERED = 'Nothing matches this filter.';
const UPCOMING_LABEL = 'Coming';
const RELEASED_LABEL = 'Out now';
const COUNT_LABEL = (shown: number, total: number) =>
  shown === total ? `${total} release${total === 1 ? '' : 's'}` : `${shown} of ${total}`;
/*
 * Said only when the list is genuinely truncated, and it names the reason.
 * The header previously read "200 releases" against a database holding 225,
 * because it counted the rows fetched rather than the rows that exist — the
 * screen asserting a total it had not actually measured.
 */
const TRUNCATED = (total: number, loaded: number) =>
  `${total} releases · showing the newest ${loaded}`;

const TYPE_LEGEND = 'Type';
/* "Status", not "Show": every one of these controls shows something. */
const STATUS_LEGEND = 'Status';
const SOURCE_LEGEND = 'From';
const SORT_LEGEND = 'Sort';
/*
 * Says where the artist came from, not that you liked this record. "Liked" on
 * a release you have never heard would claim the second.
 */
const LIKED_MARKER = 'From liked songs';
/* Both filters can empty the list, and the two reasons are different. */
const EMPTY_FILTERED_SOURCE = 'No releases from artists on that list yet.';

/**
 * What kind of record, not whether it is out yet.
 *
 * "Coming" was a category here and is now a status below, because the two
 * questions are independent: wanting only albums and wanting only unreleased
 * things are different filters, and folding them into one row made "albums
 * that are not out yet" unreachable.
 *
 * Compilations count as albums. They are album-length records rather than a
 * kind of their own, and at four rows out of 225 a separate home would have
 * been a category nobody filters by.
 *
 * "Live recordings" means a released concert recording — a record you can play,
 * not a ticket. Bandelion has no gigs yet; when it does they are a different
 * event type entirely, not a category here.
 */
const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'album', label: 'Albums' },
  { id: 'single', label: 'Singles & EPs' },
  { id: 'live', label: 'Live recordings' },
  { id: 'other', label: 'Other' },
] as const;

/** Whether it is out yet. Independent of category — see inStatus. */
const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'coming', label: 'Coming' },
  { id: 'released', label: 'Released' },
] as const;

/**
 * Which list the artist is on.
 *
 * Not tabs. The screen already asks two filter questions with these controls,
 * and a tab strip would be a third gesture for the same kind of choice — the
 * design rules put consistency of gesture above economy of controls.
 *
 * "Followed" and "Liked" overlap rather than partition: an artist can be both,
 * so the counts on these two do not add up to the total, and the labels must
 * not imply they do.
 */
const SOURCES = [
  { id: 'all', label: 'All artists' },
  { id: 'followed', label: 'Followed' },
  { id: 'liked', label: 'Liked songs' },
] as const;

/** Newest first by default: what changed recently is what you came to see. */
const SORTS = [
  { id: 'desc', label: 'Newest first' },
  { id: 'asc', label: 'Oldest first' },
] as const;


/**
 * A secondary control, as a dropdown.
 *
 * The category row keeps the button treatment because it is the primary cut.
 * Status and sort were the same buttons and read as equally important, which
 * gave the screen three competing rows of them; a select states the current
 * value in one line and hides the rest until asked.
 *
 * The label wraps the select rather than sitting beside it, so clicking the
 * word focuses the control and there is no `for`/`id` pair to keep in step.
 */
function Dropdown<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <label style={S.controlRow}>
      <span className="cat" style={S.legend}>
        {legend}
      </span>
      {/* The arrow is a character in the markup rather than a background
          image: CSS gradients are banned outright by the design rules, and
          tests/contrast.mjs enforces that. A glyph also scales with the type. */}
      <span className="feed-select-wrap">
        <select
          className="feed-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="feed-select-arrow" aria-hidden="true">
          ▾
        </span>
      </span>
    </label>
  );
}

export function Feed({
  items,
  today,
  total,
}: {
  items: FeedItem[];
  today: string;
  /** Rows in the database, which may exceed the rows fetched. */
  total: number;
}) {
  const [category, setCategory] = useState<CategoryId>('all');
  const [status, setStatus] = useState<StatusId>('all');
  const [source, setSource] = useState<SourceId>('all');
  const [sort, setSort] = useState<SortId>('desc');

  const shown = useMemo(
    () =>
      // filter() already returns a new array, so sorting it in place is safe —
      // but only because of that. Sorting `items` directly would mutate a prop.
      items
        .filter((i) => inCategory(i, category) && inStatus(i, status) && inSource(i, source))
        .sort(byDate(sort)),
    [items, category, status, source, sort],
  );

  // Never run vs ran and found nothing are different facts and read
  // differently. Only the first can be fixed by running the job.
  if (items.length === 0) {
    return (
      <section style={S.section}>
        <h2>{HEADING}</h2>
        <p style={S.empty}>{EMPTY_NOT_RUN}</p>
        <p style={S.emptyHint}>{EMPTY_NOT_RUN_HINT}</p>
      </section>
    );
  }

  return (
    <section style={S.section}>
      <div style={S.headRow}>
        <h2>{HEADING}</h2>
        <span className="cat" style={S.count}>
          {items.length < total && category === 'all' && status === 'all' && source === 'all'
            ? TRUNCATED(total, items.length)
            : COUNT_LABEL(shown.length, items.length)}
        </span>
      </div>

      {/* One row of four dropdowns, left aligned, coarsest cut first. The
          category filter was a row of buttons and read as a different kind of
          control from the three beside it; the design rules put consistency of
          gesture above economy of controls, and four selects is one gesture. */}
      <div style={S.controls}>
        <Dropdown legend={TYPE_LEGEND} options={CATEGORIES} value={category} onChange={setCategory} />
        <Dropdown legend={STATUS_LEGEND} options={STATUSES} value={status} onChange={setStatus} />
        <Dropdown legend={SOURCE_LEGEND} options={SOURCES} value={source} onChange={setSource} />
        <Dropdown legend={SORT_LEGEND} options={SORTS} value={sort} onChange={setSort} />
      </div>

      {shown.length === 0 ? (
        /*
         * Two different facts. Narrowing to a list that has no releases yet is
         * not the same as a filter combination matching nothing: the first is
         * answered by running the release sweep, the second by changing the
         * filter. Saying "nothing matches" to someone whose liked artists have
         * simply never been swept sends them to the wrong fix.
         */
        <p style={S.empty}>
          {source !== 'all' && category === 'all' && status === 'all'
            ? EMPTY_FILTERED_SOURCE
            : EMPTY_FILTERED}
        </p>
      ) : (
        <ol style={S.list}>
          {shown.map((item, i) => {
            /*
             * A month band whenever the month changes.
             *
             * Computed against the PREVIOUS row rather than from a grouped
             * data structure, so it follows whatever the sort and filters
             * produced: reverse the sort and the bands reverse with it,
             * because the question "has the month changed since the last row"
             * is true in either direction.
             */
            const band = monthGroup(item.eventDate, item.datePrecision);
            const previous = i === 0 ? null : shown[i - 1];
            const previousBand = previous
              ? monthGroup(previous.eventDate, previous.datePrecision)
              : null;

            return (
              <Fragment key={item.eventId}>
                {band && band !== previousBand ? (
                  <li style={S.monthBand} aria-hidden="true">
                    {band}
                  </li>
                ) : null}
                <FeedRow item={item} today={today} />
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function FeedRow({ item, today }: { item: FeedItem; today: string }) {
  const when = formatEventDate(item.eventDate, item.datePrecision);
  const soon = item.isUpcoming ? relativeDays(item.eventDate, item.datePrecision, today) : null;

  return (
    <li
      className={`feed-row${item.isUpcoming ? ' block-yellow' : ''}`}
    >
      <div className="feed-date">
        <span style={S.date}>{when}</span>
        {/* State is label plus position, never colour alone. */}
        <span className="cat" style={S.state}>
          {item.isUpcoming ? UPCOMING_LABEL : RELEASED_LABEL}
        </span>
        {soon ? (
          <span className="cat" style={S.soon}>
            {soon}
          </span>
        ) : null}
      </div>

      <div className="feed-main">
        <span style={S.artist}>{item.artist}</span>
        <span style={S.title}>{item.title}</span>
      </div>

      <div className="feed-meta">
        <span className="cat" style={S.type}>
          {releaseTypeLabel(item.releaseType)}
        </span>
        {/*
          Provenance, only when it says something. A row you follow is the
          default case and carries no marker: a label repeating identically on
          most rows is texture, not information. "Liked" marks an artist you do
          NOT follow — the reason an unfamiliar name is in your feed — and the
          overlap is left unmarked because it is already in the followed set.
        */}
        {!item.followed && item.liked ? (
          <span className="cat" style={S.provenance}>
            {LIKED_MARKER}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/*
 * Inline styles to match the rest of the app, which has no CSS modules. Zero
 * border-radius throughout and hard rules rather than shadows — the design
 * rules in CLAUDE.md are not negotiable per-component.
 */
const S: Record<string, React.CSSProperties> = {
  section: { marginTop: '2rem' },
  headRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '0.75rem',
  },
  count: { color: 'var(--ink)', opacity: 0.7 },

  // The category row reads as the primary cut, so it keeps the button
  // treatment while status and sort become dropdowns below it.
  categoryRow: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' },
  /*
   * Secondary controls, pushed right.
   *
   * Right-aligned and small on purpose: the category row is the primary cut and
   * should read first. Three equal-weight button rows made the controls louder
   * than the list they filter.
   */
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    gap: '0.5rem 1rem',
    marginBottom: '0.9rem',
  },
  // Label above its control: four side-by-side pairs with the label to the
  // left doubles the row's width and makes the eye alternate between reading a
  // word and reading a value. Stacked, the labels form one line and the
  // controls another.
  controlRow: { display: 'flex', flexDirection: 'column', gap: '0.25rem', cursor: 'pointer' },
  legend: { fontSize: '0.55rem', opacity: 0.6 },
  filters: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  filter: {
    font: 'inherit',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '0.4rem 0.7rem',
    border: 'var(--rule-width) solid var(--rule)',
    background: 'var(--white)',
    color: 'var(--ink)',
    cursor: 'pointer',
  },
  filterActive: { background: 'var(--ink)', color: 'var(--white)' },

  list: { listStyle: 'none', margin: 0, padding: 0, borderTop: 'var(--rule-width) solid var(--rule)' },

  // Date and metadata share a line: both are short, and pairing them keeps the
  // row to two lines rather than four.
  date: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  state: { fontSize: '0.6rem', opacity: 0.75 },
  soon: { fontSize: '0.6rem', fontWeight: 700 },

  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 },
  artist: { fontWeight: 800, letterSpacing: '-0.01em' },
  title: { opacity: 0.85, overflowWrap: 'anywhere' },

  type: { fontSize: '0.6rem' },
  /*
   * A hard-ruled box rather than a colour: the design rules put state on
   * border plus shape plus label, and this must stay legible on both the white
   * and dandelion row backgrounds. No radius, no fill.
   */
  /*
   * The month band. Ink block, dandelion type: the inverse of a yellow row, so
   * a scan down the list reads the bands as structure rather than as entries.
   * Zero radius and a hard edge, like everything else here.
   */
  monthBand: {
    listStyle: 'none',
    background: 'var(--ink)',
    color: 'var(--dandelion)',
    padding: '0.45rem 0.75rem',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    borderTop: '2px solid var(--ink)',
  },
  provenance: {
    fontSize: '0.6rem',
    border: '1px solid currentColor',
    padding: '0.05rem 0.3rem',
    opacity: 0.75,
  },

  empty: { margin: '0.5rem 0 0' },
  emptyHint: { margin: '0.25rem 0 0', opacity: 0.7, fontSize: '0.85rem' },
};
