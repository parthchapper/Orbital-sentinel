/**
 * Guided tour.
 *
 * An investor console that needs a person standing next to it to be
 * understood is only half a console. The tour drives the timeline itself, so
 * each step shows the thing it is describing actually happening — it is a
 * demo script the page can run on its own.
 */
const STEPS = [
  {
    target: '#timeline',
    title: 'One control',
    body: 'Everything on this console is a function of this slider. It scrubs one '
      + '95-minute orbit in 180 seconds. The curve behind it is the real battery '
      + 'state of charge across that orbit — drag anywhere and every panel follows.',
    slider: 0.14,
  },
  {
    target: '#power-panel',
    title: 'Eclipse — power saving',
    body: 'In Earth\'s shadow the arrays make nothing, the imager is switched off at '
      + 'the rail, and the battery carries the 6.2 W housekeeping load alone. Note the '
      + 'gauge scale: a real orbit only moves the battery about 5 %, so the display is '
      + 'zoomed to the mission\'s actual range rather than faking a bigger swing.',
    slider: 0.2,
  },
  {
    target: '#power-panel',
    title: 'Sunlight — recharge',
    body: 'Arrays sun-pointed, ~39 W in, and the charge curve tapers as the battery '
      + 'fills — constant-current up to 88 %, then constant-voltage, exactly as a real '
      + 'lithium cell behaves. The payload sits in standby, cooling its detector to '
      + '−40 °C in preparation.',
    slider: 0.5,
  },
  {
    target: '#globe-panel',
    title: 'The pass',
    body: 'The spacecraft crosses UAE coastal waters. This segment runs at 2.4× real '
      + 'time rather than the 35–57× used elsewhere, because the overpass is the whole '
      + 'point and compressing it uniformly would reduce it to four seconds. Drag the '
      + 'globe, or click any point on it to sample that spot\'s spectrum.',
    slider: 0.72,
  },
  {
    target: '#spectro-panel',
    title: 'What the instrument sees',
    body: 'Reflected light split into 96 bands. Algae absorb blue and red, reflect '
      + 'green, and — decisively — re-emit light at 681 nm. That fluorescence peak only '
      + 'appears over living algae, which is why this measurement cannot be faked by '
      + 'sediment or glare. Hover the graph to read any band.',
    slider: 0.84,
  },
  {
    target: '#uae-panel',
    title: 'Where it looked',
    body: 'The bright line is the instantaneous scan line; the shaded band is '
      + 'everything captured so far this pass. One crossing covers a 180 km swath at '
      + '30 m resolution — the entire UAE coast in a single strip, once a day.',
    slider: 0.9,
  },
  {
    target: '#desal-panel',
    title: 'The product',
    body: 'This is what the measurement is for. Algal blooms clog reverse-osmosis '
      + 'intakes; the 2008–09 bloom repeatedly shut Fujairah down. Each plant gets a '
      + 'draw/throttle/hold verdict and a best window. Hover the 24-hour strip to see '
      + 'every term behind a score — bloom load, stratification, tide, turbidity, and '
      + 'a margin for how old the observation is.',
    slider: 0.9,
  },
  {
    target: '#downlink-panel',
    title: 'Nothing is decoration',
    body: 'Every line in this log is a value shown elsewhere on the console, tagged '
      + 'with its CCSDS application ID. The rate rises with activity — one line per '
      + 'tick in eclipse, four during a pass. Tour complete: the slider is yours.',
    slider: 0.95,
  },
];

export class Tour {
  constructor(link) {
    this.link = link;
    this.mask = document.getElementById('tour-mask');
    this.ring = document.getElementById('tour-ring');
    this.card = document.getElementById('tour-card');
    this.i = 0;
    this._wasPlaying = true;

    document.getElementById('tour-next').addEventListener('click', () => this.go(this.i + 1));
    document.getElementById('tour-prev').addEventListener('click', () => this.go(this.i - 1));
    document.getElementById('tour-skip').addEventListener('click', () => this.stop());
    document.getElementById('btn-tour').addEventListener('click', () => this.start());
    this.mask.addEventListener('click', (e) => { if (e.target === this.mask) this.stop(); });

    this._onKey = (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') this.stop();
      if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(this.i + 1);
      if (e.key === 'ArrowLeft') this.go(this.i - 1);
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', () => { if (this.active) this._place(); });
  }

  start() {
    this.active = true;
    this._wasPlaying = this.link.playing;
    this.link.setTransport({ playing: false });
    this.mask.classList.add('on');
    this.go(0);
  }

  stop() {
    this.active = false;
    this.mask.classList.remove('on');
    this.link.setTransport({ playing: this._wasPlaying });
    try { localStorage.setItem('os-tour-seen', '1'); } catch { /* private mode */ }
  }

  go(i) {
    if (i < 0) return;
    if (i >= STEPS.length) { this.stop(); return; }
    this.i = i;
    const step = STEPS[i];

    if (step.slider != null) this.link.seek(step.slider);

    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-body').textContent = step.body;
    document.getElementById('tour-step').textContent = `${i + 1} / ${STEPS.length}`;
    document.getElementById('tour-next').textContent =
      i === STEPS.length - 1 ? 'FINISH' : 'NEXT';
    document.getElementById('tour-prev').style.visibility = i === 0 ? 'hidden' : 'visible';

    // The panel may have just become visible (ACTIVE-only panels), so place
    // after the layout transition has had a frame to run.
    this._place();
    setTimeout(() => this._place(), 420);
  }

  _place() {
    const step = STEPS[this.i];
    const el = document.querySelector(step.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 4;

    this.ring.style.left = `${r.left - pad}px`;
    this.ring.style.top = `${r.top - pad}px`;
    this.ring.style.width = `${r.width + pad * 2}px`;
    this.ring.style.height = `${r.height + pad * 2}px`;

    const cw = Math.min(370, window.innerWidth - 24);
    this.card.style.width = `${cw}px`;
    const ch = this.card.offsetHeight || 190;

    // Prefer the side with room; fall back to above/below on narrow screens.
    let left = r.right + 16;
    if (left + cw > window.innerWidth - 12) left = r.left - cw - 16;
    if (left < 12) left = Math.max(12, (window.innerWidth - cw) / 2);

    let top = r.top + r.height / 2 - ch / 2;
    if (top + ch > window.innerHeight - 12) top = window.innerHeight - ch - 12;
    if (top < 12) top = 12;

    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  /**
   * Offer the tour on a first visit by drawing attention to the button,
   * rather than launching it unasked. A modal that opens over someone who
   * already knows what they are looking at is an obstacle, not an
   * introduction — and this console may well be opened by the person
   * presenting it.
   */
  maybeAutoStart() {
    let seen = '1';
    try { seen = localStorage.getItem('os-tour-seen'); } catch { /* private mode */ }
    if (seen) return;
    const btn = document.getElementById('btn-tour');
    btn.classList.add('invite');
    const clear = () => {
      btn.classList.remove('invite');
      try { localStorage.setItem('os-tour-seen', '1'); } catch { /* private mode */ }
    };
    btn.addEventListener('click', clear, { once: true });
    setTimeout(clear, 30000);
  }
}

export default Tour;
