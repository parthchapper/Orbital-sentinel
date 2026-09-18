"""
Mission state assembly.

One pure function, `snapshot(slider)`, turns a timeline-slider position in
[0, 1] into the complete state of the spacecraft at that instant. Every
consumer — REST, WebSocket telemetry, the 3D globe — reads from this one
object, so nothing in the system can disagree with anything else.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from . import geo, power, science
from .config import (AOI, DESAL_PLANTS, GROUND_STATIONS, LOOP_DURATION_S,
                     MODES, SPACECRAFT, TIMELINE_SEGMENTS)
from .desalination import schedule

EPOCH = datetime(2026, 9, 17, 6, 30, 0, tzinfo=timezone.utc)
MIN_ELEVATION_DEG = 10.0     # link acquisition threshold


# ---------------------------------------------------------------------------
# Slider <-> loop time
# ---------------------------------------------------------------------------
def slider_to_loop_t(slider: float) -> float:
    return max(0.0, min(1.0, float(slider))) * LOOP_DURATION_S


def loop_t_to_slider(loop_t: float) -> float:
    return round((loop_t % LOOP_DURATION_S) / LOOP_DURATION_S, 6)


def mode_to_slider(mode: str) -> float:
    """Slider position at the centre of a mode's segment — used when a UI
    clicks a mode button instead of dragging the slider."""
    for seg in TIMELINE_SEGMENTS:
        if seg["mode"] == mode:
            return loop_t_to_slider((seg["start_s"] + seg["end_s"]) / 2.0)
    raise ValueError(f"unknown mode: {mode}")


def segment_progress(loop_t: float) -> float:
    seg = power.segment_for(loop_t)
    span = seg["end_s"] - seg["start_s"]
    return round(((loop_t % LOOP_DURATION_S) - seg["start_s"]) / span, 4)


# ---------------------------------------------------------------------------
# Subsystems
# ---------------------------------------------------------------------------
def attitude(loop_t: float, mode: str) -> Dict:
    """Commanded pointing per mode, with a small deterministic jitter."""
    j = math.sin(loop_t * 1.7) * 0.012, math.cos(loop_t * 2.3) * 0.011
    if mode == "ECLIPSE":
        base = {"mode": "NADIR_HOLD", "roll": 0.0, "pitch": 0.0, "yaw": 0.0,
                "target": "NADIR"}
    elif mode == "SUN_FACING":
        base = {"mode": "SUN_POINT", "roll": -14.2, "pitch": 3.1, "yaw": 21.7,
                "target": "SUN_VECTOR"}
    else:
        p = geo.subsatellite_point(loop_t)
        off = geo.great_circle_km(p["lat"], p["lon"], AOI["center"]["lat"],
                                 AOI["center"]["lon"])
        base = {"mode": "TARGET_TRACK",
                "roll": round(max(-32.0, min(32.0, off / 18.0)), 2),
                "pitch": -1.4, "yaw": 0.6, "target": AOI["id"]}
    return {
        **base,
        "roll_deg": round(base["roll"] + j[0], 3),
        "pitch_deg": round(base["pitch"] + j[1], 3),
        "yaw_deg": round(base["yaw"] + j[0] * 0.5, 3),
        "rate_deg_s": round(0.004 + abs(j[0]) * 2.1, 4),
        "adcs_lock": mode != "SUN_FACING" or True,
        "star_tracker": "LOCK (14 stars)" if mode != "ECLIPSE" else "LOCK (9 stars)",
    }


def comms(loop_t: float, mode: str) -> Dict:
    p = geo.subsatellite_point(loop_t)
    links = []
    for gs in GROUND_STATIONS:
        el = geo.elevation_deg(p["lat"], p["lon"], gs["lat"], gs["lon"])
        rng = geo.slant_range_km(p["lat"], p["lon"], gs["lat"], gs["lon"])
        visible = el >= MIN_ELEVATION_DEG
        links.append({
            "station_id": gs["id"], "name": gs["name"], "band": gs["band"],
            "elevation_deg": round(el, 2), "slant_range_km": round(rng, 1),
            "visible": visible,
            "rate_mbps": round(gs["rate_mbps"] * min(1.0, el / 60.0), 1) if visible else 0.0,
        })

    active = max(links, key=lambda l: l["rate_mbps"])
    downlinking = mode == "ACTIVE" and active["rate_mbps"] > 0

    # Solid-state recorder: fills while imaging, empties over a pass.
    seg_p = segment_progress(loop_t)
    if mode == "ACTIVE":
        fill = 22.0 + 54.0 * seg_p - (28.0 * seg_p if downlinking else 0.0)
    elif mode == "SUN_FACING":
        fill = 22.0 - 8.0 * seg_p
    else:
        fill = 14.0 + 8.0 * seg_p

    return {
        "links": links,
        "active_link": active["station_id"] if downlinking else None,
        "state": "DOWNLINK ACTIVE" if downlinking else (
            "BEACON ONLY" if mode == "ECLIPSE" else "STANDBY"),
        "downlink": {
            "live": downlinking,
            "rate_mbps": active["rate_mbps"] if downlinking else 0.0,
            "modulation": "8PSK 3/4 LDPC" if downlinking else None,
            "ber": 1.8e-9 if downlinking else None,
            "eb_n0_db": round(9.4 + active["elevation_deg"] / 30.0, 2) if downlinking else None,
        },
        "recorder": {
            "fill_pct": round(max(0.0, min(100.0, fill)), 1),
            "capacity_gb": 256,
        },
    }


def thermal(loop_t: float, mode: str) -> Dict:
    seg_p = segment_progress(loop_t)
    if mode == "ECLIPSE":
        bus = 8.4 - 6.1 * seg_p
        det = -38.0 - 4.5 * seg_p
    elif mode == "SUN_FACING":
        bus = 2.3 + 9.4 * seg_p
        det = -42.5 + 3.0 * seg_p
    else:
        bus = 11.7 + 5.2 * seg_p
        det = -39.5 + 6.8 * seg_p
    return {
        "bus_c": round(bus, 2),
        "battery_c": round(bus * 0.7 + 4.0, 2),
        "detector_c": round(det, 2),
        "detector_setpoint_c": -40.0,
        "tec_duty_pct": round(max(0.0, min(100.0, (det + 40.0) * 22.0 + 30.0)), 1),
        "radiator_c": round(bus - 21.0, 2),
    }


def payload_state(loop_t: float, mode: str) -> Dict:
    seg = power.segment_for(loop_t)
    seg_p = segment_progress(loop_t)
    imaging = mode == "ACTIVE"
    return {
        "instrument": SPACECRAFT["payload"]["name"],
        "state": seg["payload_state"],
        "enabled": seg["payload_state"] != "DISABLED",
        "imaging": imaging,
        "shutter": "OPEN" if imaging else "CLOSED",
        "integration_ms": 42.0 if imaging else None,
        "bands_active": SPACECRAFT["payload"]["bands"] if imaging else 0,
        "gsd_m": SPACECRAFT["payload"]["gsd_m"],
        "swath_km": SPACECRAFT["payload"]["swath_km"],
        "frames_captured": int(1240 * seg_p) if imaging else 0,
        "scan_progress": round(seg_p, 4) if imaging else 0.0,
    }


def map_geometry(loop_t: float, mode: str) -> Dict:
    """
    Everything the 3D globe needs. Pure geometry — no rendering decisions,
    so the same payload drives the three.js module, a 2D SVG map, or any
    other view.
    """
    p = geo.subsatellite_point(loop_t)
    edges = geo.swath_edges(loop_t)
    seg = power.segment_for(loop_t)

    swath: Optional[Dict] = None
    if mode == "ACTIVE":
        swath = {
            "type": "Feature",
            "properties": {"aoi": AOI["id"], "instrument": SPACECRAFT["payload"]["name"]},
            "geometry": {
                "type": "Polygon",
                "coordinates": [geo.swath_polygon(seg["start_s"], loop_t)],
            },
        }

    return {
        "subsatellite": {"lat": round(p["lat"], 5), "lon": round(p["lon"], 5),
                         "alt_km": p["alt_km"]},
        "heading_deg": round(geo.heading_deg(loop_t), 2),
        "ground_speed_kms": round(geo.ground_speed_kms(), 4),
        "orbital_velocity_kms": round(geo.orbital_velocity_kms(), 4),
        "scan_line": edges,
        "swath_half_width_km": SPACECRAFT["payload"]["swath_km"] / 2.0,
        "swath_covered": swath,
        "ground_track": geo.ground_track(samples=180),
        # Clamp, never wrap: a look-ahead that runs past the end of the loop
        # would jump back to the start of the orbit and draw a line straight
        # across the planet.
        "track_ahead": geo.ground_track(
            samples=40,
            span_s=min(45.0, LOOP_DURATION_S - loop_t),
            start_s=loop_t,
        ),
        "aoi": {
            "id": AOI["id"], "name": AOI["name"], "bbox": AOI["bbox"],
            "center": AOI["center"],
            "over_aoi": geo.in_aoi(p["lat"], p["lon"]),
            "range_to_center_km": round(
                geo.great_circle_km(p["lat"], p["lon"],
                                    AOI["center"]["lat"], AOI["center"]["lon"]), 1),
        },
        "markers": [
            {"id": d["id"], "name": d["name"], "lat": d["lat"], "lon": d["lon"],
             "kind": "DESALINATION"} for d in DESAL_PLANTS
        ] + [
            {"id": g["id"], "name": g["name"], "lat": g["lat"], "lon": g["lon"],
             "kind": "GROUND_STATION"} for g in GROUND_STATIONS
        ],
    }


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------
def snapshot(slider: float, include_schedule: bool = True,
             include_track: bool = True) -> Dict:
    loop_t = slider_to_loop_t(slider)
    seg = power.segment_for(loop_t)
    mode = seg["mode"]

    orbit_t = geo.orbit_seconds(loop_t)
    sim_time = EPOCH + timedelta(seconds=orbit_t)
    p = geo.subsatellite_point(loop_t)

    state: Dict = {
        "schema": "orbital-sentinel/state@1",
        "spacecraft": {
            "name": SPACECRAFT["name"], "norad_id": SPACECRAFT["norad_id"],
            "bus": SPACECRAFT["bus"],
        },
        "clock": {
            "slider": round(max(0.0, min(1.0, slider)), 6),
            "loop_t_s": round(loop_t, 3),
            "loop_duration_s": LOOP_DURATION_S,
            "mission_time_utc": sim_time.isoformat(),
            "orbit_elapsed_s": round(orbit_t, 1),
            "time_compression": round(geo.time_compression(loop_t), 2),
            "time_compression_note": "Orbit seconds per loop second in this "
                                     "segment; the UAE pass runs near real time.",
            "orbit_number": 4127,
        },
        "mode": {
            "id": mode,
            "label": seg["label"],
            "banner": seg["banner"],
            "description": seg["description"],
            "segment": {"start_s": seg["start_s"], "end_s": seg["end_s"]},
            "progress": segment_progress(loop_t),
            "all_modes": MODES,
            "ui_flags": {
                "dim_ui": mode == "ECLIPSE",
                "payload_disabled": mode == "ECLIPSE",
                "show_solar_gauges": mode in ("SUN_FACING", "ACTIVE"),
                "show_map": mode == "ACTIVE",
                "show_spectroscopy": mode == "ACTIVE",
                "show_downlink": mode == "ACTIVE",
                "flash_banner": mode == "ACTIVE",
            },
        },
        "orbit": {
            **SPACECRAFT["orbit"],
            "subsatellite": {"lat": round(p["lat"], 5), "lon": round(p["lon"], 5)},
            "altitude_km": p["alt_km"],
            "argument_of_latitude_deg": round(geo.argument_of_latitude(loop_t), 3),
            "eclipsed": mode == "ECLIPSE",
        },
        "power": power.power_state(loop_t),
        "attitude": attitude(loop_t, mode),
        "thermal": thermal(loop_t, mode),
        "payload": payload_state(loop_t, mode),
        "comms": comms(loop_t, mode),
        "map": map_geometry(loop_t, mode) if include_track else None,
    }

    if mode == "ACTIVE":
        state["science"] = science.spectrum(p["lat"], p["lon"], phase=loop_t)
        state["science"]["water_quality"] = science.plant_water_quality(loop_t)
    else:
        state["science"] = None

    if include_schedule:
        state["desalination"] = schedule(mode, loop_t)

    state["alerts"] = alerts(state)
    return state


def alerts(state: Dict) -> List[Dict]:
    out: List[Dict] = []
    b = state["power"]["battery"]
    if b["violated"]:
        out.append({"level": "CRITICAL", "code": "EPS-01",
                    "text": f"Battery below flight-rule floor ({b['soc_pct']} %)."})
    elif b["margin_to_floor_pct"] < 12:
        out.append({"level": "WARNING", "code": "EPS-02",
                    "text": f"Battery margin {b['margin_to_floor_pct']} % to floor."})
    if state["mode"]["id"] == "ECLIPSE":
        out.append({"level": "INFO", "code": "OPS-10",
                    "text": "Payload inhibited: eclipse power-saving profile."})
    if state["comms"]["recorder"]["fill_pct"] > 70:
        out.append({"level": "WARNING", "code": "CDH-04",
                    "text": "Solid-state recorder above 70 % — schedule a dump."})
    sci = state.get("science")
    if sci and sci["indices"]["bloom_index"] > 0.6:
        out.append({"level": "WARNING", "code": "SCI-21",
                    "text": f"Bloom {sci['indices']['severity']}: "
                            f"Chl-a {sci['indices']['chl_a_mg_m3']} mg/m3 at nadir."})
    for p in state.get("desalination", {}).get("plants", []):
        if p["now"]["action"] == "HOLD":
            out.append({"level": "CRITICAL", "code": "DSL-30",
                        "text": f"{p['name']}: suspend intake ({p['now']['score']}/100)."})
    return out
