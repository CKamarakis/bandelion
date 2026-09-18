/**
 * Cover Art Archive: sleeve images for a release-group.
 *
 * The companion project to MusicBrainz, keyed by the same MBIDs, free and
 * unauthenticated. This is the only image source available for releases:
 * MusicBrainz release-group records carry a title, a date and a type, and no
 * artwork at all.
 *
 * Two things shape this file:
 *
 *  - **A missing cover is the normal case, not a failure.** Obscure releases
 *    frequently have no art, and the archive answers that with a 404. That is
 *    a real answer and is recorded as "checked, has none", so a later run does
 *    not ask again. Only a transport fault or a 5xx is a failure worth retrying.
 *  - **Never throws**, like every adapter here (constraint 2). A dead archive
 *    degrades to a feed of text rows, which is what the feed was yesterday.
 *
 * The redirect matters: `/release-group/{mbid}/front` answers 307 to an
 * archive.org URL. We follow it and store where we landed, because the final
 * URL is what an <img> needs and resolving it once per release is cheaper than
 * every reader's browser doing it.
 */

const CAA = 'https://coverartarchive.org';

/**
 * Politeness. The archive publishes no documented rate limit, and it fronts
 * archive.org, so this is the same one-per-second discipline MusicBrainz asks
 * for rather than a number they gave us.
 */
export const MIN_INTERVAL_MS = 1100;

export interface CoverArtOptions {
  /** Sent as User-Agent, same contact string the MusicBrainz client uses. */
  contact: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export interface CoverResult {
  /** The image URL, or null when the archive has no art for this release. */
  url: string | null;
  /**
   * False only when we could not get an answer. A 404 is `checked: true` with
   * a null url: the archive told us there is nothing, which is information.
   */
  checked: boolean;
  error?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The front cover for a release-group, or null if it has none.
 *
 * `size` is 250 or 500; the archive also serves 1200 and the original, which
 * are far larger than a feed row needs. 250 is a thumbnail, and a feed of 100
 * rows is 100 images.
 */
export async function fetchFrontCover(
  releaseGroupMbid: string,
  opts: CoverArtOptions,
  size: 250 | 500 = 250,
): Promise<CoverResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const attempts = 3;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${CAA}/release-group/${releaseGroupMbid}/front-${size}`, {
        headers: { 'User-Agent': opts.contact },
        redirect: 'follow',
        signal: opts.signal,
      });
    } catch (err) {
      // An aborted signal is the operator stopping the job, not a fault.
      if (opts.signal?.aborted) throw err;
      if (attempt === attempts - 1) {
        return { url: null, checked: false, error: errorText(err) };
      }
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
      continue;
    }

    /*
     * 404 means this release-group has no cover art. It is the single most
     * common response for a back catalogue and must not be retried or recorded
     * as an error: doing so would make a normal absence look like a broken
     * source in adapter_health.
     */
    if (res.status === 404) return { url: null, checked: true };

    if (res.status === 503 || res.status >= 500) {
      if (attempt === attempts - 1) {
        return { url: null, checked: false, error: `cover art archive ${res.status}` };
      }
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
      continue;
    }

    if (!res.ok) {
      return { url: null, checked: false, error: `cover art archive ${res.status}` };
    }

    /*
     * res.url is where the redirect landed. Falling back to the request URL
     * would store a link that redirects on every page view, which is a request
     * per image per reader.
     */
    return { url: res.url || `${CAA}/release-group/${releaseGroupMbid}/front-${size}`, checked: true };
  }

  return { url: null, checked: false, error: 'exhausted attempts' };
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
