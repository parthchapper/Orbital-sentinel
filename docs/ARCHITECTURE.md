# Architecture and derivations

Why the system is shaped the way it is, and where each number comes from.

---

## 1. One input

The timeline slider is the only control in the system. Mode, battery state,
attitude, thermal, the ground track, the swath polygon, the spectrum, the
desalination schedule and the downlink log are all pure functions of it.

That single decision buys most of the properties the console needs:

- **Scrubbing works.** Dragging backwards is not "rewinding" anything; it is
  evaluating the same function at a different argument.
- **Nothing can disagree.** The globe, the gauges and the log all read one
  snapshot, so the map cannot show the satellite over the Gulf while the
  panel says `ECLIPSE`.
- **It is cacheable.** The gateway memoises by quantised slider value
  (1/900 of the loop). A demo that runs for an hour serves almost entirely
  from memory.
- **It is testable.** `smoke.js` asserts specific slider positions produce
  specific states. A regression in the power model fails a test rather than
  surfacing in front of an audience.

`worker/app/mission.py::snapshot(slider)` is that function. Everything else
is transport.

---

## 2. The time warp

The loop is 180 s and represents one 94.9-minute orbit, but the compression
is **not uniform**:

| Segment | Loop time | Orbit time | Rate |
|---|---|---|---|
| ECLIPSE | 0–60 s | 0–2100 s | 35.0× |
| SUN_FACING | 60–120 s | 2100–5549 s | 57.5× |
| ACTIVE | 120–180 s | 5549–5694 s | **2.4×** |

A uniform 31.6× would reduce the UAE overpass — the entire point of the
mission — to under four seconds of screen time, while the audience spent a
minute watching an empty eclipse. So each segment gets screen time in
proportion to how much there is to look at, and the pass itself runs at
close to real time.

The orbital mechanics inside each segment are untouched: real inclination,
real great-circle ground track, real Earth rotation. Only the clock rate
differs, and `clock.time_compression` reports it in every frame.

`geo.orbit_seconds(loop_t)` is the warp; `geo.time_compression(loop_t)` is
its derivative, which the power integrator uses so the battery is charged
in real orbital seconds and not loop seconds.

---

## 3. Solving the ground track phase

Requirement: the mid-point of the ACTIVE segment must put the sub-satellite
point on the AOI centre, 24.6 °N 54.2 °E.

For a circular orbit of inclination *i* and argument of latitude *u*:

```
lat  = asin(sin i · sin u)
Δlon = atan2(cos i · sin u, cos u)
lon  = lon_asc0 + Δlon − ω_E · t
```

With *i* = 97.49°, target latitude 24.6°:

```
sin u = sin(24.6°) / sin(97.49°) = 0.4163 / 0.99147 = 0.4199
u     = 24.85°
Δlon  = atan2(cos(97.49°)·sin(24.85°), cos(24.85°))
      = atan2(−0.05484, 0.90740) = −3.457°
```

The ACTIVE mid-point is loop *t* = 150 s → orbit *t* = 5621.5 s = 93.69 min.

```
u(orbit_t) = u₀ + 360°·(orbit_t / P),  P = 5694 s
  → u₀      = 24.85° − 360°·(5621.5/5694) = 29.43°

Earth drift = 0.2506844 °/min × 93.69 min = 23.48°
  → lon_asc0 = 54.2° + 3.457° + 23.48° = 81.14°
```

Those two constants are `U0_DEG` and `LON_ASC0_DEG` in `geo.py`. The smoke
test asserts the result rather than the derivation: at slider 0.75 and 0.95
the subpoint must be inside the AOI.

Other geometry from the same module:

```
r      = 6378.137 + 520 = 6898.137 km
v      = √(μ/r) = √(398600.4418 / 6898.137) = 7.602 km/s
v_grnd = v · (R⊕/r) = 7.029 km/s
```

Swath edges are great-circle offsets of ±90 km perpendicular to the
instantaneous heading; the covered-area polygon is the left edge forward
plus the right edge reversed, which is a closed ring **and** a strip the
renderer can triangulate without an earcut pass.

---

## 4. Power, and why the gauge is zoomed

```
Array:     0.10 m² × 0.298 (GaAs, EOL) × 1361 W/m² = 40.6 W peak
Loads:     bus 6.2 W  |  payload 22 W imaging / 3.5 W standby  |  radio 9 W TX
Battery:   78 Wh, 16.8 V nominal, flight-rule floor 30 % SoC
```

Eclipse drain: 6.2 W over 2100 s = 3.6 Wh = **4.6 % of capacity**.

That is the honest answer, and it is a problem for a demo: a 4.6 % swing on
a 0–100 % gauge is a needle that does not move. Two dishonest fixes were
available — shrink the battery, or scale the number. Instead:

