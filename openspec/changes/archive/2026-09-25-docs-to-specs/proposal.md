# Proposal

## Why

What Bandelion does is described in four places — `CLAUDE.md`'s domain rules,
`README.md`, `DECISIONS.md` and `LIMITS.md` — and they have drifted apart.
Measured on 2026-09-25: `LIMITS.md` L09 says "the feed does not exist" while
`src/app/Feed.tsx` is 839 lines; `DECISIONS.md` 015 says the Docker files are
written, and neither has ever been committed; `VENUES.md` depends on a
"stage 5" that no document defines. `openspec/specs/` is empty, so there is no
single place that says what the system does today.

## What Changes

- **`openspec/specs/` becomes the source of truth for behaviour.** One spec per
  capability, written from what the code and tests do now, not from what the
  docs claim. Where the two disagree, the code wins and the disagreement is
  recorded.
- **`CLAUDE.md` is cut to working rules.** It keeps: what this is, the
  artifact sentence, commands, the architecture listing, the six constraints,
  conventions, and "working with me". The domain rules move into specs; the
  design system moves to `docs/DESIGN.md`; session lore (screenshot traps, the
  fractional-rem seam, inline-style precedence) moves to a Traps section in
  `docs/TESTING.md`; the Spotify ceiling moves to `docs/SPOTIFY.md`. Target: about 150 lines.
- **Reference docs move to `docs/`:** `DECISIONS.md`, `LIMITS.md`,
  `TRIAGE.md`, `VENUES.md`, `PALETTE.md` (merged with the design section),
  `TESTING.md`. `README.md` and `CLAUDE.md` stay at the root.
- **`DECISIONS.md` becomes history only.** Entries stay as written; an entry
  whose rule now lives in a spec gets a one-line pointer to it. Future
  behaviour decisions go into a change's `design.md` and land in specs on
  archive.
- **Removed:** `HANDOVER.md` (self-declared superseded; its still-true traps
  fold into `docs/`) and `PLAYBOOK.md` (inherited from another project; its
  Bandelion answers are already in `CLAUDE.md`). **BREAKING** for anyone
  linking to them.
- **Roadmap = `openspec/changes/`.** The "stage N" wording is replaced by
  change names; `VENUES.md` points at the future gigs change instead.
- **Fix the three stale claims** found above (L09, 015, stage 5).
- **`tests/docs.mjs` follows the move:** it keeps checking `CLAUDE.md`'s
  architecture listing and npm scripts, and additionally checks that every
  doc named in `README.md`'s documentation table exists.

## Capabilities

### New Capabilities

Each codifies behaviour that exists today; none adds behaviour.

- `spotify-auth`: PKCE login, popup with redirect fallback, tokens encrypted at rest, disconnect.
- `roster-import`: followed and liked-song artists into one artist row with list flags; resumable, never deletes.
- `identity-resolution`: MBID by Spotify-URL join first, name search second, triage rules, and the no-shared-MBID invariant.
- `review-queue`: ambiguous names as decisions; accept writes an alias, reject is kept, both sides linked.
- `release-sweep`: MusicBrainz release-groups into events; a second sighting writes nothing.
- `cover-art`: Cover Art Archive lookup, checked once per release.
- `release-feed`: cards, month sections, filters, pagination, date precision.
- `event-flags`: save, listened and liked as three independent flags; the playlist and favs lists and their two orderings.
- `artist-links`: desktop app first with web fallback; web href always.
- `source-health`: adapters never throw; failures recorded as degraded or failing.

Not a spec: the visual design system. It is enforced by `tests/contrast.mjs`
and lives in `docs/DESIGN.md`.

### Modified Capabilities

None — no specs exist yet.

## Impact

- Docs: every root `.md` file except `README.md` and `CLAUDE.md` moves or is
  deleted. References to them are updated in `CLAUDE.md`'s prose,
  `README.md`'s documentation table, and `.claude/skills/triage/SKILL.md`.
- Tests that read docs by path, and must follow the move:
  - `tests/docs.mjs` reads `LIMITS.md` and `DECISIONS.md` at the root (LIMITS
    format, ids, and decision citations). Paths change; checks stay. It is
    also extended to check the README documentation table.
  - `tests/contrast.mjs` reads `PALETTE.md` to assert every documented colour
    ships. If PALETTE merges into `docs/DESIGN.md`, the test reads that file
    and the hex table must survive the merge in a form it can still parse.
- Code comments only: `src/app/globals.css` (names `PALETTE.md`) and
  `tests/matcher.mjs` (cites PLAYBOOK, which is deleted). No behaviour
  changes.
- Open: whether `openspec/config.yaml`'s `context` should shrink once
  `CLAUDE.md` does. It restates the constraints and would drift the same way.
