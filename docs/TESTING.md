# The test harness, and why each suite exists

Every suite here was written *after* something shipped broken. That is the whole
argument for the list: none of it is speculative coverage, and none of it is
testing the framework.

> **Provenance.** Most of this file came from an earlier project: an offline
> single-file HTML prototype with no server and no third-party data. The
> *shapes* transfer and are worth keeping. The specifics often do not, and two
> of its central assumptions are inverted here. Sections below are marked
> **[carried]**, **[rewritten]** or **[new]**. Where this file conflicts with
> `CLAUDE.md`, `CLAUDE.md` wins.

---

## The two decisions that make all of it cheap

### 1. Seeding state is cheap **[rewritten]**

The original said: *keep app state in a single serialisable object in
`localStorage`.* That was the right call there and does not transfer — our state
is server-side SQLite with thousands of rows.

**The principle survives: make state cheap to seed.** Here that means a **seeded
test database** built from fixture JSON, so any screen is reachable by writing a
database and starting the app, not by clicking through onboarding and waiting
half an hour for an import.

- A test for the feed does not have to survive OAuth.
- Screenshots become a list of `[name, seedFile]` pairs.
- Empty, degraded and overloaded states are all just different seeds.
- Corrupt-data tests are trivial: seed a row with a null where an object belongs.

Seeds live in `tests/seeds/`. Each is a small JSON file describing artists,
events and adapter health. `npm run seed -- <name>` builds a database from one.

### 2. No test touches the network **[new]**

**This is the most important rule in the file, and the original had no
equivalent** because that project had no external data.

Every adapter ships with a **recorded fixture** of the real upstream response,
in `tests/fixtures/<source>/`. Tests replay fixtures. Nothing in `npm test` may
make a live request.

Two reasons, both learned the hard way elsewhere:

- A suite that fails when Eventim is down is a suite everyone learns to ignore.
- A fixture is a **record of the shape upstream had when it worked**. When a
  source changes its JSON, re-recording produces a diff that names exactly what
  broke. That diff is the single most useful artifact when an unofficial source
  shifts under us.

Refresh fixtures deliberately: `npm run fixtures:record -- <source>`. Never
automatically, and never in CI.

### Screenshots **[rewritten]**

Keep the practice, drop the jsdom-file:// mechanics. Run the app, screenshot
real routes with the installed Chrome — no Playwright, no Puppeteer, nothing
added to the dependency tree:

```bash
chrome --headless --disable-gpu --hide-scrollbars \
       --window-size=1440,1100 --screenshot=out.png \
       --virtual-time-budget=4000 http://localhost:3000/feed
```

---

## No framework

Each suite is a standalone Node script with a hand-rolled check function and an
exit code. A runner spawns every `*.mjs` in the directory except itself and the
manual tools.

