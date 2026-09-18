/**
 * A note you open, rather than a sentence that is always there.
 *
 * The panel's explanatory line ("Import reads the artists you follow...")
 * answers a question you ask once and then never again, so it sat above the
 * buttons taking a line of the most important block on the screen forever.
 * Behind an icon it is still one click away the day you want it.
 *
 * Client component because it holds open/closed state. It is the smallest
 * possible island: the panel around it stays server-rendered.
 */

'use client';

import { useEffect, useRef, useState } from 'react';

const LABEL = 'What this does';

export function InfoNote({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  /*
   * Close on Escape and on a click elsewhere.
   *
   * Both are what a reader expects of anything that pops open, and without
   * them the only way to dismiss this is to find the same small icon again.
   * The listeners are only attached while it is open.
   */
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={wrap} style={S.wrap}>
      <button
        type="button"
        className="info-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={LABEL}
        title={LABEL}
      >
        <span aria-hidden="true">i</span>
      </button>

      {/*
        Rendered only when open rather than hidden with CSS, so a screen
        reader does not read a note nobody asked for.
      */}
      {open ? (
        <div className="info-note" role="note" style={S.note}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  // `relative` so the note can anchor to the icon rather than to the panel.
  wrap: { position: 'relative', flexShrink: 0 },
  note: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    // Wide enough for a sentence, capped so it never spans the whole panel.
    width: 'min(30ch, 70vw)',
    zIndex: 2,
  },
};
