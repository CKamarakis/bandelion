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
| **degradation** **[new]** | Constraint 2, as an assertion. Disables each adapter in turn and asserts the feed still renders and `adapter_health` shows degraded. The architecture's central promise; untested it is a wish. |
| **matcher** **[new]** | The artist-name eval set. Real listing strings to expected artist IDs, scored. Run on every matcher change. Covers: support acts in free text, umlauts and transliteration, generic names, multi-act bills, DJ set vs live. |
| **ingest** **[new]** | Jobs must checkpoint and resume. Kills a job mid-run and asserts it continues rather than restarts, and that nothing iterates the full roster in a request handler. |
| **render** **[carried]** | A missing side-effect import disabled every click in the app while every static check passed. Drives the real flow against a seeded database. |
| **interactive** **[carried]** | A renamed handler is silently inert — no throw, no log. Clicks every control on every screen. |
| **rules** **[carried]** | The product's own refusals, as assertions. Includes the grep for copy promising what the data cannot support; the equivalent check caught a claim four code reviews had missed. |
| **persistence** **[carried]** | Reworked for SQLite. Boots against a database written by an older build, and against rows with nulls where objects belong. |
| **copy** **[carried]** | The eight voice rules, mechanically. See the caveats below. |
| **contrast** **[carried]** | Parses declared colour values out of the stylesheets and computes ratios, so it tests what ships. Three separate contrast bugs on the old project, worst at 1:1. Matters here: `#F7D000` on white is ≈1.6:1. |
| **docs** **[carried]** | Prose drifts silently. Asserts docs name only files that exist and document every npm script. The inherited `SKILL.md` said "the four rules" three times while listing seven — that is the failure mode, and it happened on a project that had this test. |

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
