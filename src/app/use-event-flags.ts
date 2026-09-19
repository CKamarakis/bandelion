/**
 * Client-side flag state for a list of events.
 *
 * Optimistic: the mark flips on the press and the request follows. A toggle
 * that waits for a round-trip feels broken on a list you are working through
 * quickly, and this is a personal instance talking to localhost — the request
 * is not the slow part.
 *
 * The overlay only holds events that have actually been toggled in this page's
 * lifetime. Everything else reads through to the flags the server rendered, so
 * a row nobody touched has exactly one source of truth.
 */

'use client';

import { useCallback, useState } from 'react';
import type { FeedItem } from '../db/index.ts';

export type FlagName = 'queued' | 'listened' | 'favorited';

/** What a row's flags are now, server value overridden by any local change. */
export type FlagOverlay = Readonly<Record<number, Partial<Record<FlagName, boolean>>>>;

export function flagOf(item: FeedItem, overlay: FlagOverlay, flag: FlagName): boolean {
  return overlay[item.eventId]?.[flag] ?? item[flag];
}

export function useEventFlags() {
  const [overlay, setOverlay] = useState<FlagOverlay>({});
  /*
   * Which (event, flag) pairs are mid-request, so a row can say so and a
   * double-press cannot send two conflicting writes. Keyed by `id:flag` rather
   * than by id: the tick and the heart are independent and pressing one must
   * not lock the other.
   */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(async (eventId: number, flag: FlagName, next: boolean) => {
    const key = `${eventId}:${flag}`;

    setOverlay((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [flag]: next } }));
    setPending((prev) => new Set(prev).add(key));

    try {
      const res = await fetch(`/api/events/${eventId}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [flag]: next }),
      });
      if (!res.ok) throw new Error(`state write failed: ${res.status}`);
    } catch (err) {
      /*
       * Put it back. A mark that stayed on after the write failed would be the
       * screen asserting something the database does not hold — the copy rule
       * applied to state rather than to a string.
       */
      console.error('[flags] reverting toggle:', err);
      setOverlay((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [flag]: !next } }));
    } finally {
      setPending((prev) => {
        const out = new Set(prev);
        out.delete(key);
        return out;
      });
    }
  }, []);

  const isPending = useCallback(
    (eventId: number, flag: FlagName) => pending.has(`${eventId}:${flag}`),
    [pending],
  );

  return { overlay, toggle, isPending };
}
