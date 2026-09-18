/**
 * Headless check of the static console.
 *
 * Loads the site exactly as GitHub Pages will serve it, drives the timeline
 * through all three modes, exercises the interactions, and asserts the panels
 * actually rendered — then screenshots each mode plus a mobile viewport.
 *
 *   node tools/serve.mjs 4173 site &
 *   node tools/site-check.mjs [url]
 *
 * CHROMIUM_PATH lets this run against a preinstalled browser in CI images
 * that do not ship the exact build Playwright would download.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4173';
const OUT = resolve(__dirname, '../artifacts');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => '');

async function setSlider(page, v) {
  await page.evaluate((x) => window.__link.seek(x), v);
  await page.waitForTimeout(700);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nstatic console check -> ${BASE}\n`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
      // Chromium phones home on startup. In a sandbox those connections fail,
      // and a naive requestfailed handler counts them as page errors.
      '--disable-background-networking', '--disable-component-update',
      '--no-first-run', '--disable-sync',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  // Only the site's own assets matter here: the console makes no external
  // requests, so anything off-origin is the browser talking to itself.
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(BASE)) errors.push(`request failed: ${r.url()}`);
  });

  // --- boot ----------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__link?.connected === true, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  check('console booted', await page.evaluate(() => Boolean(window.__link?.connected)));
  check('no fatal panel', !(await page.$eval('#fatal', (e) => e.classList.contains('on')).catch(() => true)));
  check('boot overlay dismissed', await page.$eval('#boot', (e) => e === null || e.classList.contains('gone')).catch(() => true));
  check('WebGL globe constructed', await page.evaluate(() => Boolean(window.__globe)));
  check('globe rendering frames', await page.evaluate(async () => {
    const g = window.__globe; if (!g) return false;
    let n = 0;
    const orig = g.renderer.render.bind(g.renderer);
    g.renderer.render = (...a) => { n += 1; return orig(...a); };
    await new Promise((r) => setTimeout(r, 1500));
    return n > 5;
  }));

  // --- the engine, in the browser -----------------------------------------
  const engine = await page.evaluate(() => {
    const s = window.__link.snapshot(0.8333);
    return {
      mode: s.mode.id,
      banner: s.mode.banner,
      lat: s.map.subsatellite.lat,
      lon: s.map.subsatellite.lon,
      overAOI: s.map.aoi.over_aoi,
      bands: s.science?.bands?.length ?? 0,
      chl: s.science?.indices?.chl_a_mg_m3 ?? null,
      plants: s.desalination?.plants?.length ?? 0,
      soc: s.power.battery.soc_pct,
    };
  });
  check('engine: slider 0.8333 is ACTIVE', engine.mode === 'ACTIVE', engine.mode);
  check('engine: subpoint over the AOI', engine.overAOI === true, `${engine.lat}, ${engine.lon}`);
  check('engine: 96 spectral bands', engine.bands === 96, String(engine.bands));
  check('engine: both plants scheduled', engine.plants === 2, String(engine.plants));
  check('engine: battery in the solved envelope', engine.soc > 93 && engine.soc < 99, String(engine.soc));

  // --- ECLIPSE -------------------------------------------------------------
  await setSlider(page, 0.16);
  check('ECLIPSE: banner reads POWER SAVING', (await text(page, '#banner')) === 'POWER SAVING');
  check('ECLIPSE: UI dimmed', await page.evaluate(() => document.body.classList.contains('dim_ui')));
  check('ECLIPSE: payload disabled flag', await page.evaluate(() => document.body.classList.contains('payload_disabled')));
  check('ECLIPSE: 2D map hidden', await page.$eval('#uae-panel', (e) => getComputedStyle(e).opacity === '0'));
  check('ECLIPSE: generation is zero', (await text(page, '#g-gen')).startsWith('0.00'));
  check('ECLIPSE: spectroscopy idle', await page.$eval('#spectro-panel', (e) => e.classList.contains('idle')));
  await page.screenshot({ path: `${OUT}/site-eclipse.png` });

  // --- SUN_FACING ----------------------------------------------------------
  await setSlider(page, 0.5);
  check('SUN_FACING: solar gauges shown', await page.evaluate(() => document.body.classList.contains('show_solar_gauges')));
  check('SUN_FACING: generating power', parseFloat(await text(page, '#g-gen')) > 30);
  check('SUN_FACING: UI no longer dimmed', !(await page.evaluate(() => document.body.classList.contains('dim_ui'))));
  await page.screenshot({ path: `${OUT}/site-sunfacing.png` });

  // --- ACTIVE --------------------------------------------------------------
  await setSlider(page, 0.86);
  await page.waitForTimeout(2200);           // let the Chl-a field land
  check('ACTIVE: banner reads TARGET ACQUIRED', (await text(page, '#banner')) === 'TARGET ACQUIRED');
  check('ACTIVE: banner flashing', await page.evaluate(() => document.body.classList.contains('flash_banner')));
  check('ACTIVE: 2D map visible', await page.$eval('#uae-panel', (e) => getComputedStyle(e).opacity === '1'));
  check('ACTIVE: scan line drawn', await page.$eval('#uae-scanline', (e) => Number(e.getAttribute('x2')) > 0));
  check('ACTIVE: swath band drawn', await page.$eval('#uae-swath', (e) => (e.getAttribute('points') || '').length > 40));
  check('ACTIVE: bloom overlay painted on 2D map', await page.$eval('#uae-bloom', (e) => e.childElementCount > 10));
  check('ACTIVE: spectroscopy canvas has ink', await page.evaluate(() => {
    const c = document.getElementById('spectro');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) lit += 1;
    return lit > 4000;
  }));
  check('ACTIVE: spectral feature legend populated',
    await page.$eval('#spectro-legend', (e) => e.childElementCount === 8));
  check('ACTIVE: indices rendered', await page.$eval('#spectro-idx', (e) => e.childElementCount === 6));
  check('ACTIVE: downlink log streaming', await page.$eval('#log', (e) => e.childElementCount > 10));
  check('ACTIVE: live dot lit', await page.$eval('#dl-dot', (e) => !e.classList.contains('off')));
  check('ACTIVE: globe bloom texture painted', await page.evaluate(() => {
    const b = window.__globe?.bloom; if (!b) return false;
    const c = b.canvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit += 1;
    return lit > 1000;
  }));
  await page.screenshot({ path: `${OUT}/site-active.png` });

  // --- desalination panel --------------------------------------------------
  check('desal: two plant cards', await page.$$eval('.plant-card', (n) => n.length === 2));
  check('desal: verdicts rendered',
    await page.$$eval('.verdict', (n) => n.length === 2 && n.every((v) => /DRAW|REDUCE|HOLD/.test(v.textContent))));
  check('desal: 24-hour strips', await page.$$eval('.hours', (n) => n.every((h) => h.childElementCount === 24)));
  check('desal: hour bars carry a term breakdown',
    await page.$eval('.hours .h', (b) => (b.title || '').includes('bloom risk')));
  check('desal: verdicts differ from the network tag',
    (await text(page, '#desal-tag')).includes('NETWORK'));

  // --- interactions --------------------------------------------------------
  const before = await text(page, '#tl-pos');
  await page.click('.mode-btn[data-mode="ECLIPSE"]');
  await page.waitForTimeout(600);
  check('mode button snaps the slider', (await text(page, '#tl-pos')) !== before);
  check('mode button marks itself pressed',
    await page.$eval('.mode-btn[data-mode="ECLIPSE"]', (e) => e.getAttribute('aria-pressed') === 'true'));

  await page.click('#btn-play');
  check('pause button toggles transport', await page.evaluate(() => window.__link.playing === false));
  await page.click('#btn-play');

  await page.click('.why[data-why="why-power"]');
  check('explain toggle opens', await page.$eval('#why-power', (e) => e.classList.contains('open')));

  // Click-to-pick on the globe: sample a point and read its spectrum back.
  await setSlider(page, 0.86);
  const picked = await page.evaluate(async () => {
    const g = window.__globe; if (!g) return false;
    g._emit('pick', { lat: 24.8, lon: 54.0, alt_km: 0 });
    await new Promise((r) => setTimeout(r, 900));
    return document.getElementById('pick-readout').classList.contains('show');
  });
  check('globe click-to-pick samples a spectrum', picked);

  // --- guided tour ---------------------------------------------------------
  await page.click('#btn-tour');
  await page.waitForTimeout(900);
  check('tour opens', await page.$eval('#tour-mask', (e) => e.classList.contains('on')));
  check('tour step 1 rendered', (await text(page, '#tour-title')).length > 3);
  await page.screenshot({ path: `${OUT}/site-tour.png` });
  await page.click('#tour-next');
  await page.waitForTimeout(700);
  check('tour advances', (await text(page, '#tour-step')).startsWith('2'));
  await page.click('#tour-skip');
  await page.waitForTimeout(400);
  check('tour closes', !(await page.$eval('#tour-mask', (e) => e.classList.contains('on'))));

  // --- mobile --------------------------------------------------------------
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  mobile.on('pageerror', (e) => errors.push(`mobile: ${e.message}`));
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__link?.connected === true, null, { timeout: 30000 }).catch(() => {});
  await mobile.evaluate(() => window.__link.seek(0.86));
  await mobile.waitForTimeout(2500);
  // documentElement.scrollWidth can report the viewport width while content
  // overflows inside body, so check both and the widest element on the page.
  const overflow = await mobile.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let widest = 0; let who = '';
    for (const el of document.querySelectorAll('#console *')) {
      // Skip SVG internals: their bounding box is geometry, not layout, and
      // is clipped by the viewBox regardless of how far the paths run.
      if (el.ownerSVGElement) continue;
      const r = el.getBoundingClientRect();
      if (r.width > widest) { widest = r.width; who = el.id || el.className || el.tagName; }
    }
    return { vw, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
             widest: Math.round(widest), who: String(who).slice(0, 40) };
  });
  check('mobile: no horizontal overflow',
    overflow.doc <= overflow.vw + 1 && overflow.body <= overflow.vw + 1
      && overflow.widest <= overflow.vw + 1,
    `vw=${overflow.vw} body=${overflow.body} widest=${overflow.widest} (${overflow.who})`);
  check('mobile: console rendered', await mobile.$eval('#console', (e) => e.offsetHeight > 400));
  await mobile.screenshot({ path: `${OUT}/site-mobile.png`, fullPage: false });
  await mobile.close();

  // --- errors --------------------------------------------------------------
  const real = errors.filter((e) => !/favicon/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\nscreenshots -> ${OUT}`);
  console.log(`${failed ? `${failed} FAILED` : 'all checks passed'}\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('\nsite check aborted:', e.message, '\n'); process.exit(2); });
