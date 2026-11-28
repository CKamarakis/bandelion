# Audit follow-ups (2026-11-20)

From the tech-debt audit and the docs-alignment audit next to this file (audited on `docker-and-ci` before it was archived and merged). Tick as fixed.

## Fix before more features
- [ ] **Local network exposure (F02, F03):** `npm run dev` and `npm start` answer the whole local network; bind `-H 127.0.0.1` and add an Origin check on the 4 POST routes. (The Next.js upgrade part of F01 is done: 15.5.29, commit 6e63cb1.)
- [ ] **Announced releases never update (F07):** a re-sighting should refresh date and title, not only novelty. Gigs will reuse this pattern.
- [ ] **Import stuck at "running" (F06, F14):** make "running" expire; catch and stop cleanly in `importCovers`.
- [ ] **Two Spotify profiles, one band (F08, F09):** name the collision instead of "MusicBrainz busy" forever; make the anti-merge test able to fail.
- [ ] **README "Adding other people" (F10):** the app holds one account; rewrite to what's true today.

## Behaviour that differs from the docs
- [ ] A rejected artist is asked about again later (PRODUCT.md:134 vs src/db/index.ts:813-822): decide which is right.
- [ ] "Oldest first" puts released records above upcoming ones.
- [ ] A very large month can merge into the previous page instead of getting its own.
- [ ] "Recently added" orders by last flag change, PRODUCT.md says save order (PRODUCT.md:77).
- [ ] Resolve job reports "complete" when MusicBrainz is down for the whole run (src/jobs/resolve.ts:198-202).

## Docs to correct
- [ ] README still describes the removed "From liked songs" mark (README.md:159-160).
- [ ] Tagline and connect text promise "gigs" (src/app/page.tsx:42, 44-46).
- [ ] `.env.example` timezone setting is read by nothing; weeks are UTC (.env.example:19).

## Smaller
- [ ] `tests/docs.mjs:173` fails on Windows line endings (F22): `\r?\n` or a `.gitattributes`.
- [ ] Test gaps: `jobs/liked.ts`, the cover-art success path, the token-refresh path.
