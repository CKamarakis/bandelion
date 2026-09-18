/**
 * Formatting for feed rows.
 *
 * Separate from the component so it is testable without rendering, and so the
 * date rule lives in one place. That rule is the whole reason this file exists:
 * **never show more precision than the source gave us.**
 *
 * Half of all MusicBrainz release dates carry no day (measured: 1,238 of 2,382
 * in a two-month window). Rendering "2027" as "31 Dec 2027" would be the same
 * class of bug as "Tickets on sale Friday" when we failed to parse a status —
 * the screen asserting something the data does not know.
 */

export type DatePrecision = 'day' | 'month' | 'year';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A date as precisely as we actually know it, and no more.
 *
 * '2027-03-14' → '14 Mar 2027'
 * '2027-03'    → 'Mar 2027'
 * '2027'       → '2027'
 *
 * The shorter forms are the point, not a fallback: a card reading "2027" tells
 * the reader we know the year and not the day, which is true and useful.
 */
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The band a row sits under in the list: 'SEPTEMBER 2026'.
 *
 * Returns null when the row cannot be placed in a month. A year-only release
 * genuinely has no month, and inventing one to give it a heading would be the
 * same lie `formatEventDate` exists to prevent — so those group under their
 * year, and an undated row under nothing at all.
 */
export function monthGroup(date: string | null, precision: DatePrecision): string | null {
  if (!date) return null;

  const [y, m] = date.split('-');
  if (precision === 'year' || !m) return y ?? null;

  const month = MONTHS_LONG[Number(m) - 1];
  return month ? `${month} ${y}` : (y ?? null);
}

/**
 * How a month group is labelled in the filter, as opposed to in the list.
 *
 * A year-only group is '2026' in the list, where it sits in date order among
 * the months and reads correctly. In a dropdown beside 'November 2026' it
 * reads as a broken entry, so it says what it actually is: releases we know
 * the year of and not the month.
 */
export function monthFilterLabel(group: string): string {
  return /^\d{4}$/.test(group) ? `${group}, month unknown` : group;
}

export function formatEventDate(date: string | null, precision: DatePrecision): string {
  if (!date) return 'No date';

  const [y, m, d] = date.split('-');
  if (precision === 'year' || !m) return y;
  const month = MONTHS[Number(m) - 1] ?? m;
  if (precision === 'month' || !d) return `${month} ${y}`;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * How far away, in words, for a dated upcoming release.
 *
 * Returns null when the answer would be a guess. A month- or year-precision
 * date cannot honestly be counted in days: "2027" is somewhere in a 365-day
 * span, and "in 421 days" would invent a day we never had.
 */
export function relativeDays(
  date: string | null,
  precision: DatePrecision,
  today: string,
): string | null {
  if (!date || precision !== 'day') return null;

  const then = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;

  const days = Math.round((then - now) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 61) return `In ${Math.round(days / 7)} weeks`;
  return null;
}

/**
 * The type badge.
 *
 * Kept as the source's own vocabulary rather than collapsed to "release": the
 * difference between an album and a remix is exactly what a reader filters on,
 * and *volume is the risk* — 111 of 225 rows in the first real sweep were
 * singles.
 */
export function releaseTypeLabel(type: string): string {
  switch (type) {
    case 'album':
      return 'Album';
    case 'ep':
      return 'EP';
    case 'single':
      return 'Single';
    case 'live':
      return 'Live';
    case 'compilation':
      return 'Compilation';
    default:
      // 'other' covers remixes, demos, soundtracks and DJ mixes — genuinely
      // assorted, so a vaguer label is the honest one.
      return 'Other';
  }
}

/** `BND 0042`, the catalogue number. Honest: it is the event's real row id. */
export function catalogueNumber(eventId: number): string {
  return `BND ${String(eventId).padStart(4, '0')}`;
}
