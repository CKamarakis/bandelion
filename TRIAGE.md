# Artist triage

How a MusicBrainz candidate becomes an artist's identity without a human, and
the measurements behind each rule.

`src/matcher/triage.ts` is the implementation, `tests/triage.mjs` holds a real
queue row for every rule, and `.claude/skills/triage/SKILL.md` is the method
for changing them. This file is the evidence.

## How this differs from the other docs

- `DECISIONS.md` — what was decided and why, across the whole project.
- `LIMITS.md` — what is deferred, and what would lift it.
- **This file** — the queue itself: what was in it, what each rule does to it,
  and which rules were considered and rejected.

---

## Why the queue existed at all

Resolution has two tiers. The first asks MusicBrainz "which artist do you have
for this Spotify URL?", which is an exact join through a relation a human
curated. The second is a name search, and **it auto-accepted nothing** — every
result went to the review queue however obvious it looked.

That was the right default and it is why decision 034 exists: the roster holds
two bands called WITCH and two called Pentagram, and a name query for either
returns the same list topped by the Zambian WITCH. Taking the top score merges
two bands and the feed shows one band's records under the other's name.

But the cost was not what anyone expected.

### The measurement, 2026-09-20

A full resolve pass over 1,556 artists **resolved 0 of the 315 it attempted**,
in 42 minutes:

| Outcome | n |
|---|---|
| Queued for review | 264 |
| No MusicBrainz record at all | 52 |
| Unreachable, MusicBrainz busy | 2 |

Reading the 264 payloads rather than sampling them:

| Shape | n |
|---|---|
| one candidate at score 100, its name the only exact match | 188 |
| one at 100, other candidates share that exact name | 56 |
| one at 100, name not an exact match | 14 |
| several tied at 100 | 6 |
| best candidate below 100 | 0 |

**So the queue was mostly not recording doubt.** 188 rows had one exact-named
candidate and nothing competing. The queue was recording the absence of a rule.

### Why the join failed for them

Not ambiguity. Checked live against MusicBrainz: the entries for
`The Whitest Boy Alive` and `Xaxakes` **carry no Spotify URL relation at all**,
so there was nothing for tier one to join on. Small bands, thinly edited.

---

## The rules

Each came from reading real rows. Each fails toward the human.

### 1. A candidate must have the same word count

MusicBrainz answers "GRENADE" with `Daisy Grenade` and `Hate Grenade`, and
"Steak" with `Monkey Steak` and `Chuck Steak`. A band does not have a different
number of words in its name.

**Measured:** affects 59 rows, removes 111 candidates.

**Caveat, found by mutation testing.** Removing this rule changed **no outcome**
on the real queue, because a different word count almost always implies a
different normalised name, which rule 2 already rejects. It survives for the
case where it genuinely decides: `The Sword` and `TheSword` normalise to the
same string (spaces are stripped) and are different bands. `tests/triage.mjs`
carries that case because the real queue did not.

**It never empties the list.** If no candidate matches on length, the filter is
skipped — `Evesdroppers` must still reach a human with `The Evesdroppers`
visible rather than with nothing.

### 2. The name must match exactly after normalisation

Case, accents and punctuation removed. Anything less is a different band.

**Deliberately not `normalizeName` from `src/matcher/normalize.ts`.** That one
strips leading articles for the listing matcher; here the article is
information, because `Sword` and `The Sword` are different bands.

### 3. Exact spelling breaks a tie

When normalisation leaves several candidates and exactly one reproduces the
spelling, that one is the artist. Bands choose odd capitalisation to be
identifiable.

**Measured:** decides 10 rows. `The IronY` over `The Irony`, `GRENADE` over two
acts called `Grenade`, `Vast` over `VAST`, `YAME` over `Yamê`,
`Quest For Fire` over `Quest for Fire`.

**This is also what keeps the two WITCHes apart**, which no previous rule
managed: `WITCH` matches `WITCH`, `Witch` matches `Witch`, two distinct MBIDs.
Worth noting the correct answer sometimes scores *lower* — `The IronY` is 99
against `The Irony` at 100 — so this is not "take the top score" wearing a hat.

### 4. A collaboration credit is not either artist

MusicBrainz files `Giannis Aggelakas x Nikos Veliotis` as its own artist, and
it is the answer to neither name alone.

**The rule reads the sides, not the letter.** `Terror X Crew` is a real band on
this roster whose name contains an x; splitting it gives `Terror` and `Crew`,
neither of which is the raw name, so it is not a collaboration and still
matches itself.

**Measured:** 4 real collab rows, 1 counter-case.

### 5. Non-musical entities are never the artist

MusicBrainz types its entries. `Mr. Dinkles` comes back twice: a Seattle rock
band (`Group`) and a Trolls character (`Character`).

Reading the structured `type` field beats parsing the free-text description,
which was the first idea. **An absent type passes** — MusicBrainz leaves it
blank often enough that treating absence as disqualifying would reject real
bands.

