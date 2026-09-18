/**
 * Geodesy and ground-track geometry — port of `worker/app/geo.py`.
 *
 * Scripted-loop propagator: a circular sun-synchronous ground track whose
 * phase is tuned so the ACTIVE segment always crosses UAE coastal waters.
 * See docs/ARCHITECTURE.md for the derivation of U0_DEG / LON_ASC0_DEG.
 */
import { AOI, LOOP_DURATION_S, SPACECRAFT } from './config.js';

export const R_EARTH_KM = 6378.137;
export const MU_EARTH = 398600.4418;            // km^3 / s^2
export const EARTH_ROT_DEG_PER_MIN = 0.2506844;

export const ALT_KM = SPACECRAFT.orbit.altitude_km;
export const INC_DEG = SPACECRAFT.orbit.inclination_deg;
export const PERIOD_MIN = SPACECRAFT.orbit.period_min;
export const PERIOD_S = PERIOD_MIN * 60.0;
export const SWATH_KM = SPACECRAFT.payload.swath_km;

export const R_ORBIT_KM = R_EARTH_KM + ALT_KM;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const round = (x, n) => Number(x.toFixed(n));

/**
 * The 180 s loop represents one whole 94.9-minute orbit, but the three
 * segments are not compressed equally — a uniform 31.6x would reduce the
 * UAE overpass to under two seconds of demo time.
 *
 *   ECLIPSE     60 s of loop <- 2100 s of orbit  (35.0x)   the 35 min umbra
 *   SUN_FACING  60 s of loop <- 3449 s of orbit  (57.5x)   the sunlit arc
 *   ACTIVE      60 s of loop <-  145 s of orbit  ( 2.4x)   the actual pass
 *
 * The orbital mechanics inside each segment are unchanged; only the rate at
 * which the clock advances differs, and that rate is reported in telemetry
 * as `clock.time_compression` so nothing is hidden.
 */
export const ORBIT_SEGMENTS = [
  { mode: 'ECLIPSE', loop: [0.0, 60.0], orbit: [0.0, 2100.0] },
  { mode: 'SUN_FACING', loop: [60.0, 120.0], orbit: [2100.0, 5549.0] },
  { mode: 'ACTIVE', loop: [120.0, 180.0], orbit: [5549.0, 5694.0] },
];

export const U0_DEG = 29.43;          // argument of latitude at orbit t = 0
export const LON_ASC0_DEG = 81.14;    // ascending-node longitude at orbit t = 0

export function orbitSeconds(loopT) {
  const t = ((loopT % LOOP_DURATION_S) + LOOP_DURATION_S) % LOOP_DURATION_S;
  for (const seg of ORBIT_SEGMENTS) {
    const [l0, l1] = seg.loop;
    if (t >= l0 && t < l1) {
      const [o0, o1] = seg.orbit;
      return o0 + (o1 - o0) * ((t - l0) / (l1 - l0));
    }
  }
  return ORBIT_SEGMENTS[ORBIT_SEGMENTS.length - 1].orbit[1];
}

/** Orbit seconds elapsed per loop second at this point in the timeline. */
export function timeCompression(loopT) {
  const t = ((loopT % LOOP_DURATION_S) + LOOP_DURATION_S) % LOOP_DURATION_S;
  for (const seg of ORBIT_SEGMENTS) {
    const [l0, l1] = seg.loop;
    if (t >= l0 && t < l1) {
      const [o0, o1] = seg.orbit;
      return (o1 - o0) / (l1 - l0);
    }
  }
  return 1.0;
}

export const orbitalVelocityKms = () => Math.sqrt(MU_EARTH / R_ORBIT_KM);
export const groundSpeedKms = () => orbitalVelocityKms() * (R_EARTH_KM / R_ORBIT_KM);

const wrapLon = (lon) => (((lon + 180) % 360) + 360) % 360 - 180;

export function argumentOfLatitude(loopT) {
  return ((U0_DEG + 360.0 * (orbitSeconds(loopT) / PERIOD_S)) % 360 + 360) % 360;
}

