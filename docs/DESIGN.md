# Design

The look, the rules that hold it, and the colours with their measured contrast.

**Post-punk and late-80s/90s indie.** DIY show flyer, xerox and screenprint,
fanzine cut-and-paste. Factory Records, Fugazi sleeves, a photocopied poster
stapled to a pole. Underground, rough, groovy, fun — built for people who take
music seriously and design that does not take itself seriously.

**Not:** friendly SaaS, soft cards, pastel anything.

---

## The Factory idea, and why it fits

Peter Saville's Factory sleeves were **information design pretending to be
art**: Unknown Pleasures is a pulsar plot, FAC numbers catalogued everything
including the office cat, and the sleeve often carried less band-name than a
specimen chart would.

That is the right model for Bandelion, because Bandelion **is** a list of dates,
venues and catalogue numbers. So:

- **The data is the ornament.** Do not decorate the feed. Set the dates, venue
  names and metadata in heavy type at real scale and let density carry the look.
- **Catalogue numbering, but not on every row.** The FAC-number idea is right
  for the page as an object (the header carries `BND 0001`), and wrong repeated
  down a 200-row feed: `BND 0504` beside every release is a number nobody reads,
  competing with the date and the artist for the same glance. `catalogueNumber`
  still exists and still has its tests. Would change if an event ID ever became
  something you need to quote.
- **Information as texture.** Dense condensed or monospaced metadata blocks,
  hard rules between them.
- **The grid is visible.** Hard rules, boxes, obvious columns. Not hidden.
- **Restraint against the palette.** Saville used flat colour sparingly on a lot
  of white. Magenta and violet are allowed on real surfaces, but the default is
  still a lot of white with colour placed where it means something.

---

## Rules

- **Zero border-radius**, with two exceptions, both circles drawn around
  circular artwork. No rounded corners anywhere else, including avatars and
  images — hard edges are the whole point. The exceptions are the save stamp
  (`.stamp`), a 24px circle carrying the bolt on a sleeve's corner, and the
  masthead mark's focus ring (`.masthead-home`), which would otherwise box a
  circular logo. Both are ink marks rather than interface chrome.
  `tests/contrast.mjs` holds the allowlist and fails on a rounded corner
  anywhere else, naming the offending selector, so these are documented
  exceptions rather than a loosened rule.
- **No soft shadows, no gradients, no glassmorphism.** Flat blocks and hard
  rules. If depth is needed, use a hard offset block, not a blur.
- **Type carries the hierarchy** — weight, scale and case, not colour. Heavy
  condensed display faces, tight tracking, big jumps between levels. Colour is
  emphasis, never the only signal.
- **Colour never carries meaning alone.** State is border plus shape plus
  label. A hover that only changes hue is not a state change.
- **Rough on purpose, not sloppy.** Texture, hard rules, slight rotation on
  accents is welcome. Misaligned grids and unreadable text are not.
- **Every element earns its line.** A label repeating identically on every
  instance carries no information. Counters name what they count: never
  "1 left".
- **Anything that expands in place scrolls itself into view.**
- **Consistency of gesture beats economy of controls.** If one row confirms by
  tap, they all do.

---

## Palette

**The values live in `src/app/globals.css` as custom properties.** This file
documents them; it does not define them, and `tests/contrast.mjs` parses the
stylesheet rather than any hex restated here. It does read this file for one
thing: every hex written here in backticks must be a colour that ships. Three
contrast bugs shipped on a previous project because a test knew a different hex
than the stylesheet did, the worst at 1:1 — text exactly the colour of its own
background, reported as "the buttons look empty".

### The colours

| Swatch | Hex | Token | What it is |
|---|---|---|---|
| ⬜ | `#FFFFFF` | `--white` | Paper. The ground most type sits on. |
| ⬛ | `#333129` | `--ink` | Near-black olive. Body text, rules, borders, hard blocks. |
| 🟨 | `#F7D000` | `--dandelion` | Flyer stock. A surface you set black type on, never a text colour. |
| 🟪 | `#F700A8` | `--magenta` | Emphasis, CTAs, the no-cover block. |
| 🟣 | `#9C00F7` | `--violet` | Emphasis, focus rings. |
| ⚫ | `#000000` | — | True black, the striped ground only. Distinct from `--ink`. |
| 🟩 | `#1ED760` | `--spotify-green` | Spotify's brand green. The connect button and nothing else. |