- `battery.soc_pct` is the unscaled truth.
- `power.gauge` returns `{min_pct, max_pct}`, the mission's real SoC
  envelope padded by 1 %, so the front end can zoom the *display* while the
  underlying number stays real, and `gauge.note` says so in the payload.
- `depth_of_discharge_pct`, `margin_to_floor_pct` and `hours_to_floor` are
  also returned, because those are the numbers a power engineer actually
  watches.

Two more details that matter:

**CC/CV taper.** Charging at full current up to 88 % SoC, then tapering to
zero at 100 %. Without it the battery slams into the ceiling and flat-lines
for most of the sunlit arc.

**Periodic steady state.** The loop repeats, so it must end at the SoC it
started with or the gauge jumps every time the timeline wraps. `_soc_profile`
integrates, measures the drift, corrects the starting SoC and re-integrates
until `|drift| < 10⁻⁴`. The solved loop runs 93.7 % → 98.8 % → 93.7 %.

---

## 5. The science model

**The field is synthetic. The optics are not.**

*Chl-a field* (`science.chlorophyll_mg_m3`): deterministic value-noise fBm,
shaped by three physical terms — a basin gain (the shallow, hypersaline
Arabian Gulf is bloom-prone; the deeper, better-flushed Gulf of Oman is
less so), a coastal nutrient gradient peaking near 24.9 °N, and a seasonal
forcing term for the late-summer stratified Gulf. Background 1.4 mg/m³,
ceiling 34 mg/m³ — the range the region actually spans between clear water
and a Cochlodinium event.

*Reflectance* (`science._rrs`): a simplified bio-optical model returning
Rrs(λ) in sr⁻¹ from 400–900 nm, built from

| Feature | λ | Physics |
|---|---|---|
| Chl-a Soret band | 443 nm | Pigment absorption, deepens with biomass |
| Green maximum | 555 nm | Backscatter, rises with biomass |
| Phycocyanin | 620 nm | Cyanobacterial pigment absorption |
| Chl-a red band | 665 nm | Absorption |
| Fluorescence | 681 nm | Sun-induced — unambiguously *live* algae |
| NIR red edge | 709 nm | Only appears above ~0.22 bloom index |
| Pure-water absorption | >580 nm | Exponential collapse into the NIR |

Derived indices are computed the way operational ocean-colour processors
compute them:

```
MCI  = Rrs(709) − Rrs(681) − (754−709)/(754−681) · (Rrs(754) − Rrs(681))
NDCI = (Rrs(709) − Rrs(665)) / (Rrs(709) + Rrs(665))
FLH  = Rrs(681) − ½·(Rrs(665) + Rrs(709))
```

