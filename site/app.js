/**
 * ORBITAL SENTINEL — console bootstrap.
 *
 * Wires the in-browser mission engine to the panels and the 3D globe. The
 * whole console is static: no server, no build step, no network calls after
 * the page loads. The engine here is a verified port of the Python mission
 * worker in `worker/` — `tools/parity-check.mjs` asserts the two agree on
 * every number, so the hosted demo and the real backend cannot drift apart.
 */
import { OrbitalSentinelGlobe } from './map3d/globe.js';
import { sampleRamp } from './map3d/palette.js';
import { LocalLink } from './engine/localLink.js';
import * as mission from './engine/mission.js';

import { UAEMap } from './ui/uaeMap.js';
import { SpectroGraph } from './ui/spectro.js';
import { DesalPanel } from './ui/desal.js';
import { Timeline } from './ui/timeline.js';
import { Tour } from './ui/tour.js';
import {
  appendLog, applyUIFlags, updateAlerts, updatePower, updateSpacecraft, updateTopbar,
} from './ui/panels.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Boot log — honest about what is happening, and a useful stall indicator.
// ---------------------------------------------------------------------------
const bootLines = $('boot-lines');
let bootN = 0;
function boot(text, ok = true) {
  const d = document.createElement('div');
  d.style.animationDelay = `${bootN++ * 40}ms`;
  d.innerHTML = `${ok ? '<span class="ok">[ OK ]</span>' : '[ .. ]'} ${text}`;
  bootLines.appendChild(d);
}

function fatal(msg) {
  $('fatal-msg').textContent = msg;
  $('fatal').classList.add('on');
  $('boot').classList.add('gone');
  console.error('[console]', msg);
}

window.addEventListener('error', (e) => {
  if (!$('fatal').classList.contains('on')) fatal(String(e.message));
});

// ---------------------------------------------------------------------------
async function main() {
  boot('mission engine loaded (in-browser, no server)');

  const link = new LocalLink({ tickHz: 5, playing: true });
  window.__link = link;                       // handy in the console / for tests

  // --- panels --------------------------------------------------------------
  const uae = await new UAEMap().build();
  boot('UAE coastal vectors');

  const spectro = new SpectroGraph($('spectro'), $('spectro-legend'), $('spectro-idx'));
  const desal = new DesalPanel($('desal-body'), $('desal-tag'));
  const timeline = new Timeline(link);
  timeline.setProfile(mission.timeline(180));
  boot('timeline profile integrated');

  // --- 3D globe ------------------------------------------------------------
  let globe = null;
  try {
    globe = new OrbitalSentinelGlobe($('globe'), { autoRotate: true, cameraDistance: 3.0 });
    await globe.init(await link.bootstrap());
    window.__globe = globe;
    boot('3D globe — WebGL online');
  } catch (err) {
    // A console that loses its globe should still fly. Everything else on the
    // page is independent of it.
    boot('3D globe unavailable — 2D map and telemetry still live', false);
    $('globe').innerHTML =
      '<div style="display:grid;place-items:center;height:100%;color:var(--text-dim);'
      + 'font-size:11px;text-align:center;padding:20px">WebGL UNAVAILABLE<br>'
      + 'The 2D swath map and all telemetry remain live.</div>';
    console.warn('[console] globe failed:', err);
  }

  // --- globe controls ------------------------------------------------------
  if (globe) {
    $('btn-follow').addEventListener('click', (e) => {
      globe.options.followSatellite = !globe.options.followSatellite;
      e.currentTarget.classList.toggle('on', globe.options.followSatellite);
      if (!globe.options.followSatellite) globe.resetView();
    });
    $('btn-aoi').addEventListener('click', () => globe.focusAOI({ distance: 2.1 }));
    $('btn-reset').addEventListener('click', () => {
      globe.options.followSatellite = false;
      $('btn-follow').classList.remove('on');
      globe.resetView();
    });

    // Click-to-pick: the interaction that turns the map into an instrument.
    let pickTimer = null;
    globe.on('pick', async ({ lat, lon }) => {
      const s = await link.spectrum({ lat, lon, slider: link.slider });
      const el = $('pick-readout');
      el.classList.add('show');
      el.innerHTML =
        `<b>SAMPLE ${lat.toFixed(2)}°, ${lon.toFixed(2)}°</b><br>`
        + `Chl-a ${s.indices.chl_a_mg_m3.toFixed(1)} mg/m³ · ${s.indices.severity}<br>`
        + `MCI ${s.indices.mci.toExponential(1)} · NDCI ${s.indices.ndci.toFixed(3)}`;
      spectro.set(s);
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => el.classList.remove('show'), 9000);
    });
  }

  // --- "why" toggles -------------------------------------------------------
  for (const btn of document.querySelectorAll('.why')) {
    btn.addEventListener('click', () => {
      const t = $(btn.dataset.why);
      const open = t.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      if (globe) setTimeout(() => globe.resize(), 320);
    });
  }

  // --- data flow -----------------------------------------------------------
  let lastFieldAt = 0;
  let lastFieldMode = null;

  link.on('state', ({ state }) => {
    updateTopbar(state);
    applyUIFlags(state);
    updatePower(state);
    updateSpacecraft(state);
    updateAlerts(state.alerts);
    timeline.update(state);
    uae.update(state);
    if (state.desalination) desal.update(state.desalination);

    // The spectrum only exists while the shutter is open.
    spectro.set(state.science);

    if (globe && state.science?.water_quality) {
      globe.applyScience({ water_quality: state.science.water_quality });
    }

    $('hud-sub').textContent =
      `${state.map.subsatellite.lat.toFixed(2)}°, ${state.map.subsatellite.lon.toFixed(2)}°`;
    $('hud-range').textContent = `${Math.round(state.map.aoi.range_to_center_km)} km`;
    $('hud-speed').textContent = `${state.map.ground_speed_kms.toFixed(2)} km/s`;

    // The Chl-a field is the expensive product, so refresh it on mode entry
    // and then lazily during the pass.
    const now = performance.now();
    if (state.mode.id === 'ACTIVE') {
      if (state.mode.id !== lastFieldMode || now - lastFieldAt > 2200) {
        lastFieldAt = now;
        lastFieldMode = state.mode.id;
        link.field(state.clock.slider, 64, 32).then((field) => {
          globe?.applyScience({ field });
          uae.setField(field, sampleRamp);
        });
      }
    } else if (lastFieldMode) {
      lastFieldMode = null;
      uae.clearField();
    }
  });

  link.on('map', (frame) => globe?.applyTelemetry(frame));
  link.on('downlink', ({ lines, mode }) => appendLog(lines, mode));

  link.on(':mode', ({ to }) => {
    if (!globe) return;
    globe.setMode(to);
    if (to === 'ACTIVE') globe.focusAOI({ distance: 2.2 });
    if (to === 'ECLIPSE' && !globe.options.followSatellite) globe.resetView();
  });

  // --- go ------------------------------------------------------------------
  await link.connect();
  boot('telemetry stream live');

  // Start on the pass: an investor opening a cold link should land on the
  // moment the mission does something, not on 60 seconds of eclipse.
  link.seek(0.78);

  const tour = new Tour(link);
  window.__tour = tour;

  setTimeout(() => {
    $('boot').classList.add('gone');
    setTimeout(() => $('boot').remove(), 700);
    tour.maybeAutoStart();
  }, 520);
}

main().catch((err) => fatal(err?.message ?? String(err)));
