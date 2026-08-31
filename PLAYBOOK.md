# Playbook

> **Provenance.** Written for an earlier project — an offline single-file HTML
> prototype. Kept here because the *questions* are the right ones and the
> failure modes are real. The answers below are Bandelion's, not that project's.
> Where this conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

---

## The four decisions, as answered for Bandelion

These are expensive to undo. All four were re-decided mid-project on the
previous build, which is why they are written down before code here.

### 1. What is the artifact, exactly?

**`docker compose up` on a laptop or a small VPS, working against live
third-party sources, still working in three months when one of those sources has
changed its JSON.**

That sentence decides most arguments: it is why there is a server, why state is
SQLite, why every source sits behind an adapter, and why no test may call a live
API.

*(The old project's answer was the opposite — one HTML file, no network. Nearly
every difference between that repo's rules and this one traces back to this line.)*

### 2. Where does it run?

Self-hosted, one instance per person, Docker from day one. **Not** a hosted
product: Spotify caps a development-mode app at 5 authorised users and the only
tier above requires 250k MAU. Self-hosting is the answer to that constraint, not
a workaround for it.

Retrofitting Docker is annoying; starting with it costs almost nothing.

### 3. Framework, honestly

**Next.js + TypeScript from the start.** The old project's lesson was "if it
will end up React, start React" — converting a working prototype is paying
twice, and it produced four bugs that every static check passed clean.

One language across UI, ingest and jobs. Types catch adapter drift.

### 4. Where the state lives

**SQLite, server-side, one file on a mounted volume.** One user per instance, so
a server database buys nothing. Backup is copying a file.

The old project's answer — a single serialisable object in `localStorage` — does
not transfer. **The principle does: make state cheap to seed.** Here that is
seeded test databases built from fixture JSON. See `TESTING.md`.

### 5. What is the data actually like? **[new]**

The question the old project never had to ask, and the one that shapes most of
Bandelion.

Answer it before designing a schema: **which sources are official, which are
undocumented, what do they refuse to give you, and what happens when one dies?**
Here: Spotify and Ticketmaster are official; Eventim and Resident Advisor are
undocumented endpoints; promoter sites are scraped. Support acts are often
missing. On-sale dates are unreliable. Announced-but-unreleased albums are
barely covered anywhere.

Every one of those facts became a UI decision or a copy rule. Research the
sources before inventing a schema.

---

## Build the harness early

On the old project this was demo chrome — persona switcher, scenario picker,
failure toggles. Bandelion is a real app rather than a demo, so the harness is
different, but the argument holds: **it costs an afternoon and is worth more
than any single screen.**

What it must do here:

- **Seed any state.** Every screen reachable without OAuth and a 30-minute
  import. See `TESTING.md`.
- **Fake a broken source, on demand.** A dev-only switch that forces any adapter
  to fail. Degradation is the architecture's core promise, and being able to
  break Eventim from a toolbar mid-session is what makes it visible rather than
  asserted.
- **Show the seams.** Adapter health, last-success times and match confidence
  visible in dev. In this app the interesting failures are all in the data, and
  data failures are invisible unless you build a window onto them.
- **Look unlike the product.** Scaffolding mistaken for product is worse than no
  scaffolding.

---

## The testing that actually paid

Not coverage. Four things, in the order they earned their place. **The
mechanics live in `TESTING.md`;** what follows is why each one is on the list.

**Render it, do not read it.** The two worst bugs on the previous project were
invisible to every static check: a missing side-effect import meant nothing
responded to clicks, and a dead statement after a `return` left a toggle inert
while the page looked correct.

**Screenshot it.** jsdom has no layout engine. It proves the app works; it
cannot show misalignment, overflow or overlap. Two defects per review round were
caught this way before reaching the reviewer.

**Measure contrast, do not eyeball it.** Three separate times a colour survived
a bulk remap on the wrong ground, worst at **1:1** — text exactly the colour of
its own background, reported as "the buttons look empty". Parse declared values
out of the stylesheet rather than restating them, so the test checks what ships.

**Assert the domain rules, not just the code.** The valuable assertions are
never "does it render". For Bandelion they are: *does the feed survive a dead
adapter*, *does the matcher still score above threshold*, *does any string
promise data we do not have*. Those are what a refactor silently breaks and
nobody notices until a review.

---

## Failure modes worth knowing about

**Bulk find-and-replace on colours.** A stylesheet-wide substitution cannot
know which ground a value sits on. It broke three surfaces here, each caught
weeks apart.

**Shell heredocs eating code.** Backticks, `${}`, apostrophes and backslashes
get mangled silently. A template literal shipped as `return also.length ?  :
base;`. Use file-writing tools for anything containing them.

**Tests that mirror the implementation instead of running it.** A suite that
reimplements the logic it is testing will happily assert the buggy behaviour. It
did once: a progress count asserted as correct while it told users they had
completed five things they had not done. The Bandelion equivalent to watch: a
matcher eval that reuses the matcher's own normalisation function will score
100% and prove nothing.

**Documentation drifting from the code.** `CLAUDE.md` described a pre-React
build for an entire React conversion, because two patch attempts failed silently
on string-match and nobody verified. Read the file back after editing it. The
`docs` suite exists for this.

**Copy that flatters.** "Recovery dispatched · ETA 45 min", in a system that
dispatched nothing. The model writes the impressive version by default. Here it
will write "Tickets on sale Friday" from a field that is often wrong, or "No
gigs coming up" when a source is simply down. Rule 8 in the copy skill, and the
highest-value thing a reviewer catches.

**Trusting a source's silence.** **[new]** An adapter returning `[]` means "this
source told us nothing", never "there is nothing". Conflating the two is the
defining bug class of this project: it produces a confidently empty feed while
Berlin is full of shows. Every empty state must name its source, and
`adapter_health` must be checked before drawing any conclusion from absence.

---

## The review loop that worked

**Reviewer sends a marked-up screenshot with numbered items, batched by
screen.** Unambiguous in a way prose is not. Batching by screen means one build
and one screenshot back rather than two round-trips.

**Reviewer flags which items need discussion.** Most are unambiguous. Marking
the one that needs a decision lets the rest be built without stopping.

**Builder screenshots before handing back.** Non-negotiable, and the single
biggest change in throughput.

**Builder states what was not done.** Quietly dropping item 6 is worse than
saying item 6 needs a decision.

**Reviewer supplies everything about feel.** Screenshots are static. Awkward
targets, jarring transitions, two taps where one would do — the builder has no
way to see any of it.

---

## Being honest about incomplete data

The old project's version of this section was about making a *fake* credible.
Bandelion has no fake data — but the same instinct applies to data that is real
and incomplete, which is all of ours.

**Anchor on real identifiers.** MusicBrainz IDs, Spotify IDs, actual venue
names. The old project's lesson was that anchoring on a real standard is the
difference between a mock and a mapping. Same here: a canonical MBID with
aliases beats a homegrown artist key.

**Name what is missing, in the product.** The old project kept a
`docs/whats-faked.md`. The equivalent here is `adapter_health` being
**user-visible**, and empty states that say which source returned nothing. An
app that hides its seams invites the wrong conclusions — an empty feed reads as
"no gigs" when it means "Eventim is down".

**State the gaps up front.** The most useful finding in planning was that
Ticketmaster barely covers the venues Chris cares about, and that the sources
which do are undocumented. That limitation shaped the whole architecture. Gaps
found early are cheap; gaps found after launch are a rewrite.

---

## Reusable pieces

From the old repo, portable with light editing:

| File | What it does | Status here |
|---|---|---|
| `tests/screenshots.mjs` | Headless Chrome capture, no dependency | Adapt: point at routes, not `file://` |
| `tests/contrast.mjs` | Parses stylesheets, computes WCAG ratios against declared values | Take nearly as-is |
| `tests/serve.mjs` | Zero-dependency static server, prints the LAN address | Superseded by `npm run dev` |
| `build/build.mjs` | esbuild → one self-contained file | Not applicable |
| `src/core/store.js` | Serialisable state, subscribe/emit, localStorage | Not applicable — state is SQLite |

The pattern worth copying most: **a constraint that enforces itself.** There it
was a build that refused to complete if an external request appeared. Here it is
the `offline` suite refusing to pass if a test touches the network, and the
`degradation` suite refusing to pass if a dead adapter empties the feed. Neither
relies on anyone remembering.
