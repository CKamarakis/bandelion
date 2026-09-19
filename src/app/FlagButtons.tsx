/**
 * The three marks: save it, played it, liked it.
 *
 * Each is a toggle carrying its state three ways — fill, glyph and an
 * `aria-pressed` label — because colour never carries meaning alone. A screen
 * reader gets a sentence; everyone else gets a stamp that is either inked or
 * outlined.
 *
 * The glyphs are drawn as inline SVG rather than set as emoji. An emoji bolt or
 * heart renders in whatever colour and weight the platform font decides, which
 * on a flyer built out of flat magenta and ink is the one thing that cannot be
 * allowed to vary.
 */

'use client';

import type { FlagName } from './use-event-flags.ts';

/*
 * Labels, hoisted. Each says what pressing it will do, not what the state is:
 * a button reading "Saved" is ambiguous about whether pressing it saves or
 * unsaves. `aria-pressed` carries the state, so the label carries the action.
 */
const LABELS: Record<FlagName, { on: string; off: string }> = {
  queued: { off: 'Save to playlist', on: 'Remove from playlist' },
  /*
   * "Clear" rather than "Mark as not listened": the negated form of a state
   * makes an awkward instruction, and what the button does is remove a mark
   * rather than assert that you did not hear the record.
   */
  listened: { off: 'Mark as listened', on: 'Clear the listened mark' },
  favorited: { off: 'Add to favs', on: 'Remove from favs' },
};

/* The remove control. Named for the list it acts on, since it sits on both. */
const REMOVE_LABEL: Record<'queued' | 'favorited', string> = {
  queued: 'Remove from playlist',
  favorited: 'Remove from favs',
};

/**
 * The bolt, on its own round ground.
 *
 * A circle, which is the one place this project bends its own zero-radius rule.
 * The rule is about interface chrome pretending to be soft — rounded cards,
 * pill buttons, the SaaS look. This is an ink stamp on a sleeve, the same
 * category as the logo, which is also a black circle and also has no border.
 * Deliberate, discussed, and not a slip to be tidied up later.
 */
export function QueueStamp({
  on,
  pending,
  onToggle,
}: {
  on: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const label = on ? LABELS.queued.on : LABELS.queued.off;

  return (
    <button
      type="button"
      className={`stamp${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      // Not `disabled`: a disabled button loses focus mid-interaction and the
      // press that started the request would move the keyboard to the body.
      aria-busy={pending}
      onClick={onToggle}
    >
      <Bolt />
    </button>
  );
}

/** The row-end marks on the playlist: played it, liked it. */
export function FlagMark({
  flag,
  on,
  pending,
  onToggle,
}: {
  flag: FlagName;
  on: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const label = on ? LABELS[flag].on : LABELS[flag].off;

  return (
    <button
      type="button"
      className={`mark mark-${flag}${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      aria-busy={pending}
      onClick={onToggle}
    >
      {flag === 'favorited' ? <Heart filled={on} /> : <Speaker playing={on} />}
    </button>
  );
}

/**
 * Take a record off this list.
 *
 * Its own control rather than a second press on the mark that put it there:
 * the marks now read as state (heard it, liked it) and removal is a different
 * kind of act. It is last in the row, away from the two you press often, so
 * the destructive one is not the one your thumb finds by accident.
 */
export function RemoveMark({
  list,
  pending,
  onRemove,
}: {
  list: 'queued' | 'favorited';
  pending: boolean;
  onRemove: () => void;
}) {
  const label = REMOVE_LABEL[list];

  return (
    <button
      type="button"
      className="mark mark-remove"
      aria-label={label}
      title={label}
      aria-busy={pending}
      onClick={onRemove}
    >
      <Cross />
    </button>
  );
}

/*
 * The glyphs. 16px viewBoxes, sized by CSS so one drawing serves both the 24px
 * stamp and the larger row marks.
 *
 * aria-hidden on all three: the button around them already carries the label,
 * and a title inside the SVG would be announced twice.
 */

function Bolt() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {/* A hard-angled bolt, no curves: it has to read at 16px on a sleeve. */}
      <path d="M9.5 1 3 9h3.5l-.5 6 6.5-8.5H9L9.5 1z" fill="currentColor" />
    </svg>
  );
}

/*
 * A speaker, silent when off and sounding when on.
 *
 * The state is the two arcs, not the cone: an outlined-versus-filled cone
 * differs only in ink coverage, and the screenshots already proved once that a
 * glyph differing only by fill is unreadable at this size. Sound waves are
 * present or absent, which is a shape difference you can see at a glance and in
 * greyscale.
 *
 * The cone is filled in both states so the glyph keeps its weight on the row
 * and does not appear to fade when a record is unplayed.
 */
function Speaker({ playing }: { playing: boolean }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {/* Body and cone as one path, hard angles to match the flyer type. */}
      <path d="M1.5 6h2.5L7.5 3v10L4 10H1.5V6z" fill="currentColor" />
      {playing ? (
        <>
          <path
            d="M10 5.8a3.4 3.4 0 0 1 0 4.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M12.2 3.6a6.4 6.4 0 0 1 0 8.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </>
      ) : null}
    </svg>
  );
}

/* The remove cross. Two strokes, square caps, no circle around it. */
function Cross() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

/*
 * Outline when off, solid when on.
 *
 * Shape as well as fill, so the two states differ for anyone who cannot see
 * the colour change: an empty heart and a full one are different drawings, not
 * the same drawing in two colours.
 */
function Heart({ filled }: { filled: boolean }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 14S1.5 9.8 1.5 5.7A3.7 3.7 0 0 1 8 3.4a3.7 3.7 0 0 1 6.5 2.3C14.5 9.8 8 14 8 14z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
