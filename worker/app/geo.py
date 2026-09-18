"""
Geodesy and ground-track geometry.

Scripted-loop propagator: a circular sun-synchronous ground track whose
phase is tuned so the ACTIVE segment always crosses UAE coastal waters.
Deterministic by design — see docs/ARCHITECTURE.md, "Scripted demo loop".
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

from .config import AOI, LOOP_DURATION_S, SPACECRAFT

R_EARTH_KM = 6378.137
MU_EARTH = 398600.4418            # km^3 / s^2
EARTH_ROT_DEG_PER_MIN = 0.2506844

ALT_KM = SPACECRAFT["orbit"]["altitude_km"]
INC_DEG = SPACECRAFT["orbit"]["inclination_deg"]
PERIOD_MIN = SPACECRAFT["orbit"]["period_min"]
PERIOD_S = PERIOD_MIN * 60.0
SWATH_KM = SPACECRAFT["payload"]["swath_km"]

R_ORBIT_KM = R_EARTH_KM + ALT_KM

# ---------------------------------------------------------------------------
# Time warp
# ---------------------------------------------------------------------------
# The 180 s loop represents one whole 94.9-minute orbit, but the three
# segments are not compressed equally — a uniform 31.6x would reduce the
# UAE overpass to under two seconds of demo time.
#
# Instead each segment gets the share of screen time its content deserves:
#   ECLIPSE     60 s of loop <- 2100 s of orbit  (35.0x)   the 35 min umbra
#   SUN_FACING  60 s of loop <- 3449 s of orbit  (57.5x)   the sunlit arc
#   ACTIVE      60 s of loop <-  145 s of orbit  ( 2.4x)   the actual pass
#
# The orbital mechanics inside each segment are unchanged; only the rate at
# which the clock advances differs, and the rate is reported in telemetry as
# `clock.time_compression` so nothing is hidden.
ORBIT_SEGMENTS = [
    {"mode": "ECLIPSE", "loop": (0.0, 60.0), "orbit": (0.0, 2100.0)},
    {"mode": "SUN_FACING", "loop": (60.0, 120.0), "orbit": (2100.0, 5549.0)},
    {"mode": "ACTIVE", "loop": (120.0, 180.0), "orbit": (5549.0, 5694.0)},
]

# Phase constants solved so the mid-point of the ACTIVE segment puts the
# sub-satellite point on the AOI centre. See docs/ARCHITECTURE.md.
U0_DEG = 29.43          # argument of latitude at orbit t = 0
LON_ASC0_DEG = 81.14    # ascending-node longitude at orbit t = 0


def orbit_seconds(loop_t: float) -> float:
    """Map a loop time onto seconds since the start of the orbit."""
    t = loop_t % LOOP_DURATION_S
    for seg in ORBIT_SEGMENTS:
        l0, l1 = seg["loop"]
        if l0 <= t < l1:
            o0, o1 = seg["orbit"]
            return o0 + (o1 - o0) * ((t - l0) / (l1 - l0))
    return ORBIT_SEGMENTS[-1]["orbit"][1]


def time_compression(loop_t: float) -> float:
    """Orbit seconds elapsed per loop second at this point in the timeline."""
    t = loop_t % LOOP_DURATION_S
    for seg in ORBIT_SEGMENTS:
        l0, l1 = seg["loop"]
        if l0 <= t < l1:
            o0, o1 = seg["orbit"]
            return (o1 - o0) / (l1 - l0)
    return 1.0


def orbital_velocity_kms() -> float:
    return math.sqrt(MU_EARTH / R_ORBIT_KM)


def ground_speed_kms() -> float:
    """Speed of the sub-satellite point across the surface."""
    return orbital_velocity_kms() * (R_EARTH_KM / R_ORBIT_KM)


def _wrap_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def argument_of_latitude(loop_t: float) -> float:
    """Argument of latitude in degrees for a loop time in [0, LOOP_DURATION_S)."""
    return (U0_DEG + 360.0 * (orbit_seconds(loop_t) / PERIOD_S)) % 360.0


def subsatellite_point(loop_t: float) -> Dict[str, float]:
    """Geodetic sub-satellite point for a given loop time."""
    orbit_t = orbit_seconds(loop_t)
    u = math.radians((U0_DEG + 360.0 * (orbit_t / PERIOD_S)) % 360.0)
    i = math.radians(INC_DEG)

    lat = math.degrees(math.asin(math.sin(i) * math.sin(u)))
    d_lon = math.degrees(math.atan2(math.cos(i) * math.sin(u), math.cos(u)))

    # Earth rotates beneath the orbit in real orbital time, not loop time.
    drift = EARTH_ROT_DEG_PER_MIN * (orbit_t / 60.0)
    lon = _wrap_lon(LON_ASC0_DEG + d_lon - drift)

    return {"lat": lat, "lon": lon, "alt_km": ALT_KM}


def ground_track(samples: int = 240, span_s: float = LOOP_DURATION_S,
                 start_s: float = 0.0) -> List[Dict[str, float]]:
    """Polyline of sub-satellite points, for drawing the orbit on the globe."""
    out = []
    for k in range(samples + 1):
        t = start_s + span_s * (k / samples)
        p = subsatellite_point(t % LOOP_DURATION_S)
        out.append({"lat": round(p["lat"], 5), "lon": round(p["lon"], 5)})
    return out


def heading_deg(loop_t: float, dt: float = 0.5) -> float:
    """Instantaneous ground-track heading, degrees clockwise from north."""
    a = subsatellite_point(max(0.0, loop_t - dt))
    b = subsatellite_point(min(LOOP_DURATION_S, loop_t + dt))
    dlon = math.radians(_wrap_lon(b["lon"] - a["lon"]))
    la1, la2 = math.radians(a["lat"]), math.radians(b["lat"])
    y = math.sin(dlon) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _offset(lat: float, lon: float, bearing_deg: float, dist_km: float
            ) -> Tuple[float, float]:
    """Great-circle destination point."""
    d = dist_km / R_EARTH_KM
    br = math.radians(bearing_deg)
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) +
                    math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), _wrap_lon(math.degrees(lo2))


def swath_edges(loop_t: float) -> Dict[str, Dict[str, float]]:
    """Left and right edge points of the instantaneous scan line."""
    p = subsatellite_point(loop_t)
    hdg = heading_deg(loop_t)
    half = SWATH_KM / 2.0
    l_lat, l_lon = _offset(p["lat"], p["lon"], (hdg - 90.0) % 360.0, half)
    r_lat, r_lon = _offset(p["lat"], p["lon"], (hdg + 90.0) % 360.0, half)
    return {
        "left": {"lat": round(l_lat, 5), "lon": round(l_lon, 5)},
        "right": {"lat": round(r_lat, 5), "lon": round(r_lon, 5)},
    }


def swath_polygon(start_s: float, end_s: float, samples: int = 40
                  ) -> List[List[float]]:
    """
    Closed [lon, lat] ring covering everything imaged between two loop times.
    Emitted as a GeoJSON-compatible ring so a UI can drop it straight into
    a map layer.
    """
    left, right = [], []
    for k in range(samples + 1):
        t = start_s + (end_s - start_s) * (k / samples)
        e = swath_edges(t)
        left.append([e["left"]["lon"], e["left"]["lat"]])
        right.append([e["right"]["lon"], e["right"]["lat"]])
    ring = left + list(reversed(right))
    ring.append(ring[0])
    return ring


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    la1, la2 = math.radians(lat1), math.radians(lat2)
    dla = la2 - la1
    dlo = math.radians(lon2 - lon1)
    a = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R_EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def in_aoi(lat: float, lon: float) -> bool:
    w, s, e, n = AOI["bbox"]
    return s <= lat <= n and w <= lon <= e


def slant_range_km(lat: float, lon: float, target_lat: float, target_lon: float
                   ) -> float:
    """Straight-line range from the spacecraft to a point on the surface."""
    arc = great_circle_km(lat, lon, target_lat, target_lon) / R_EARTH_KM
    return math.sqrt(R_ORBIT_KM ** 2 + R_EARTH_KM ** 2 -
                     2 * R_ORBIT_KM * R_EARTH_KM * math.cos(arc))


def elevation_deg(sat_lat: float, sat_lon: float,
                  gs_lat: float, gs_lon: float) -> float:
    """Elevation angle of the spacecraft as seen from a ground station."""
    arc = great_circle_km(sat_lat, sat_lon, gs_lat, gs_lon) / R_EARTH_KM
    rng = slant_range_km(sat_lat, sat_lon, gs_lat, gs_lon)
    if rng <= 0:
        return 90.0
    cos_el = (R_ORBIT_KM * math.sin(arc)) / rng
    return math.degrees(math.acos(min(1.0, max(-1.0, cos_el))))
