# Berlin venues

Tracking targets for the gig sources. **Nothing here is wired up yet** — this is
the shortlist to crawl or match against once stage 5 lands, not a description of
what the app currently does.

Grouped by capacity, because size predicts which source carries a venue:
arenas and large halls are well covered by Ticketmaster and Eventim, while the
small clubs are exactly where the official feeds go quiet and Resident Advisor,
Greyzone and the venue's own page become the only listing.

**Every domain below was checked on 2026-09-06.** Status is recorded where it is
not a plain 200, because a venue list with dead links silently drops shows.
Re-check before building a crawler against any of these; three were already
wrong when this list was written.

---

## Arenas & large halls (2,000+)

| Venue | Domain | Note |
|---|---|---|
| Uber Arena (ex Mercedes-Benz Arena) | uber-arena.de | |
| Uber Eats Music Hall (ex Verti Music Hall) | uber-eats-music-hall.de | |
| Max-Schmeling-Halle / Velodrom | velomax.de | one operator, two halls |
| Tempodrom | tempodrom.de | |
| Columbiahalle | columbiahalle.berlin | |
| Arena Berlin (Treptow) | arena.berlin | |
| Waldbühne | waldbuehne-berlin.de | open air, summer only |
| Parkbühne Wuhlheide | wuhlheide.de | open air, summer only |
| Zitadelle Spandau | zitadelle-berlin.de | open air, summer only |
| Olympiastadion | olympiastadion.berlin | |

## Mid-size concert venues (600–2,000)

| Venue | Domain | Note |
|---|---|---|
| Huxleys Neue Welt | huxleysneuewelt.de | |
| Astra Kulturhaus | astra-berlin.de | |
| Columbia Theater | columbia-theater.de | |
| Festsaal Kreuzberg | festsaal-kreuzberg.de | same operator as Bi Nuu |
| Metropol (Nollendorfplatz) | **metropol-berlin.de** | `.com` does not resolve |
| Kesselhaus & Maschinenhaus, Kulturbrauerei | kesselhaus-berlin.de | redirects to kesselhaus.net |
| SO36 | so36.de | redirects to so36.com |
| Lido | lido-berlin.de | |
| Gretchen | gretchen-club.de | |
| Hole44 | **hole-berlin.de** | `hole44.de` refuses connections; shares a site with Musik & Frieden |
| Heimathafen Neukölln | heimathafen-neukoelln.de | |
| Frannz Club | frannz.com | redirects to frannz.eu |
| Yaam | yaam.de | |
| Silent Green Kulturquartier | silent-green.net | |
| Funkhaus Berlin | funkhaus-berlin.net | |
| RSO Berlin | rso.berlin | **404 on every path tried** — find the current domain before using |
| Säälchen / Holzmarkt | holzmarkt.com | |
| Theater im Delphi | theater-im-delphi.de | |
| Admiralspalast | admiralspalast.de | redirects to atgentertainment.de (ATG group site) |
| Friedrichstadt-Palast | palast.berlin | |

## Small clubs (under 600)

Where the official feeds go quiet. Highest value for the unofficial sources.

| Venue | Domain | Note |
|---|---|---|
| Bi Nuu | binuu.de | |
| Neue Zukunft | neue-zukunft.org | ex Zukunft am Ostkreuz, moved to Alt-Stralau 68 and renamed |
| Privatclub | privatclub-berlin.de | |
| Musik & Frieden | musikundfrieden.de | redirects to hole-berlin.de, shared with Hole44 |
| Cassiopeia | cassiopeia-berlin.de | on Greyzone |
| Badehaus | badehaus-berlin.com | on Greyzone |
| Urban Spree | urbanspree.com | on Greyzone |
| Wild at Heart | wildatheartberlin.de | |
| Schokoladen | schokoladen-mitte.de | |
| Clash | clash-berlin.de | |
| Prachtwerk | prachtwerkberlin.com | |
| Kantine am Berghain / Säule | berghain.berlin | |
| Zwingli-Kirche, Passionskirche | akanthus.de | Akanthus promotes both |
| ORWOhaus | orwohaus.de | |

## Jazz

| Venue | Domain |
|---|---|
| Quasimodo | quasimodo.de |
| A-Trane | a-trane.de |
| b-flat | b-flat-berlin.de |
| Kunstfabrik Schlot | kunstfabrik-schlot.de |
| Donau115 | donau115.de |
| Zig Zag Jazz Club | zigzag-jazzclub.berlin |

## Classical / opera

Listed for completeness. These programme by ensemble and conductor rather than
by touring act, so artist-name matching against a Spotify roster will hit far
less often here than elsewhere — worth confirming they earn their ingest cost
before building for them.

| Venue | Domain |
|---|---|
| Philharmonie & Kammermusiksaal | berliner-philharmoniker.de |
| Konzerthaus Berlin | konzerthaus.de |
| Staatsoper Unter den Linden | staatsoper-berlin.de |
| Deutsche Oper | deutscheoperberlin.de |
| Komische Oper | komische-oper-berlin.de |
| Pierre Boulez Saal | boulezsaal.de |
| Radialsystem | radialsystem.de |
| Konzertsaal UdK | udk-berlin.de |

---

## Needs a decision before stage 5

- **RSO Berlin** — no working domain found. It may have closed or rebranded;
  worth confirming rather than dropping silently.
- **Venue name matching is its own problem.** "SO36" and "SO 36",
  "Kesselhaus" and "Kesselhaus Kulturbrauerei", "Neue Zukunft" and the old
  "Zukunft am Ostkreuz" are the same rooms under different strings. The
  artist-name matcher in `src/matcher/` handles a similar problem and is the
  obvious place to extend, but venue aliases are not in it today.
- **Operator sites cover several venues at once.** hole-berlin.de serves Hole44
  and Musik & Frieden; velomax.de serves Max-Schmeling-Halle and Velodrom;
  akanthus.de promotes across churches. One crawl can yield several venues —
  and one broken crawl can silently drop several.
