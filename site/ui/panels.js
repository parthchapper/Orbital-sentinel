/**
 * Top bar, power panel, spacecraft panel and the downlink log.
 *
 * All of these read the one snapshot, so nothing here recomputes anything —
 * these functions only format.
 */
const $ = (id) => document.getElementById(id);
const f = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
export function updateTopbar(state) {
  $('v-mode').textContent = state.mode.label;
  $('banner').textContent = state.mode.banner;
  $('banner').title = state.mode.description;

  const t = state.clock.mission_time_utc.slice(11, 19);
  $('v-met').textContent = t;
  $('v-orbit').textContent = `#${state.clock.orbit_number} · ${f(state.clock.time_compression, 1)}×`;
  $('v-orbit').title = state.clock.time_compression_note;
}

export function updateAlerts(alerts) {
  const el = $('alerts');
  el.replaceChildren(...alerts.map((a) => {
    const d = document.createElement('div');
    d.className = `alert ${a.level}`;
    d.innerHTML = `<code>${a.code}</code> ${a.text}`;
    return d;
  }));
  if (!alerts.length) el.innerHTML = '<div class="alert">ALL SUBSYSTEMS NOMINAL</div>';
}

/** CSS classes straight off the backend's ui_flags — no mode logic here. */
export function applyUIFlags(state) {
  document.body.dataset.mode = state.mode.id;
  for (const [flag, on] of Object.entries(state.mode.ui_flags)) {
    document.body.classList.toggle(flag, Boolean(on));
  }
  $('spectro-panel').classList.toggle('idle', !state.mode.ui_flags.show_spectroscopy);
  $('downlink-panel').classList.toggle('idle', !state.comms.downlink.live);
  $('dl-dot').classList.toggle('off', !state.comms.downlink.live);
  $('downlink-panel').classList.toggle('live', state.comms.downlink.live);
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------
export function updatePower(state) {
  const p = state.power;
  const b = p.battery;

  // SoC on the zoomed display window, with the true value printed.
  const span = Math.max(1e-6, p.gauge.max_pct - p.gauge.min_pct);
  const frac = Math.max(0, Math.min(1, (b.soc_pct - p.gauge.min_pct) / span));
  $('g-soc').textContent = `${f(b.soc_pct, 2)} %`;
  $('g-soc-fill').style.width = `${frac * 100}%`;
  $('g-soc-fill').className = 'gauge-fill'
    + (b.violated ? ' red' : b.margin_to_floor_pct < 12 ? ' amber' : '');
  $('g-soc-min').textContent = `${f(p.gauge.min_pct, 1)} %`;
  $('g-soc-max').textContent = `${f(p.gauge.max_pct, 1)} %`;
  $('g-soc-note').textContent =
    `${p.flow} ${f(Math.abs(p.net_w), 2)} W · DoD ${f(b.depth_of_discharge_pct, 2)} %`
    + ` · scale zoomed to the mission's real envelope`;

  $('g-gen').textContent = `${f(p.generation_w, 2)} W`;
  $('g-gen-fill').style.width = `${(p.generation_w / p.array_peak_w) * 100}%`;
  $('g-gen-fill').className = 'gauge-fill amber'
    + (p.generation_w === 0 ? ' disabled' : '');

  $('g-load').textContent = `${f(p.loads.total_w, 2)} W`;
  $('g-load-fill').style.width = `${Math.min(100, (p.loads.total_w / 40) * 100)}%`;

  $('power-flow-tag').textContent = p.flow;
  $('power-panel').dataset.accent = p.flow === 'DISCHARGING' ? 'amber' : '';

  $('power-kv').innerHTML = `
    <dt>Bus / payload / radio</dt>
    <dd>${f(p.loads.bus_w, 1)} · ${f(p.loads.payload_w, 1)} · ${f(p.loads.radio_w, 1)} W</dd>
    <dt>Net</dt><dd class="${p.net_w < 0 ? 'warn' : 'ok'}">${p.net_w > 0 ? '+' : ''}${f(p.net_w, 2)} W</dd>
    <dt>Stored energy</dt><dd>${f(b.stored_wh, 1)} / ${b.capacity_wh} Wh</dd>
    <dt>Bus voltage</dt><dd>${f(b.bus_voltage_v, 2)} V</dd>
    <dt>Margin to floor</dt>
    <dd class="${b.margin_to_floor_pct < 12 ? 'warn' : ''}">${f(b.margin_to_floor_pct, 1)} pp</dd>
    <dt>Array cosine</dt><dd>${f(p.array_cosine, 2)}</dd>`;

  drawPowerFlow(p);
}

/**
 * Generation → battery → loads, as a diagram.
 *
 * Three numbers in a row do not show that the battery is the thing in the
 * middle absorbing the difference. A diagram does, and the dash animation
 * makes the direction of flow unambiguous.
 */
function drawPowerFlow(p) {
  const svg = $('power-flow');
  const charging = p.net_w > 0.05;
  const gen = p.generation_w;
  const load = p.loads.total_w;

  svg.innerHTML = `
    <rect class="node" x="2"  y="16" width="62" height="26" rx="2"/>
    <rect class="node" x="109" y="10" width="62" height="38" rx="2"/>
    <rect class="node" x="216" y="16" width="62" height="26" rx="2"/>

    <text x="33"  y="12" text-anchor="middle">ARRAY</text>
    <text x="140" y="8"  text-anchor="middle">BATTERY</text>
    <text x="247" y="12" text-anchor="middle">LOADS</text>

    <text class="val" x="33"  y="33" text-anchor="middle">${gen.toFixed(1)} W</text>
    <text class="val" x="140" y="26" text-anchor="middle">${p.battery.soc_pct.toFixed(1)} %</text>
    <text class="val" x="247" y="33" text-anchor="middle">${load.toFixed(1)} W</text>
    <text x="140" y="40" text-anchor="middle">${charging ? 'CHARGING' : p.flow}</text>

    <path class="wire ${gen > 0 ? 'on pulse' : ''}" d="M64 29 H109"/>
    <path class="wire out pulse" d="M171 29 H216"/>
    <text x="86"  y="24" text-anchor="middle">${gen > 0 ? '→' : '×'}</text>
    <text x="193" y="24" text-anchor="middle">→</text>`;
}

// ---------------------------------------------------------------------------
// Spacecraft
// ---------------------------------------------------------------------------
export function updateSpacecraft(state) {
  const a = state.attitude;
  const th = state.thermal;
  const c = state.comms;
  const pl = state.payload;

  $('sc-kv').innerHTML = `
    <dt>Attitude mode</dt><dd>${a.mode}</dd>
    <dt>R / P / Y</dt>
    <dd>${a.roll_deg.toFixed(1)} · ${a.pitch_deg.toFixed(1)} · ${a.yaw_deg.toFixed(1)}°</dd>
    <dt>Star tracker</dt><dd>${a.star_tracker}</dd>
    <dt>Payload</dt>
    <dd class="${pl.imaging ? 'ok' : ''}">${pl.state.replace('_', ' ')}</dd>
    <dt>Shutter</dt><dd>${pl.shutter}${pl.imaging ? ` · ${pl.integration_ms} ms` : ''}</dd>
    <dt>Frames captured</dt><dd>${pl.frames_captured}</dd>
    <dt>Detector</dt>
    <dd class="${Math.abs(th.detector_c - th.detector_setpoint_c) > 3 ? 'warn' : 'ok'}">${f(th.detector_c, 1)} °C</dd>
    <dt>TEC duty</dt><dd>${f(th.tec_duty_pct, 0)} %</dd>
    <dt>Bus / battery temp</dt><dd>${f(th.bus_c, 1)} · ${f(th.battery_c, 1)} °C</dd>
    <dt>Recorder</dt>
    <dd class="${c.recorder.fill_pct > 70 ? 'warn' : ''}">${f(c.recorder.fill_pct, 1)} % of ${c.recorder.capacity_gb} GB</dd>
    <dt>Link</dt><dd class="${c.downlink.live ? 'ok' : ''}">${c.state}</dd>
    ${c.downlink.live ? `<dt>Downlink rate</dt><dd class="ok">${f(c.downlink.rate_mbps, 1)} Mbps</dd>
    <dt>Eb/N0 · BER</dt><dd>${f(c.downlink.eb_n0_db, 1)} dB · ${c.downlink.ber.toExponential(1)}</dd>` : ''}`;
}

// ---------------------------------------------------------------------------
// Downlink log
// ---------------------------------------------------------------------------
const MAX_ROWS = 220;

export function appendLog(lines, mode) {
  const log = $('log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const frag = document.createDocumentFragment();

  for (const l of lines) {
    const row = document.createElement('div');
    row.className = `row ${l.severity} new`;
    row.innerHTML =
      `<span class="t">${l.t}</span>`
      + `<span class="apid">${l.apid}</span>`
      + `<span class="sub">${l.subsystem}</span>`
      + `<span class="txt">${l.text}</span>`;
    frag.appendChild(row);
  }
  log.appendChild(frag);

  while (log.childElementCount > MAX_ROWS) log.removeChild(log.firstElementChild);
  if (atBottom) log.scrollTop = log.scrollHeight;

  $('dl-tag').textContent = mode === 'ACTIVE' ? '4 LINES/TICK · X-BAND' : `${mode} · BEACON`;
}