`--rule` is `--ink` and `--rule-width` is `2px`, so the visible grid is one
decision rather than a number repeated in forty places.

Magenta and violet are **usable on surfaces, not only as hairlines**. An earlier
rule confined them to accents; what actually matters is the measurement, not
the area, and the tables below record which pairings pass. Restraint is still
the intent, but it is a design judgement rather than a hard limit.

### Two blacks, on purpose

`--ink` (`#333129`) is a warm near-black with olive in it, and it is what every
rule, border and body string uses. `#000000` is true black and appears only as
the striped page ground. They are close but not interchangeable: ink on true
black measures **1.61:1**, which is why nothing sets type on the stripes.

### Measured pairings

Computed from the declared values, not eyeballed.

| Pairing | Ratio | Verdict |
|---|---|---|
| `--ink` on `--white` | ≈12:1 | body text |
| `--ink` on `--dandelion` | ≈9:1 | high-impact blocks, headers, callouts |
| `--dandelion` on `--ink` | ≈9:1 | the month bands, inverted |
| `--white` on `#000000` | 21:1 | maximum, if ever needed on the ground |
| `--dandelion` on `#000000` | 13.98:1 | strong |
| `--magenta` on `#000000` | 5.52:1 | passes for large type |
| `--violet` on `#000000` | 3.76:1 | large type only |
| black on `--spotify-green` | 10.94:1 | what the connect button ships |
| `--magenta` on `--dandelion` | 2.53:1 | **fails** — this is why the button hover inverts instead |
| `--dandelion` on `--white` | ≈1.6:1 | **never for text** |
| `--ink` on `#000000` | 1.61:1 | **never** — nothing sets type on the stripes |
| `--spotify-green` on `--dandelion` | 1.28:1 | the button needs its ink border to exist at all |
| white on `--spotify-green` | 1.92:1 | **fails**, which is why that button sets black |

### Through the 90% sheet

The page sheet is `rgba(255,255,255,0.9)`, so the stripes show faintly through
it and body text sits on the blend rather than on pure white. The worst case is
where the sheet covers a black stripe.

Ink over that ground is **10.44:1**, against 13.03:1 on pure white: still AAA,
which is what makes the translucency safe. It is set with `rgba` on the
background and never with `opacity`, because `opacity` fades the element and
everything inside it, taking the type down with the surface.

(The effective ground is a blend, not a palette colour, so its hex is
deliberately not listed: a hex in this file is a colour that ships.)

Coloured text on that same ground, which is what the week shortcuts use:

| Text | Ratio | Verdict |
|---|---|---|
| `--ink` | 10.44:1 | last week |
| `--violet` | 4.48:1 | next week, passes for normal text |
| `--magenta` | 3.05:1 | this week's label, above the 3:1 large-text line |
| `--spotify-green` | 1.54:1 | **never as text**, used as a block instead |
| `--dandelion` | 1.19:1 | **never as text** |

Raising the sheet from 85% to 90% lifted every one of these: magenta crossed
3:1 and violet cleared 4.5:1. It did nothing for the green, which went from
1.36 to 1.54 and stays invisible, because the problem is the colour rather than
the ground.

**That is why "this week" is a green block with black type rather than green
text.** Black on `--spotify-green` is 10.94:1, which is how Spotify ships it
and how the connect button already uses it. The dandelion is the same story for
the same reason: both are surfaces you set black type on, not inks.

### Rules that come with the palette

- **Any colour change gets measured.** `tests/contrast.mjs` reads the declared
  values out of the stylesheet and computes the ratios, so it tests what ships.
  Never restate a hex in the test — read it from the source.
- **The yellow is stock, not ink.** `#F7D000` is a surface for black type, the
  way a screenprinted poster works. At 1.6:1 on white it is invisible as text.
- **Two colours that collide are a bug.** The test asserts no two declared
  palette values are visually identical, because a colour equal to its own
  ground renders as nothing and passes every other check.

---

## The striped ground

Magenta and violet hairline pairs on true black, at -45°, drawn in CSS rather
than served as an image: it is four hard-edged line pairs repeating, so a
raster would only add an asset to cache and soften the diagonals at any zoom.

Every stop touches its neighbour, which makes the edges hard. That matters for
more than looks — `tests/contrast.mjs` bans blended gradients and allows a
`repeating-linear-gradient` only when its stops touch, so a fade here would
fail the build.

Nothing sets type on it. The page is an opaque white sheet laid over it, and
the cards are opaque blocks on that.