---

## The fix that was not a rule

**Tripes.** The queue offered `Tripes` (French jazz trio) at score 100,
`tripes` (Mauritius) at 98, `Bad Tripes` at 95. Rule 3 would have accepted the
French trio with full confidence.

The real band is **Τρύπες**, a Greek group, and it was not in the candidate
list at all. MusicBrainz holds `Tripes` and `Trypes` as *aliases* of Τρύπες,
and `searchByName` only ever queried `artist:`.

```
artist:"Tripes"                      -> Tripes (French jazz trio)   100
artist:"Tripes" OR alias:"Tripes"    -> Τρύπες                      100
```

One query change, same single request, and it likely fixes every transliterated
name rather than this one. **Triage cannot rescue a candidate list that omits
the answer**, which is the general lesson: check whether the right answer is
even on offer before tuning how one is chosen.

### And then it was still wrong

The alias query shipped, the re-run ran, and **Tripes resolved to the French
jazz trio anyway**. Caught by checking one artist by hand after the run, not by
any test.

`normalizeForMatch` keeps only `[a-z0-9]`, so **`normalizeForMatch("Τρύπες")`
is the empty string**. The search now returned Τρύπες top at score 100, rule 2
discarded it as "not an exact match" because an empty string matches nothing,
and the French trio at 92 became the sole exact match and was written with full
confidence.

Hence **rule 6**: when a candidate outscores every comparable one but cannot be
compared, triage refuses and the row goes to a human. Two things it must not
do, both found while fixing it:

- **A sole non-Latin candidate is not a contest.** `芳野藤丸` returns exactly
  one act and is plainly that artist. The first version of rule 6 refused it,
  which would have queued every Japanese and Greek name forever.
- **A low-scored uncomparable candidate must not block a decision**, or one
  stray entry sends an otherwise clear row to the queue.

`tests/triage.mjs` carries all three shapes with the live scores.

**The lesson worth keeping:** the first fix was right and insufficient. Getting
the correct answer into the candidate list did nothing, because the code that
read the list could not see it. A normalisation that silently maps a real name
to the empty string is not a comparison, it is a discard — and it looked like a
confident match the whole way through.

---

## Considered and rejected

**Stripping a leading "The".** Would fix `Evesdroppers` -> `The Evesdroppers`
and `Dean Ween Group` -> `The Dean Ween Group`. Rejected because `Sword` and
`The Sword` are different bands, so the article carries real information some
of the time. Those rows go to a human.

**Accepting a longer name as the same artist.** `Colbey` -> `Colbey Parker`
looks plausible and is wrong; there is no musician called Colbey Parker.
A longer name is not a nickname.

**"Auto-accept when one candidate leads on score."** Tested against the
recorded WITCH fixture during an earlier pass: assigns both roster WITCHes the
same Zambian MBID. This is the merge the whole design exists to prevent and it
is not a candidate under any refinement.

**Splitting `A x B` into two searches.** Suggested and not needed: both sides
are already separate rows in the roster with their own queue entries, so
searching for them again would duplicate work already done.

---

## Effect of the rules, on the real queue

Simulated over all 264 pending rows before implementation:

| | n |
|---|---|
| Auto-accepted | 200 |
| Left for a human | 64 |
| Distinct MBIDs among the accepted | 200 |
| **Collisions (two artists, one MBID)** | **0** |

### And then measured, on the actual re-run

`npm run ingest resolve`, 2026-09-20, over the 315 artists still unresolved:

| | before | after |
|---|---|---|
| Artists resolved | 1,241 | **1,444** |
| Awaiting a human | 264 | **71** |
| No MusicBrainz record | 52 | 39 |
| **MBIDs shared by two artists** | 0 | **0** |

203 resolved in the run, 70 queued, 3 unreachable and retried next time. The
alias query accounts for the drop in the no-record bucket: 13 artists MusicBrainz
held under a name we had never asked for.

The simulation predicted 200 accepted and 64 left; the run produced 203 and 71.
The gap is the alias query, which the simulation could not model because it read
payloads recorded by the old search.

The 64 remaining are genuine: `Steak` (UK stoner vs German hard rock),
`Spindrift` (five acts), `Ataxia` (five), `Nightfall` (five), `Enemies` (five),
`Weedeater` (three). Exactly the rows a human should see.

`npm run eval:matcher` scored **40/40, no regression** — it covers the listing
matcher rather than triage, so no change was expected there either way.

---

## Still open

**The 52 with no MusicBrainz record.** Nothing to match against, so no rule
reaches them. They stay unresolved and contribute nothing to the feed. There is
deliberately **no UI** for them yet; the intent is to allow supplying an MBID by
hand later, for anyone worth the trouble.

**The alias fix only helps rows resolved after it landed.** Payloads queued
before it were recorded by the old query, which is why the rule change was
followed by a full re-run.
