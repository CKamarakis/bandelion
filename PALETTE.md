# Palette

The colours, what each one is for, and the measured contrast between them.

**The values live in `src/app/globals.css` as custom properties.** This file
documents them; it does not define them, and `tests/contrast.mjs` parses the
stylesheet rather than any hex restated here. Three contrast bugs shipped on a
previous project because a test knew a different hex than the stylesheet did,
the worst at 1:1 — text exactly the colour of its own background, reported as
"the buttons look empty".

---

## The colours

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

### Two blacks, on purpose

`--ink` (`#333129`) is a warm near-black with olive in it, and it is what every
rule, border and body string uses. `#000000` is true black and appears only as
the striped page ground. They are close but not interchangeable: ink on true
black measures **1.61:1**, which is why nothing sets type on the stripes.

---

## Measured pairings

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

### Through the 85% sheet

The page sheet is `rgba(255,255,255,0.85)`, so the stripes show faintly
through it and body text sits on the blend rather than on pure white. Measured
against the darkest and most saturated parts of the pattern:

| Ink over the sheet, above | Ratio |
|---|---|
| black | 9.23:1 |
| magenta | 10.19:1 |
| violet | 9.96:1 |

(The effective grounds are blends, not palette colours, so their hex values are
deliberately not listed: a hex in this file is a colour that ships.)

Coloured text on that same ground, which is what the week shortcuts use:

| Text | Ratio | Verdict |
|---|---|---|
| `--ink` | 9.23:1 | last week |
| `--violet` | 3.96:1 | next week, passes for bold 14px |
| `--magenta` | 2.70:1 | this week, **below the 3:1 line and shipped knowingly** |
| `--dandelion` | 1.06:1 | **rejected** — invisible |
| `--spotify-green` | 1.36:1 | **rejected** — a background colour, same as the yellow |

The magenta is a judgement, not an oversight. It is legible, and the 85% sheet
is what costs it the 3.80:1 it measures on pure white. The two rejected values
are a different thing entirely: at 1.06:1 and 1.36:1 they are text the colour
of its own ground, which is the failure this whole file exists to prevent.

Worst case 9.23:1 against 13.03:1 on pure white: still AAA, which is what made
the translucency safe to ship. It is set with `rgba` on the background and
never with `opacity`, because `opacity` fades the element and everything inside
it, taking the type down with the surface.

---

## Rules that come with them

- **Any colour change gets measured.** `tests/contrast.mjs` reads the declared
  values out of the stylesheet and computes the ratios, so it tests what ships.
  Never restate a hex in the test.
- **Colour never carries meaning alone.** State is border plus shape plus
  label. A hover that only changes hue is not a state change.
- **The yellow is stock, not ink.** `#F7D000` is a surface for black type. At
  1.6:1 on white it is invisible as text.
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
