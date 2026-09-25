# Design

## Context

See `proposal.md` for why. What shapes the approach:

- Two tests read docs by path: `tests/docs.mjs` (CLAUDE.md architecture and
  commands, LIMITS format and ids, LIMITS→DECISIONS citations) and
  `tests/contrast.mjs` (every hex in PALETTE.md must ship in `globals.css`).
- References to docs that move or go: README's documentation table,
  CLAUDE.md prose, `.claude/skills/triage/SKILL.md` (TRIAGE.md),
  `src/app/globals.css:805` (PALETTE.md), `tests/matcher.mjs:7` and
  `DECISIONS.md:568` (PLAYBOOK).
- `HANDOVER.md` holds one item found nowhere else: MusicBrainz `image`
  relations → Wikimedia Commons thumbnails, as the only image source for liked
  artists. `LIMITS.md` does not mention it.

## Goals / Non-Goals

**Goals:**
- Every behaviour claim lives in exactly one place, `openspec/specs/`.
- No doc is lost without its still-true content landing somewhere named.
- `npm run verify` stays green at every commit of the change.

**Non-Goals:**
- Fixing behaviour the specs expose as wrong (see Conflicts below). Those are
  separate changes.
- Rewriting DECISIONS entries. They are history and stay as written.
- Changing `openspec/config.yaml` (see Open Questions).

## Decisions

### 1. Specs describe the code, not the docs
Each spec was written from the source and the assertions in `tests/`, not from
prose. Where prose and code disagree, the spec follows the code and the
disagreement is listed below for a decision. *Alternative:* write the intended
behaviour and treat the code as buggy — rejected, because a spec that fails on
day one teaches everyone to ignore specs.

### 2. Move files, keep their names
Reference docs move with `git mv` into `docs/` under their current uppercase
names (`docs/DECISIONS.md`, `docs/LIMITS.md`, …). History and blame follow,
and every reference changes by a `docs/` prefix only. *Alternative:* rename to
lowercase — rejected as churn with no reader benefit.

### 3. PALETTE and the design section become `docs/DESIGN.md`
CLAUDE.md's Design section and PALETTE.md merge into one file, with PALETTE's
hex table kept verbatim so `tests/contrast.mjs` parses it unchanged apart from
the path. *Alternative:* keep PALETTE separate — viable, but the rules and the
colours are read together and were already cross-referencing.

### 4. What CLAUDE.md keeps
What this is, the artifact sentence, commands, the architecture listing, the six
constraints, conventions, working-with-me, and a pointer table to
`openspec/specs/` and `docs/`. The Domain rules section becomes one line per
rule pointing at its spec. The Spotify ceiling moves to `docs/SPOTIFY.md` with
its sources, because README's "why you run your own copy" already summarises it
for users. Session lore (screenshot traps, fractional-rem seam, inline-style
precedence) moves to a "Traps" section in `docs/TESTING.md`.

**Amended during apply:** the Domain rules text moved verbatim to
`docs/PRODUCT.md`, with CLAUDE.md keeping a rule → spec table. Specs hold the
SHALLs but not each rule's *why* and *would change if*, and the gig rules have
no spec at all, so a pointer-only CLAUDE.md would have dropped that reasoning.

### 5. Deleted docs land content first
- `HANDOVER.md`: the image item becomes a new `LIMITS.md` entry; its traps go
  to `docs/TESTING.md`; the rest is superseded and dropped.
- `PLAYBOOK.md`: the "tests that mirror the implementation" failure mode moves
  to `docs/TESTING.md` so `tests/matcher.mjs` and `DECISIONS.md:568`
  have a target; the "four decisions" are already answered in CLAUDE.md.
- `DECISIONS.md:568` keeps its wording (history) with a bracketed note that
  PLAYBOOK was folded into `docs/TESTING.md`.

### 6. `tests/docs.mjs` reads doc paths from one constant
A single `DOCS_DIR` in the test; checks unchanged. New check: every path in
README's documentation table exists. Verified by mutation: point the table at a
missing file, confirm it fails, restore.

### 7. Stale claims are fixed in place
- L09 ("the feed does not exist") is closed with the date and what shipped.
- DECISIONS 015 gets an appended correction: the Docker files were never
  committed; `docker-and-ci` writes them.
- VENUES "stage 5" → the future gigs change.
- README "Nothing auto-accepts a name search yet" and CLAUDE.md's "`resolve`
  auto-accepts nothing from a name search" → updated for triage (044).

## Conflicts found while writing specs

Code and docs disagree here. The specs follow the code; each needs a decision,
outside this change:

- **Rejected review rows may be re-asked.** CLAUDE.md says rejecting "marks the
  row `rejected` rather than deleting it, because a deleted row is re-asked on
  the next sweep". `resolve` selects every artist with no MBID, and
  `queueForReview` de-duplicates against *pending* rows only, so a rejected
  artist appears to be queued again on the next run. Not yet reproduced; the
  `review-queue` spec asserts only that the row is kept as rejected.
- **"Recently added" is really "recently marked".** CLAUDE.md says the order
  is "the order the rows were saved in". Every flag write bumps
  `event_state.updated_at`, and the list orders by it, so ticking "listened"
  on an old save moves it to the top. The `event-flags` spec describes the
  code; whether that is the wanted behaviour is open.

## Risks / Trade-offs

- [Broken links to moved files, from outside the repo] → Accepted; the repo is
  personal. README's table is tested so the in-repo index cannot rot.
- [Specs drift from code the same way docs did] → Specs are scenario-shaped, so
  each scenario can name the test that covers it in a follow-up; not in scope.
- [CLAUDE.md loses context an agent relied on] → Pointer table plus the
  architecture listing; `/opsx:*` workflows read `openspec/specs/` directly.

## Migration Plan

One commit per task group, `npm run verify` green at each. Rollback is a git
revert; nothing outside docs, tests and two comments changes.

## Open Questions

- Should `openspec/config.yaml`'s `context` shrink to a pointer at CLAUDE.md?
  It restates the constraints. Deferrable: it changes no spec or task here.