/** Geodetic sub-satellite point for a given loop time. */
export function subsatellitePoint(loopT) {
  const orbitT = orbitSeconds(loopT);
  const u = rad(((U0_DEG + 360.0 * (orbitT / PERIOD_S)) % 360 + 360) % 360);
  const i = rad(INC_DEG);

  const lat = deg(Math.asin(Math.sin(i) * Math.sin(u)));
  const dLon = deg(Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)));

  // Earth rotates beneath the orbit in real orbital time, not loop time.
  const drift = EARTH_ROT_DEG_PER_MIN * (orbitT / 60.0);
  const lon = wrapLon(LON_ASC0_DEG + dLon - drift);

  return { lat, lon, alt_km: ALT_KM };
}

/** Polyline of sub-satellite points, for drawing the orbit on the globe. */
export function groundTrack(samples = 240, spanS = LOOP_DURATION_S, startS = 0.0) {
  const out = [];
  for (let k = 0; k <= samples; k += 1) {
    const t = startS + spanS * (k / samples);
    const p = subsatellitePoint(((t % LOOP_DURATION_S) + LOOP_DURATION_S) % LOOP_DURATION_S);
    out.push({ lat: round(p.lat, 5), lon: round(p.lon, 5) });
  }
  return out;
}

/** Instantaneous ground-track heading, degrees clockwise from north. */
export function headingDeg(loopT, dt = 0.5) {
  const a = subsatellitePoint(Math.max(0, loopT - dt));
  const b = subsatellitePoint(Math.min(LOOP_DURATION_S, loopT + dt));
  const dlon = rad(wrapLon(b.lon - a.lon));
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const y = Math.sin(dlon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle destination point. */
function offset(lat, lon, bearingDeg, distKm) {
  const d = distKm / R_EARTH_KM;
  const br = rad(bearingDeg);
  const la1 = rad(lat);
  const lo1 = rad(lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2),
  );
  return [deg(la2), wrapLon(deg(lo2))];
}

/** Left and right edge points of the instantaneous scan line. */
export function swathEdges(loopT) {
  const p = subsatellitePoint(loopT);
  const hdg = headingDeg(loopT);
  const half = SWATH_KM / 2;
  const [lLat, lLon] = offset(p.lat, p.lon, (hdg - 90 + 360) % 360, half);
  const [rLat, rLon] = offset(p.lat, p.lon, (hdg + 90) % 360, half);
  return {
    left: { lat: round(lLat, 5), lon: round(lLon, 5) },
    right: { lat: round(rLat, 5), lon: round(rLon, 5) },
  };
}

/**
 * Closed [lon, lat] ring covering everything imaged between two loop times.
 * Emitted GeoJSON-compatible so a UI can drop it straight into a map layer.
 */
export function swathPolygon(startS, endS, samples = 40) {
  const left = [];
  const right = [];
  for (let k = 0; k <= samples; k += 1) {
    const t = startS + (endS - startS) * (k / samples);
    const e = swathEdges(t);
    left.push([e.left.lon, e.left.lat]);
    right.push([e.right.lon, e.right.lat]);
  }
  const ring = left.concat(right.slice().reverse());
  ring.push(ring[0]);
  return ring;
}

export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const la1 = rad(lat1);
  const la2 = rad(lat2);
  const dla = la2 - la1;
  const dlo = rad(lon2 - lon1);
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function inAOI(lat, lon) {
  const [w, s, e, n] = AOI.bbox;
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

/** Straight-line range from the spacecraft to a point on the surface. */
export function slantRangeKm(lat, lon, targetLat, targetLon) {
  const arc = greatCircleKm(lat, lon, targetLat, targetLon) / R_EARTH_KM;
  return Math.sqrt(R_ORBIT_KM ** 2 + R_EARTH_KM ** 2
    - 2 * R_ORBIT_KM * R_EARTH_KM * Math.cos(arc));
}

/** Elevation angle of the spacecraft as seen from a ground station. */
export function elevationDeg(satLat, satLon, gsLat, gsLon) {
  const arc = greatCircleKm(satLat, satLon, gsLat, gsLon) / R_EARTH_KM;
  const rng = slantRangeKm(satLat, satLon, gsLat, gsLon);
  if (rng <= 0) return 90;
  const cosEl = (R_ORBIT_KM * Math.sin(arc)) / rng;
  return deg(Math.acos(Math.min(1, Math.max(-1, cosEl))));
}
