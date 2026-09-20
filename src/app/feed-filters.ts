/**
 * Filtering and sorting for the feed.
 *
 * Separate from `Feed.tsx` because that file is a client component and cannot
 * be imported by a Node test. These are the decisions worth testing — which
 * row belongs in which category, and where a partial date sorts — so they live
 * where a test can reach them.
 */

export type CategoryId = 'all' | 'album' | 'single' | 'live' | 'other';
export type StatusId = 'all' | 'coming' | 'released';
export type SourceId = 'all' | 'followed' | 'liked';
export type SortId = 'desc' | 'asc';

/** The shape these predicates actually need. Keeps the tests honest about it. */
interface Filterable {
  releaseType?: string;
  isUpcoming?: boolean;
  eventDate?: string | null;
  followed?: boolean;
  liked?: boolean;
}

/**
 * What kind of record this is — not whether it is out yet.
 *
 * Compilations count as albums: they are album-length records rather than a
 * kind of their own, and at four rows out of 225 a separate category would be
 * one nobody filters by.
 */
export function inCategory(item: Filterable, category: CategoryId): boolean {
  switch (category) {
    case 'album':
      return item.releaseType === 'album' || item.releaseType === 'compilation';
    case 'single':
      return item.releaseType === 'single' || item.releaseType === 'ep';
    case 'live':
      // A released concert recording — a record you can play, not a ticket.
      // Gigs are a different event type and do not appear here.
      return item.releaseType === 'live';
    case 'other':
      // Remixes, soundtracks, demos, DJ mixes. Vague on purpose: the contents
      // genuinely are assorted, and 20 of 25 are remixes.
      return item.releaseType === 'other';
    default:
      return true;
  }
}

/**
 * Whether it is out yet.
 *
 * Independent of category by design. "Coming" was a category alongside Albums
 * once, which made "albums that are not out yet" unreachable — two different
 * questions sharing one control.
 */
export function inStatus(item: Filterable, status: StatusId): boolean {
  if (status === 'coming') return Boolean(item.isUpcoming);
  if (status === 'released') return !item.isUpcoming;
  return true;
}

/**
 * Which list the artist came from.
 *
 * Both flags can be true at once — 477 of 1,408 liked artists are also
 * followed — so these are membership tests, not a partition. "Followed" means
 * *is followed*, whether or not it is also liked; filtering to one list never
 * hides a row from the other.
 *
 * Independent of category and status for the same reason those are independent
 * of each other: "unreleased albums by artists I only liked" is a question
 * someone can ask, and folding any two of these into one control makes it
 * unaskable.
 */
export function inSource(item: Filterable, source: SourceId): boolean {
  if (source === 'followed') return Boolean(item.followed);
  if (source === 'liked') return Boolean(item.liked);
  return true;
}

export type WeekId = 'last' | 'this' | 'next';

/**
 * How a saved list is ordered.
 *
 * Two genuinely different questions, which is why this is a control rather
 * than a default someone has to live with:
 *
 * - `month` groups by release date, newest first, the way the feed does. This
 *   is what you want when the list is a plan: what is out, what is coming.
 * - `added` is the order you saved them in, most recent first, with no
 *   sections. This is what you want when the list is a queue: the thing you
 *   just put there is at the top.
 *
 * `month` is the default because a playlist is read more often than it is
 * added to, and because it matches the feed the rows came from.
 */
export type ListOrderId = 'month' | 'added';

/**
 * Sort a saved list, given the order the query returned.
 *
 * `getFlaggedEvents` already orders by when the flag was set, newest first, so
 * `added` is the identity: re-sorting it would need an `updated_at` the feed
 * row does not carry. `month` sorts by release date, newest first, which is
 * the feed's own default.
 *
 * Returns a new array either way, so the caller can never mutate a prop by
 * sorting in place.
 */
export function orderList<T extends Filterable>(items: T[], order: ListOrderId): T[] {
  if (order === 'added') return [...items];
  return [...items].sort(byDate('desc'));
}

/**
 * The rows a saved list shows, in the order it shows them.
 *
 * Filtering and ordering together, as one call, because the bug this exists to
 * prevent was the two coming apart: `flagOf` reported correctly that a record
 * had been un-hearted, and the favs page rendered it anyway, because nothing
 * applied that answer before ordering. A component that calls this gets both
 * or neither.
 *
 * `isOn` is supplied by the caller rather than imported, so this file stays
 * free of React and of the overlay type. SavedList passes `flagOf` bound to
 * its own state and to the flag that names the list.
 */
export function visibleList<T extends Filterable>(
  items: T[],
  isOn: (item: T) => boolean,
  order: ListOrderId,
): T[] {
  return orderList(items.filter(isOn), order);
}

/** A gap in the page list, where numbers were left out. */
export const PAGE_GAP = 'gap';