Each band row carries `norm` (0–1 against the sample's own peak), so a bar
chart or canvas graph needs no client-side scaling, and `features[]` carries
the labelled diagnostic wavelengths so the graph can annotate its spikes
with what they mean instead of just drawing them.

---

## 6. The scheduler

```
score = 100
      − 62 · bloom_risk               observed algal load, depth-corrected
      − 22 · thermal_stratification   midday warm layer brings motile cells up
      − 16 · tidal_slack              slack water concentrates biomass
      − 11 · turbidity                pre-filter loading
      − 14 · (1 − data_confidence)    conservatism margin for a stale retrieval
```

Design points worth defending:

- **The confidence term is a penalty, not a reward.** A plant acting on a
  90-minute-old retrieval gets a *more cautious* recommendation, because the
  scheduler is less sure what the water is doing. Framing it as a bonus for
  freshness would make "the satellite is awake" appear to improve the water,
  which is nonsense.
- **Intake depth shields against stratification.** Fujairah's 10 m intake
  sits below a surface bloom layer; Jebel Ali's 6 m open intake does not.
  `depth_shield = min(0.55, depth/22)`, applied against the stratification
  term only.
- **Tide uses the M2 period** (12.42 h) with a longitude phase offset, so
  the Gulf and Gulf-of-Oman coasts are not in lockstep — which they are not.
- **Every term is returned per hour.** The prediction box can expand into a
  breakdown; nothing asks the viewer to trust a bare score.

Bands: `≥78 OPTIMAL`, `≥62 ACCEPTABLE`, `≥45 CAUTION`, `≥30 DEGRADED`,
else `CRITICAL` (suspend intake). Each carries operator-language text
("Throttle to 70 % and increase DAF pre-treatment dosing"), not a colour
name.

---

## 7. Gateway responsibilities

The worker is pure; the gateway is where time and connections live.

**MissionClock** owns one number and emits `tick` at 5 Hz. `scrub(true)`
holds playback while a user drags — without it, a dragged slider fights the
autoplay and the thumb stutters.

**TelemetryBus** fans out on four channels and counts subscribers before
building a payload, so a client that only wants `map` never causes a
spectrum to be computed. It also drops frames rather than queueing them if
a tick is still in flight: a slow frame should make the console briefly
coarse, never make it drift behind real time.

**stateCache** memoises by quantised slider with an LRU. Because worker
state is pure, this is a total cache with no invalidation problem — the
hardest cache to get wrong.

---

## 8. What the 3D module does and does not do

`map3d` renders. It holds no mission state, fetches nothing on its own
(`mount()` wires `SentinelLink` to it as a convenience, but `globe.js` has
no network code), and adds nothing to the DOM but its own canvas.

Mode changes are **eased, not snapped**: `_theme` chases `_targetTheme` with
exponential smoothing each frame — the 3D equivalent of a CSS transition, so
crossing a segment boundary while scrubbing does not pop.

The Earth is drawn from baked vector coastlines rather than a texture: no
image assets, works offline, stays sharp at any zoom, and looks like a
mission console rather than a photo. Gulf states are drawn brighter and the
UAE brighter still, because that is the operating theatre.

Two scale decisions worth noting. The spacecraft mesh is a **symbol** — a
real 6U is sub-pixel at globe scale — so it and the surface markers are
rescaled with camera distance to hold a constant apparent size. And the
Chl-a overlay paints into a fixed 512×256 canvas via a scratch canvas,
rather than resizing the canvas the live WebGL texture is bound to; that
resize is exactly the kind of thing that works on one driver and silently
misaligns on another, which is how the overlay originally shipped a
quarter-sized, mispositioned texture until the headless render check caught
it.

---

## 9. Extension points

- **Real orbital mechanics.** Replace `geo.subsatellite_point` with an SGP4
  propagator over a real TLE (`satellite.js`, `sgp4`, or `skyfield`). The
  time warp becomes a scrub over real epoch time; nothing downstream changes
  because everything already reads `snapshot(slider)`.
- **Real ocean colour.** Replace `science.chlorophyll_mg_m3` with a Sentinel-3
  OLCI or PACE retrieval. The reflectance model and every index already
  match the real product definitions.
- **More targets.** Add to `DESAL_PLANTS` in `config.py`; the scheduler,
  markers, alerts and water-quality endpoint all pick them up with no other
  change.
- **Persistence.** Nothing is stateful today. A run log would attach at the
  gateway, which is already the only component that knows what time it is.


---

## 10. The browser port

`site/engine/` is the mission model rewritten in JavaScript so the console can
be hosted as a static site. It is a port, not a reimplementation: same
constants, same formulas, same rounding, same field.

Three things needed care.

**The value-noise hash.** Python does exact big-integer arithmetic; JavaScript
numbers lose precision above 2^53. `seed * 2147483647` overflows that range
before the `& 0xFFFFFFFF` can be applied, so the JS side rewrites the term as
`(seed & 1) * 2^31 - seed` (exact, because `2^31 * seed mod 2^32` depends only
on the low bit of `seed`) and uses `Math.imul` for the other products, which
gives exact 32-bit multiplication. Get this wrong and the chlorophyll field
looks plausible but is a different field — the kind of bug that survives a
demo and dies in a due-diligence session.

**Rounding.** Python's `round()` is banker's rounding; `Number.toFixed()` is
not. The parity harness compares with a 1e-6 absolute tolerance rather than
demanding identical strings, which is the right test: the models agree on the
numbers, and the last decimal place of a display value is not a model.

**Timestamps.** Python writes `+00:00` and microseconds; JavaScript writes `Z`
and milliseconds. The harness compares the instant, allowing 1 ms for the fact
that a JS `Date` has no sub-millisecond resolution.

The two are kept honest by `tools/parity-check.mjs`, which compares 20,410
values and runs in CI before the site is allowed to publish. The Python worker
remains the reference implementation — it is where the science is edited, and
`tools/dump_reference.py` regenerates the fixture from it.

### What the browser engine replaces

The gateway's responsibilities do not vanish; they move into
`site/engine/localLink.js`, which presents the same interface the WebSocket
client did:

| Gateway | Browser |
|---|---|
| `MissionClock` at 5 Hz | `setInterval` on the same cadence |
| 4-channel WebSocket fan-out | an event emitter with the same channel names |
| quantised state cache | the same quantised memoisation, same 1/900 quantum |
| downlink ring buffer | the same, in memory |

Because the interface matches, the three.js globe module is unchanged between
the two deployments. It never knew where its data came from, which was the
point of building it that way.
