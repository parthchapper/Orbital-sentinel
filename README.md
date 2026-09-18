# ORBITAL SENTINEL

A mission-control console for a 6U hyperspectral CubeSat that watches UAE
coastal waters for algal blooms and tells desalination plants when to draw
water.

The console in `site/` is a **static site** — push it to GitHub Pages and it
runs: orbital mechanics, power model, hyperspectral retrieval, intake
scheduler and a three.js globe, all in the browser, with no server, no build
step and no API keys.

```bash
npm run serve     # http://127.0.0.1:4173
npm run check     # parity harness + headless console check
```

**Publishing:** Settings → Pages → Source: GitHub Actions, then push.
[`docs/HOSTING.md`](docs/HOSTING.md) covers the alternatives.

---

## The idea

A 6U CubeSat in a 520 km sun-synchronous orbit carries a 96-band hyperspectral
imager. Once a day it crosses UAE coastal waters and measures chlorophyll-a.

Harmful algal blooms clog reverse-osmosis intakes — the 2008–09 *Cochlodinium*
bloom in the Gulf of Oman forced Fujairah's plant into repeated shutdowns.
Operators find out when intake pressure drops. A daily ocean-colour pass lets
them schedule around a bloom instead of reacting to one.

So the console's three modes are not three screens. They are one spacecraft at
three points in its orbit, and **everything on the page is a function of where
the timeline slider sits.**

| Slider | Mode | What is physically true |
|---|---|---|
| 0.00 – 0.33 | **ECLIPSE** | In Earth's umbra. Zero generation, payload rail off, battery carries the 6.2 W housekeeping load alone. The console dims. Banner: `POWER SAVING`. |
| 0.33 – 0.67 | **SUN_FACING** | Arrays sun-pointed, ~39 W in, battery recharging through a CC/CV taper, payload in standby cooling its detector to −40 °C. |
| 0.67 – 1.00 | **ACTIVE** | UAE overpass. Shutter open, 96 bands streaming, X-band downlink live, 2D swath map slides in, spectroscopy and intake schedule update off live retrievals. Banner: `TARGET ACQUIRED`. |

---

## What's on the console

- **3D globe** — vector-coastline Earth, orbit track, spacecraft, scanning
  swath ribbon, and the chlorophyll field draped over the AOI. Drag to rotate,
  scroll to zoom, **click any point to sample its spectrum**.
- **2D swath map** — appears in ACTIVE. Instantaneous scan line, everything
  covered so far this pass, plant markers coloured by live bloom risk.
- **Power** — generation → battery → loads as a live diagram, with gauges on a
  *zoomed* scale and the unscaled percentage printed beside them.
- **Spectroscopy** — 96 bands coloured by their own wavelength, with the eight
  diagnostic features labelled: Chl-a absorption at 443 and 665 nm, green peak
  at 555, sun-induced fluorescence at 681, NIR red edge at 709. Hover any band.
- **Desalination schedule** — Jebel Ali and Fujairah, each with a
  draw/throttle/hold verdict, a best window, and a 24-hour strip whose every
  bar carries its full scoring breakdown on hover.
- **Live downlink** — CCSDS-tagged telemetry where every number is a value
  shown elsewhere on the console. The rate rises with activity.
- **Guided tour** — eight steps that drive the timeline themselves, so the
  console can explain itself without someone standing next to it.

Every panel has a **`?`** that says what you are looking at and why it matters.

---

## Two implementations, one model

This repository contains the console twice over, on purpose.

```
site/engine/     the mission model in JavaScript — what GitHub Pages runs
worker/app/      the same model in Python (FastAPI) — the real backend
gateway/         Node API gateway: mission clock, cache, telemetry WebSocket
map3d/           the three.js globe module (shared; copied into site/)
tools/           parity harness, static server, headless checks
docs/            API, architecture, integration, hosting
```

The static site exists so the console can be *seen* without infrastructure.
The Python worker and Node gateway exist because that is what a real ground
segment looks like, and because the science belongs somewhere a scientist can
edit it. `docs/API.md` and `docs/ARCHITECTURE.md` cover them; `./scripts/start.sh`
runs them.

**Two implementations of one model drift silently**, so one doesn't:

```bash
npm run check
```

`tools/dump_reference.py` imports the Python model directly and dumps its
outputs; `tools/parity-check.mjs` asserts the browser engine reproduces every
one. Currently **20,410 values** — full state at 16 slider positions, all 96
spectral bands, 288 cells of the chlorophyll field, both plants' 24-hour
schedules, and the value-noise hash underneath all of it (which needs
`Math.imul` and a rewritten seed term to stay bit-identical to Python's exact
integer arithmetic).

The site check drives the real page in headless Chromium — all three modes,
every interaction, the tour, a phone viewport — and screenshots each.

---

## Honesty notes

Things a technical advisor might reasonably ask, answered before they ask:

- **The demo loop is scripted.** 180 seconds representing one 94.9-minute
  orbit, phased so the UAE pass always lands in the ACTIVE segment. The
  orbital geometry inside each segment is real — great-circle ground track,
  correct inclination, Earth rotation. Only the clock rate is staged, and it
  is reported in every frame as `clock.time_compression`.
- **The time warp is uneven on purpose.** A uniform 31.6× would compress the
  real 2.4-minute overpass into four seconds while the audience watched a
  minute of empty eclipse. Eclipse runs at 35×, the sunlit arc at 57×, and the
  pass itself at 2.4× — near real time.
- **The battery only moves ~5 %.** That is what a real orbit does. Rather than
  fake a bigger swing, `power.gauge` returns a display window zoomed to the
  mission's real envelope while `soc_pct` stays the unscaled truth, and the
  panel says so.
- **The algae field is synthetic**, generated from deterministic value noise
  shaped by basin depth, a coastal nutrient gradient and season. The
  *reflectance model applied to it is real*, and MCI, NDCI and FLH are computed
  the way MERIS/OLCI-class processors compute them.
- **Nothing in the downlink log is filler.** Every line is derived from the
  same snapshot the gauges read.

---

## Running the real backend

```bash
./scripts/start.sh          # Python worker + Node gateway
cd gateway && npm run smoke # 56 end-to-end assertions
```

| | |
|---|---|
| REST + WebSocket gateway | <http://127.0.0.1:8800> |
| Python mission worker | <http://127.0.0.1:8811> |
| API index | <http://127.0.0.1:8800/api> |

Docker: `docker compose up --build`.

---

## Documentation

| | |
|---|---|
| [`docs/HOSTING.md`](docs/HOSTING.md) | publishing to Pages, local preview, verification |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | every derivation — orbit phasing, the time warp, the power solver, the bio-optical model, the scheduler |
| [`docs/API.md`](docs/API.md) | the backend's REST and WebSocket contracts |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | wiring a front end to the backend |
| [`docs/screenshots/`](docs/screenshots) | reference captures from the last verified run |

---

## Licence and credits

three.js r170 is vendored under `site/vendor/` (MIT, licence included).
Coastlines and country outlines are derived from Natural Earth (public domain)
via `world-atlas`.
