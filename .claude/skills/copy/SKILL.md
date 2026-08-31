---
name: copy
description: Write, review or fix any string a user reads — labels, buttons, toasts, placeholders, empty states, and the text blocks on a screen. Use whenever user-facing copy is created or changed, or when asked to check the voice. Enforces the eight voice rules and runs the copy test.
---

# User-facing copy

Every string a user reads obeys eight rules. They are stated here in full, and
`tests/copy.mjs` enforces them so they cannot quietly drift.

> Rules 1–7 came from an earlier project and transferred nearly intact. Rule 8
> is specific to Bandelion and is the one that matters most here.

## The eight rules

### 1. No em dash, no en dash

Never `—` or `–` in a user-facing string. It is the tell of generated prose and
it reads as filler where a decision should be.

| Instead of | Write |
|---|---|
| `New album — out Friday` | `New album. Out Friday.` |
| `Berghain — tickets Monday` | `Berghain · tickets Monday` |
| `Skip — I'll look later` | `Skip, I'll look later` |

Full stop when the second half is its own statement. Comma when it is a
continuation. Middot (`·`) when it separates a label from a count or a date,
which is the separator this project uses.

**The one exception:** a bare `'—'` alone in quotes is the empty-value glyph in
a metadata row (`Support: —`). That is typography, not prose, and the test
exempts it.

### 2. Lean

No label past **18 words**. No explaining the same thing twice. If a label needs
a second clause to make sense, the first clause is wrong.

The limit is generous on purpose. It catches an explanation that grew, not a
sentence someone thought about.

### 3. Formal but friendly, and directing

The screen directs. It does not petition, apologise, or cheer.

- No "please". It softens an instruction into a request the user can decline.
- No "sorry". State the fact.
- No "are you sure?". Make it undoable instead.
- No exclamation marks. The screen directs; it does not cheer.

### 4. Second person singular

The user is **you**. Never "the user", never the passive where an instruction is
meant. An artist or another person is a third party and is exempt.

### 5. The user is on our side

Never strict, never chasing. State what **we** do, not what the user owes.

| Instead of | Write |
|---|---|
| `You must connect Spotify` | `Connect Spotify to start` |
| `Failed to load gigs` | `No gigs from Eventim right now` |
| `You haven't dismissed anything` | `Nothing dismissed yet` |

### 6. A yes/no question needs no accompanying text

Two buttons and a question are self-explanatory. A paragraph under them either
restates the question or apologises for asking it.

Text conditional on an **answer** is fine. That is new information the user
asked for by answering, not a preamble.

### 7. Question every text block

For each block, ask: **does the user act differently for having read it?** If
not, delete it. If it survives, it belongs somewhere specific:

| What it does | Where it goes |
|---|---|
| Explains what to do on this screen | the subtitle |
| Argues why the product is built this way | a design note, not user copy |
| Tells the user what we know and do not | inline, next to the gap |
| Nothing the user can act on | deleted |

A block that survives says one thing **once**.

### 8. Copy must not assert what the product cannot do

**The highest-value rule in this project.** Bandelion's data is incomplete by
nature: support acts are often missing, on-sale dates are frequently absent,
unofficial sources go down, and links come from a database with gaps.

Before writing a label, ask **what the system actually knows** when a user acts
on it. If the honest answer is smaller than the copy, the copy is wrong.

| Dishonest | Honest | Why |
|---|---|---|
| `Tickets on sale Friday` | `On sale Friday, per Eventim` | We parsed a field that is often wrong or missing. Attribute it. |
| `No gigs coming up` | `No gigs found in Berlin` | We know what our sources returned, not what exists. |
| `Full lineup` | `Lineup, as listed` | Support acts are best-effort. |
| `All your artists` | `2,140 artists from Spotify` | It is who you follow, not who you listen to. |
| `Nothing new` | `Nothing new since 12 March` | The window is a choice; name it. |

**Absence of data is not evidence of absence.** An empty feed means our sources
returned nothing, and the copy must say that rather than making a claim about
the world. This is also why `adapter_health` is user-visible: when a source is
degraded, the empty state says so.

`tests/copy.mjs` includes a **grep over the source** for absolute claims
(`all`, `every`, `complete`, `full`, `no ` + noun) in user-facing strings. On
the previous project the equivalent check caught a promise four code reviews had
missed.

## Scope

Covers **user-facing strings only**: everything under `src/app/` that renders
text, plus toasts, empty states and error messages.

**Exempt, deliberately:** code comments, design notes addressed to whoever reads
the source, `CLAUDE.md` and the other docs, log output, and anything in
`tests/`.

## How to run this

```bash
node tests/copy.mjs     # the eight rules, on their own
npm test                # the whole suite, copy.mjs included
npm run verify          # build, then test — before committing
```

`tests/copy.mjs` is picked up automatically by `tests/run.mjs`.

## When writing new copy

1. Draft it, then read it back as if you were looking for a show this weekend.
2. Check it against the eight rules, rule 8 last and hardest.
3. Run `node tests/copy.mjs`.

## When the test flags something

Fix the copy, not the test. The exemption lists exist for prose that genuinely
is not user-facing; widening one to let a real string through defeats the point.
If a string has been misfiled by the scanner, say so rather than editing the
exemption silently.