```js
let failed = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`pass  ${msg}`);
  else { console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`); failed++; }
};
// …
process.exit(failed ? 1 : 0);
```

Two properties worth keeping: **adding a file to the directory enrols it
automatically**, and the `detail` argument means a failure prints what it
actually saw. Most debugging time was saved by that second argument.

One trap: because the runner globs the directory, a scratch file left in
`tests/` becomes part of the suite. Keep throwaway probes elsewhere.

---

## The suites, and the bug each one exists for

Suites marked **[carried]** transferred from the earlier project with the same
justification. **[new]** ones exist because this project has third-party data
and that one did not.

| Suite | Why it exists |
|---|---|
| **offline** **[new]** | Inverted from the old `integrity` suite. Asserts no test makes a live network request, and that every adapter has a recorded fixture. The old project banned external requests *at runtime*; here they are the point, so the ban moves to the test suite. |
| **degradation** **[new]** | Constraint 2, as an assertion. Takes MusicBrainz and then the Cover Art Archive down for a whole run and asserts every stored release survives unchanged, `adapter_health` shows degraded, the run is not reported complete, and an unreached release is retried next run. Written late: CLAUDE.md claimed it before it existed, and on its first run it caught two jobs reporting `complete` after reaching nothing. The rendering half is the CI container job. |
| **matcher** **[new]** | The artist-name eval set. Real listing strings to expected artist IDs, scored. Run on every matcher change. Covers: support acts in free text, umlauts and transliteration, generic names, multi-act bills, DJ set vs live. |
| **ingest** **[new]** | Jobs must checkpoint and resume. Kills a job mid-run and asserts it continues rather than restarts, and that nothing iterates the full roster in a request handler. |
| **render** **[carried]** | A missing side-effect import disabled every click in the app while every static check passed. Drives the real flow against a seeded database. |
| **interactive** **[carried]** | A renamed handler is silently inert — no throw, no log. Clicks every control on every screen. |
| **rules** **[carried]** | The product's own refusals, as assertions. Includes the grep for copy promising what the data cannot support; the equivalent check caught a claim four code reviews had missed. |
| **persistence** **[carried]** | Reworked for SQLite. Boots against a database written by an older build, and against rows with nulls where objects belong. |
| **copy** **[carried]** | The eight voice rules, mechanically. See the caveats below. |
| **contrast** **[carried]** | Parses declared colour values out of the stylesheets and computes ratios, so it tests what ships. Three separate contrast bugs on the old project, worst at 1:1. Matters here: `#F7D000` on white is ≈1.6:1. |
| **docs** **[carried]** | Prose drifts silently. Asserts docs name only files that exist and document every npm script. The inherited `SKILL.md` said "the four rules" three times while listing seven — that is the failure mode, and it happened on a project that had this test. |
| **artist-link** **[new]** | An href carrying `spotify:` works on a machine with the desktop app and is a dead link on every other one, which is invisible to whoever wrote it. Asserts the served markup contains no `spotify:` anywhere, and that an unrecognised `SPOTIFY_LINK_TARGET` falls back to the mode that still reaches Spotify. |
| **review** **[new]** | A well-formed MBID that was never a candidate for a row would attach a stranger's releases to an artist, with nothing in the feed showing it was wrong. Asserts the route re-reads the row rather than trusting the posted id, that confirming writes the alias, and that rejecting leaves the artist unresolved rather than guessing. |
| **triage** **[new]** | Every rule that auto-accepts a MusicBrainz candidate, each tested against a real row from the queue with its names and disambiguation text verbatim. Half the cases assert triage does **not** decide — Steak, Spindrift, `The Evesdroppers` — because a rule that accepts too much is worse than no rule. |

---

## Two hard-won cautions

### A property-name-gated linter has holes

The copy linter only checked strings on keys named `label`, `placeholder`,
`title`, `sub`, `hint`. When a feature arrived whose copy lived on a key called
`q`, the most copy-dense object in the product was linted by nothing.

Two fixes, do both: **name your keys what the linter knows**, and **widen the
linter anyway** so the next person cannot reintroduce it.

### Verify the checker before trusting it

Deliberately break the thing, confirm the test fails, then restore. Done at
least four times in the last project, and it caught:

- a regex that assumed `const X = [` and silently matched nothing after the
  code became `const X = () => [`
- a substring check reporting `Continue` inside `Continuer` as an untranslated
  string, while missing an entire card no marker named

A green suite proves the checks ran, not that they looked at the right thing.

**And a red one can prove nothing at all.** `screenshots.mjs` computed its
expected count as routes × viewports, ignoring that a `fold: true` route
captures twice per viewport. It had been printing `14/8` and exiting 1 on runs
where every shot was taken and nothing overflowed. That failure looked exactly
like the everyday output, so a genuinely missing screenshot would have read as
normal. A check that always fails is off, and it takes longer to notice than
one that never runs.

### Screenshots find what text checks cannot

A text sweep reported every screen clean. The screenshot then showed three
untranslated elements on one of them. Anything about layout, overflow,
alignment, or "is this actually on screen" needs a real browser and human eyes.

### A fixture that never changes is a fixture nobody checks **[new]**

The risk unique to this project: fixtures make tests stable, and stable tests
can pass for months while the real upstream has drifted underneath.

Two habits, do both:

