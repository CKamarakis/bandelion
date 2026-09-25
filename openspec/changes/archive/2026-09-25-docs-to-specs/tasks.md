# Tasks

## 1. Specs

- [x] 1.1 Run `openspec validate docs-to-specs --strict` and fix every reported issue until it passes
- [x] 1.2 For each of the ten specs, read each scenario against the assertion text in `tests/*.mjs` and correct any scenario the code does not do; verify by listing, per spec, the suite that covers it in the commit message

## 2. Move reference docs

- [x] 2.1 `git mv` DECISIONS, LIMITS, TRIAGE, VENUES, TESTING into `docs/`; verify `git status` shows renames, not delete+add
- [x] 2.2 Point `tests/docs.mjs` at the new LIMITS and DECISIONS paths through one `DOCS_DIR` constant; verify `node tests/docs.mjs` passes, then point it at a missing path, confirm it fails, restore
- [x] 2.3 Update references to the moved files in README's documentation table, CLAUDE.md prose and `.claude/skills/triage/SKILL.md`; verify `grep -rn` for each bare filename outside `docs/` and `openspec/` finds only `docs/`-prefixed mentions

## 3. Design doc

- [x] 3.1 Create `docs/DESIGN.md` from CLAUDE.md's Design section plus PALETTE.md, keeping PALETTE's hex table verbatim, and `git mv` PALETTE.md so history follows; verify the table is byte-identical to the original
- [x] 3.2 Point `tests/contrast.mjs` at `docs/DESIGN.md` and update the `src/app/globals.css` comment; verify `node tests/contrast.mjs` passes, then add a fake hex to the table, confirm it fails, restore

## 4. Fold in and delete HANDOVER and PLAYBOOK

- [x] 4.1 Add a LIMITS entry for the MusicBrainz `image` relation → Wikimedia Commons thumbnails idea from HANDOVER, in the documented format; verify `node tests/docs.mjs` passes the LIMITS format and id checks
- [x] 4.2 Add a Traps section to `docs/TESTING.md` carrying HANDOVER's still-true traps, CLAUDE.md's screenshot, fractional-rem and inline-style notes, and PLAYBOOK's "tests that mirror the implementation" failure mode; verify each moved note appears exactly once in the repo
- [x] 4.3 Repoint `tests/matcher.mjs:7` to `docs/TESTING.md` and add a bracketed note at `DECISIONS.md:568`; delete HANDOVER.md and PLAYBOOK.md; verify `grep -rn "HANDOVER\|PLAYBOOK"` outside `openspec/` returns only the bracketed note

## 5. Slim CLAUDE.md

- [x] 5.1 Move the Spotify ceiling section, with its sources, to `docs/SPOTIFY.md`; verify every source URL survived the move
- [x] 5.2 Replace the Domain rules section with one line per rule pointing at its spec under `openspec/specs/`, and add a pointer table to `openspec/specs/` and `docs/`; verify every rule in the old section maps to a spec requirement or a `docs/` file (list the mapping in the commit message)
- [x] 5.3 Update the Architecture listing for `docs/` and `openspec/`; verify `node tests/docs.mjs` passes. Target amended 2026-09-25: CLAUDE.md lands at 275 lines, not ~150, accepted by the owner — what remains is working rules and the tested architecture listing

## 6. Fix stale claims

- [x] 6.1 Close LIMITS L09 with the date and what shipped; append a correction to DECISIONS 015 (Docker files never committed, `docker-and-ci` writes them); replace "stage 5" in `docs/VENUES.md` with the gigs change; verify `grep -n "stage 5\|does not exist" docs/` finds nothing stale
- [x] 6.2 Update README's "Nothing auto-accepts a name search yet" and CLAUDE.md's "auto-accepts nothing from a name search" to reflect triage (decision 044); verify by re-reading both against `src/matcher/triage.ts`

## 7. README documentation index

- [x] 7.1 Rewrite README's documentation table for the new layout, including `openspec/specs/` and dropping the provenance paragraph about PLAYBOOK
- [x] 7.2 Add a `tests/docs.mjs` check that every path in README's documentation table exists; verify it passes, then point one row at a missing file, confirm it fails, restore

## 8. Integration

- [x] 8.1 Run `npm run verify` once and capture the output; it must be green
- [x] 8.2 Grep the repo (excluding `node_modules`, `.next`, `openspec/changes/archive`) for every old root doc name without a `docs/` prefix; verify zero hits beyond README and CLAUDE.md themselves
