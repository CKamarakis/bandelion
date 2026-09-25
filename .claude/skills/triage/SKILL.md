---
name: triage
description: Work the artist review queue, or change the rules that decide it automatically. Use when adding or altering a triage rule, when reading the queue to find a new pattern, or when asked why a particular artist was or was not resolved. Enforces the measure-first method and runs the triage and resolve suites.
---

# Artist triage

Deciding which MusicBrainz candidate is the artist you follow, without asking a
human every time and without ever merging two bands.

The rules live in `src/matcher/triage.ts`. `tests/triage.mjs` holds a real
queue row for each one. `docs/TRIAGE.md` is the log of what was measured, what was
ruled out, and why.

## The invariant, above every rule

**Two artists must never share an MBID.** The roster holds two bands called
WITCH and two called Pentagram. MusicBrainz answers "WITCH" and "Witch" with
byte-identical candidate lists topped by the Zambian band, so any rule shaped
like "take the top score" merges them, and the feed then shows one band's
records under the other's name with nothing on screen saying so.

`tests/resolve.mjs` asserts this directly. Any new rule has to keep it true.

## The method, in order

1. **Read the queue before writing a rule.** Query `match_queue` and look at
   real rows. Every rule that exists came from a pattern someone saw; none was
   designed in advance.
2. **Measure the rule against all pending rows** before implementing it: how
   many does it accept, how many does it leave, and does it ever hand two
   artists the same MBID. A rule that cannot be counted is not ready.
3. **Write the test from the real row**, names and disambiguation text
   verbatim. A rule tested against an invented example tests the invention.
4. **Verify the test catches the break.** Remove the rule, confirm the suite
   fails, restore. A rule whose removal changes nothing is either redundant or
   untested, and both need to be known — the word-count rule turned out to
   change no outcome on the real queue and needed a case built for it.
5. **Run `npm run eval:matcher`.** CLAUDE.md requires a matcher change to
   prove itself there. It covers the listing matcher rather than triage, so
   the expectation is *no regression*, not improvement.
6. **Record it in `docs/TRIAGE.md`**, including rules that were considered and
   rejected. The rejections are the part that saves the next person time.

## Rules of thumb, learned from the queue

- **Fail toward the human.** Every rule returns "cannot decide" rather than a
  guess. The cost of a wrong MBID is invisible; the cost of an extra queued row
  is one click.
- **A rule that reads the data beats a rule that reads the string.**
  MusicBrainz types its entries, so a Trolls character is `type: Character` and
  needs no description parsing.
- **Check whether the answer is even in the list.** "Tripes" scored a perfect
  exact match against a French jazz trio while the real band, Τρύπες, was
  absent entirely — the fix was querying `alias:` as well as `artist:`, not a
  cleverer rule. Triage cannot rescue a candidate list that omits the answer.
- **Case is signal, not noise.** `GRENADE`, `The IronY`, `YAME`. Bands choose
  odd spelling to be findable, so it breaks ties that nothing else can.
- **Beware a rule that is really rule 2 in disguise.** Different word count
  usually implies a different normalised name, so the exact-match test has
  already excluded it.

## How to run this

```bash
node tests/triage.mjs        # the rules, against real queue rows
node tests/resolve.mjs       # the job, including the anti-merge assertion
npm run eval:matcher         # required before any matcher change ships
npm run ingest resolve       # re-run resolution; paced at 1.1s per artist
```

**Re-running matters.** A rule change does nothing to rows already queued: the
payloads were recorded by the old query. Back up `data/bandelion.db` first, as
resolution writes MBIDs that are tedious to unpick.
