/**
 * Configuration, read once from the environment.
 *
 * Nothing about Berlin or any particular person belongs in source. The city is
 * config, the windows are config, the contact address is config. An adapter
 * that hardcodes a city is a bug: someone in Lisbon should get Lisbon gigs from
 * the same build.
 */

export interface Config {
  city: string;
  timezone: string;
  releaseWindowMonthsBack: number;
  releaseWindowMonthsForward: number;
  databasePath: string;
  musicbrainzContact: string | null;
  spotify: { clientId?: string; clientSecret?: string; redirectUri: string };
  ticketmaster: { apiKey?: string };
  enable: { eventim: boolean; residentAdvisor: boolean; promoterCrawlers: boolean };
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Absent or '0' is off. Anything else is on. */
const flag = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : v !== '0' && v.toLowerCase() !== 'false';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    city: env.BANDELION_CITY?.trim() || 'Berlin',
    timezone: env.BANDELION_TIMEZONE?.trim() || 'Europe/Berlin',
    releaseWindowMonthsBack: num(env.RELEASE_WINDOW_MONTHS_BACK, 4),
    releaseWindowMonthsForward: num(env.RELEASE_WINDOW_MONTHS_FORWARD, 2),
    databasePath: env.DATABASE_PATH?.trim() || './data/bandelion.db',
    musicbrainzContact: env.MUSICBRAINZ_CONTACT?.trim() || null,
    spotify: {
      clientId: env.SPOTIFY_CLIENT_ID?.trim() || undefined,
      clientSecret: env.SPOTIFY_CLIENT_SECRET?.trim() || undefined,
      // Whatever is registered on the Spotify app; Spotify compares it as an
      // exact string, so a stray trailing slash is an auth failure.
      redirectUri:
        env.SPOTIFY_REDIRECT_URI?.trim() ||
        'http://127.0.0.1:3000/api/auth/callback/spotify',
    },
    ticketmaster: { apiKey: env.TICKETMASTER_API_KEY?.trim() || undefined },
    enable: {
      eventim: flag(env.ENABLE_EVENTIM, true),
      residentAdvisor: flag(env.ENABLE_RESIDENTADVISOR, true),
      promoterCrawlers: flag(env.ENABLE_PROMOTER_CRAWLERS, true),
    },
  };
}

/**
 * The window the feed covers, as ISO dates.
 *
 * Releases look backward (what came out that I missed) and gigs look forward
 * (what can I still go to), so they do not share a window. `to` is deliberately
 * far out for gigs: Berlin shows are announced up to 14 months ahead, and the
 * feed sorts by urgency rather than date, so a distant show costs nothing.
 */
export function windowFor(
  kind: 'release' | 'gig',
  cfg: Config,
  now = new Date(),
): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (months: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + months);
    return d;
  };

  if (kind === 'release') {
    return {
      from: iso(shift(-cfg.releaseWindowMonthsBack)),
      to: iso(shift(cfg.releaseWindowMonthsForward)),
    };
  }
  return { from: iso(now), to: iso(shift(18)) };
}
