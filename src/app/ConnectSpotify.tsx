'use client';

/**
 * The Spotify connect button.
 *
 * Opens the consent screen in a popup and waits for the callback to post the
 * result back, rather than navigating the whole tab away.
 *
 * Two things make popups fragile, and both are handled here:
 *
 *  - Blockers only allow a popup opened synchronously in a click handler. So
 *    `window.open` is the first statement in the handler, before any await.
 *  - A blocked or closed popup leaves the page waiting forever. If the open
 *    fails we navigate instead, and a poll notices a window closed without a
 *    result so the button never stays stuck on "Connecting".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const CONNECT_CTA = 'Connect Spotify';
const CONNECTING = 'Connecting';

/*
 * Shown when the popup closed without reporting anything. Deliberately vague
 * about the cause: we genuinely do not know whether it was closed by hand or
 * blocked, and rule 8 forbids asserting a reason we did not observe.
 */
const CLOSED_MESSAGE = 'Sign-in did not finish. Try again.';

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 740;

/** Spotify's own mark, inlined so the button never waits on a network image. */
function SpotifyMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14 4.38-1.32 9.78-.66 13.5 1.62.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.1 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.32-1.32 11.34-1.02 15.78 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z" />
    </svg>
  );
}

/*
 * Shown when the page is open on a different host than the registered redirect
 * URI. `localhost` and `127.0.0.1` are different origins, so the popup's
 * message would be dropped and the sign-in would appear to hang.
 */
const WRONG_ORIGIN = (expected: string) =>
  `Open Bandelion at ${expected} to sign in. This address does not match the one registered with Spotify.`;

export function ConnectSpotify({ expectedOrigin }: { expectedOrigin: string }) {
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const finish = useCallback((reload: boolean, text: string | null) => {
    setConnecting(false);
    popupRef.current = null;
    if (reload) {
      // The connection state is server-rendered, so a reload is what shows it.
      window.location.assign('/?connected=spotify');
    } else {
      setMessage(text);
    }
  }, []);

  useEffect(() => {
    if (!connecting) return;

    function onMessage(event: MessageEvent) {
      // Only this instance may report an auth outcome. Without this check any
      // page with a handle on this window could claim the sign-in succeeded.
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'bandelion:oauth') return;

      popupRef.current?.close();
      finish(Boolean(data.ok), data.ok ? null : errorText(data.reason));
    }

    window.addEventListener('message', onMessage);

    // A popup closed by hand posts nothing. Without this the button would sit
    // on "Connecting" until the page was reloaded.
    const poll = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        clearInterval(poll);
        finish(false, CLOSED_MESSAGE);
      }
    }, 500);

    return () => {
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
    };
  }, [connecting, finish]);

  function connect() {
    setMessage(null);

    // Catch the origin mismatch before opening anything. Spotify would reject
    // the redirect URI anyway, but this says which address to use instead of
    // leaving the user with a Spotify error page.
    if (window.location.origin !== expectedOrigin) {
      setMessage(WRONG_ORIGIN(expectedOrigin));
      return;
    }

    // Synchronous, before anything else: a popup opened after an await is
    // blocked by every browser.
    const left = window.screenX + Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - POPUP_HEIGHT) / 3);
    const popup = window.open(
      '/api/auth/login?popup=1',
      'bandelion-spotify',
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${Math.round(left)},top=${Math.round(top)}`,
    );

    if (!popup) {
      // Blocked. The redirect flow still works, so use it rather than telling
      // the user to go and change a browser setting.
      window.location.assign('/api/auth/login');
      return;
    }

    popupRef.current = popup;
    popup.focus();
    setConnecting(true);
  }

  return (
    <div>
      <button type="button" className="btn btn-spotify" onClick={connect} disabled={connecting}>
        <SpotifyMark />
        {connecting ? `${CONNECTING}…` : CONNECT_CTA}
      </button>
      {message ? (
        <p style={S.message} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/*
 * The same reasons the redirect flow renders, kept in sync with the map on the
 * page. A code we do not recognise gets the neutral fallback rather than being
 * shown raw.
 */
const REASONS: Record<string, string> = {
  cancelled: 'Spotify sign-in was cancelled.',
  state_mismatch: 'That sign-in link expired. Start again.',
  missing_verifier: 'That sign-in link expired. Start again.',
  no_code: 'Spotify did not return an authorization code.',
  not_configured: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env, then restart.',
  exchange_failed: 'Spotify rejected the sign-in. Check the server log for details.',
};

const errorText = (reason?: string) =>
  (reason && REASONS[reason]) || 'Spotify sign-in did not complete.';

const S: Record<string, React.CSSProperties> = {
  message: {
    margin: '14px 0 0',
    padding: '10px 12px',
    borderLeft: '6px solid var(--violet)',
    background: 'var(--white)',
    fontSize: '0.8rem',
    maxWidth: '52ch',
  },
};
