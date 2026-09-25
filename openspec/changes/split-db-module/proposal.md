# Proposal

## Why

`src/db/index.ts` is 1,201 lines with about 35 exported functions covering
connection and migrations, artists, events and the feed, event flags, the
review queue and aliases, source health, job checkpoints, and OAuth tokens.
Every job, route and test imports from it. Gigs (L07) will add a second event
type and several sources to this file, so splitting it now costs less than
splitting it later.

## What Changes

- Split by area into modules under `src/db/`: connection and migrations,
  artists and links, events and feed, flags and lists, review queue and
  aliases, health and jobs, and tokens. The exact grouping is for `design.md`.
- `src/db/index.ts` stays as a re-export barrel, so no importer changes in
  this pass. Moving importers to the specific modules is optional follow-up.
- `MIGRATIONS` and `migrate` stay together and append-only (040).
- `CLAUDE.md` architecture listing updated for the new files.

## Non-goals

- No change to schema, SQL or behaviour. The suite passes unchanged; a test
  edited to make it pass means the refactor changed something.
- No ORM or query builder.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure refactor; `skip_specs: true` is set in `.openspec.yaml`.

## Impact

- `src/db/` only, plus the `CLAUDE.md` listing.
- Risk: circular imports between the new modules (for example, feed queries
  needing artist helpers). A barrel that re-exports everything hides these
  until runtime under strip-types, so `npm run verify` is the check.