/**
 * Which page numbers to show, and where to put gaps.
 *
 * Every page is listed until there are more than `max` of them: with six pages
 * a reader can see all six and pick, and hiding four of them behind an ellipsis
 * to save a few pixels makes the control worse.
 *
 * Past that it windows: first, last, the current page and one either side, with
 * gaps standing in for the rest. First and last are always present because they
 * are the two a reader jumps to most, and the neighbours are what make paging
 * one step at a time possible without the Previous/Next buttons.
 */
export function pageNumbers(
  current: number,
  total: number,
  max = 10,
): (number | typeof PAGE_GAP)[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);

  const keep = new Set<number>([0, total - 1, current]);
  if (current - 1 > 0) keep.add(current - 1);
  if (current + 1 < total - 1) keep.add(current + 1);

  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | typeof PAGE_GAP)[] = [];

  for (let i = 0; i < sorted.length; i++) {
    // A gap only when pages were actually skipped. Two adjacent numbers, or a
    // single missing page, do not earn an ellipsis wider than the number it
    // replaces.
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(PAGE_GAP);
    out.push(sorted[i]);
  }

  return out;
}

/**
 * The Monday that starts the calendar week containing `date`.
 *
 * Monday, not "seven days ago": a release on Sunday belongs to the week that
 * is ending, and counting back from today would put it in the same bucket as
 * next Tuesday. ISO weeks are what people mean by "this week".
 *
 * Works in UTC throughout. The dates we hold are plain 'YYYY-MM-DD' strings
 * with no timezone, so parsing them as local time would shift a release across
 * a day boundary for anyone east or west of UTC, and across a WEEK boundary
 * for a release dated Sunday or Monday.
 */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 is Sunday. Shift so Monday is 0 and Sunday is 6.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week `weeks` away from the one containing `today`. */
export function weekStartFrom(today: string, weeks: number): string {
  const base = new Date(`${weekStart(new Date(`${today}T00:00:00Z`))}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}

/**
 * Whether a release falls in the given calendar week.
 *
 * A date without a day is never in a week. Half of all MusicBrainz dates carry
 * no day, and placing '2026-09' in a week would mean choosing one of four or
 * five, which is exactly the invented precision `formatEventDate` refuses.
 */
export function inWeek(
  item: { eventDate?: string | null; datePrecision?: string },
  week: WeekId | 'all',
  today: string,
): boolean {
  if (week === 'all') return true;
  if (!item.eventDate || item.datePrecision !== 'day') return false;

  const offset = week === 'last' ? -1 : week === 'next' ? 1 : 0;
  const start = weekStartFrom(today, offset);
  const end = weekStartFrom(today, offset + 1);

  // Half-open: the next Monday belongs to the next week, not this one.
  return item.eventDate >= start && item.eventDate < end;
}

/**
 * Split a sorted list into month groups, preserving order.
 *
 * Grouping rather than a per-row comparison because three things now need the
 * same answer: the collapsible sections, the month filter's options, and
 * pagination, which pages whole months rather than slicing one in half. Doing
 * it three times from three places is how they drift apart.
 *
 * `key` is supplied so this file does not import the formatter: the caller
 * decides what a month is called, this decides where the boundaries are.
 */
export function groupByMonth<T>(
  items: T[],
  key: (item: T) => string | null,
): { month: string | null; items: T[] }[] {
  const groups: { month: string | null; items: T[] }[] = [];

  for (const item of items) {
    const month = key(item);
    const last = groups[groups.length - 1];
    // Compare against the previous group only, never a lookup: a month that
    // recurs after a gap is a second section, which is what the sort produced
    // and what the reader sees.
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }

  return groups;
}

/**
 * Sort by date, with partial dates ordered sensibly.
 *
 * String comparison, because ISO dates sort correctly as text and a partial
 * date lands at the start of its period ('2027' before '2027-03-14') — the
 * honest position for a record we only know the year of.
 *
 * `Date.parse` would give the same order here: JS parses '2027' to 1 January
 * 2027, which coincides with where the string sorts. Checked rather than
 * assumed, after a mutation swapping the two failed to break any test. Strings
 * are still preferred: no parsing, no timezone, and nothing that could quietly
 * turn a year into a day if the input shape ever widens.
 *
 * An undated row sorts last in either direction, because it has no place on
 * the timeline at all and pretending otherwise would rank it.
 */
export function byDate(sort: SortId) {
  return (a: Filterable, b: Filterable): number => {
    if (!a.eventDate && !b.eventDate) return 0;
    if (!a.eventDate) return 1;
    if (!b.eventDate) return -1;
    const cmp = a.eventDate.localeCompare(b.eventDate);
    return sort === 'asc' ? cmp : -cmp;
  };
}