- **`adapter_health` is checked against reality, not fixtures.** The scheduled
  ingest hits the real sources; when a shape stops parsing, health goes degraded
  and the UI says so. That is the live canary, not the test suite.
- **Re-record fixtures when an adapter is touched**, and read the diff. A
  fixture whose recorded date is a year old is telling you something.

---

## Traps

Each one cost real time, most more than once. Collected from the session
handovers and the working notes that used to live in `CLAUDE.md`.

### Taking a screenshot without fooling yourself

Three separate times this went wrong in one session, each time producing a
screenshot of something other than the current build:

- **Stop the server before `npm run build`.** Building over a running server
  corrupts `.next` and the page renders with no CSS at all.
- **Kill by port, not by task.** A dead server can keep port 3000, so the next
  one silently takes 3001 and the screenshot captures the old build.
- **Wait for something new, not for a 200.** Poll for a string that only the
  new build contains. "The server answered" is not "the server answered with
  your change".

The suite will pass while the screen is broken: one session found a
`1556 of 625` counter, missing CSS and a lost SQL join only in screenshots.

### An inline style beats a stylesheet rule

Regardless of order or specificity. A `margin: 0` in a component silently
cancelled a `margin-top` in `globals.css` and the gap measured 0px while both
files looked right. The same thing happened earlier with `display: block`
beating a media query. When a CSS change does not take, look for an inline
style on the same element before doubting the selector.

### A fractional rem at bold can render a seam

A button set at `0.8rem` (11.2px) bold in the monospace stack drew a visible
lighter band through the middle of one word, on an inked background. It looked
exactly like a stray `background` rule or a stuck `:hover`, and it was neither:
the markup was plain text and no selector matched. Whole-pixel `font-size`
fixed it, which is why `.feed-weekbtn` and `.list-orderbtn` both set px rather
than rem. If a "highlight" appears mid-word with no rule that could paint it,
suspect the font size before the stylesheet.

### Tests that mirror the implementation instead of running it

A suite that reimplements the logic it tests will happily assert the buggy
behaviour. It did once, on the earlier project: a progress count asserted as
correct while it told users they had completed five things they had not done.
The Bandelion equivalent: a matcher eval that reuses the matcher's own
normalisation function will score 100% and prove nothing.

### Trusting a source's silence

An adapter returning `[]` means "this source told us nothing", never "there is
nothing". Conflating the two is the defining bug class of this project: it
produces a confidently empty feed while Berlin is full of shows. Every empty
state must name its source, and `adapter_health` must be checked before drawing
any conclusion from absence. The `source-health` spec states the contract.

### Shell heredocs eat code

Backticks, `${}`, apostrophes and backslashes get mangled silently. A template
literal once shipped as `return also.length ?  : base;`. Use file-writing tools
for anything containing them.

### Bulk find-and-replace on colours

A stylesheet-wide substitution cannot know which ground a value sits on. It
broke three surfaces on the earlier project, each caught weeks apart. Change a
colour, then run `tests/contrast.mjs`.

### Copy that flatters

The model writes the impressive version by default: "Tickets on sale Friday"
from a field that is often wrong, or "No gigs coming up" when a source is
simply down. Rule 8 in the copy skill, and the highest-value thing a reviewer
catches.

### A known flake: two jobs on one SQLite file

`releases.mjs` failed once mid-run while the covers job was writing to the same
database, then passed alone and on re-run. Probably WAL contention rather than
a logic bug — a guess, not a finding. It has not recurred.

---

## If the app ever has more than one language

**Dormant.** Bandelion is English-only today. Kept because the project is
Berlin-based and German is plausible, and because these were learned late enough
to cost a rebuild.

Three rules:

**Never resolve translated strings at module load.** A module-level
`const OPTIONS = [['a', t('x')]]` freezes whichever language was active at
import. Make it a function: `const OPTIONS = () => [['a', t('x')]]`.

**Translate whole phrases, not fragments.** "Back to " + noun cannot be made
correct in German, Polish or French, where the preposition and article inflect
with the noun. One key per complete phrase.

**Store values language-independent, format at render.** A date formatted at
seed time and persisted carries the language that created the record. Store
ISO; format where the current language is known.
