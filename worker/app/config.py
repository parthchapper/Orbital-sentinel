"""
Mission configuration constants for ORBITAL SENTINEL.

Everything the mission model needs to be defensible in an investor Q&A
lives here, with a source note attached to each number.
"""

# ---------------------------------------------------------------------------
# Spacecraft
# ---------------------------------------------------------------------------
SPACECRAFT = {
    "name": "ORBITAL SENTINEL-1",
    "cospar_id": "2026-000A",
    "norad_id": 99001,
    "bus": "6U CubeSat",
    "mass_kg": 12.0,
    # Sun-synchronous, 10:30 local time descending node — the standard
    # ocean-colour orbit (same family as Sentinel-3 / PACE).
    "orbit": {
        "regime": "SSO",
        "altitude_km": 520.0,
        "inclination_deg": 97.49,
        "period_min": 94.9,
        "ltdn": "10:30",
        "repeat_cycle_days": 5,
    },
    "payload": {
        "name": "HYPER-A",
        "type": "Pushbroom hyperspectral imager",
        "spectral_range_nm": [400, 900],
        "bands": 96,
        "spectral_resolution_nm": 5.2,
        "gsd_m": 30.0,
        "swath_km": 180.0,
        "peak_power_w": 22.0,
        "standby_power_w": 3.5,
    },
}

# ---------------------------------------------------------------------------
# Electrical power subsystem (EPS)
# ---------------------------------------------------------------------------
EPS = {
    "battery_capacity_wh": 78.0,
    "battery_min_soc_pct": 30.0,     # flight rule: never discharge below this
    "battery_nominal_v": 16.8,
    "array_area_m2": 0.10,           # 2 x deployable 3U wings, cell area
    "array_efficiency": 0.298,       # triple-junction GaAs, EOL
    "solar_constant_w_m2": 1361.0,
    "bus_housekeeping_w": 6.2,       # OBC + ADCS + thermal, always on
    "radio_tx_w": 9.0,               # X-band downlink during pass
}

# ---------------------------------------------------------------------------
# Scripted demo loop
# ---------------------------------------------------------------------------
# A 180-second cinematic loop. The operational timeline slider scrubs this
# loop; each segment is one operational mode. Deterministic by design so a
# live pitch always hits the UAE pass on cue.
LOOP_DURATION_S = 180.0

TIMELINE_SEGMENTS = [
    {
        "mode": "ECLIPSE",
        "label": "ECLIPSE MODE",
        "start_s": 0.0,
        "end_s": 60.0,
        "banner": "POWER SAVING",
        "payload_state": "DISABLED",
        "description": "Spacecraft in Earth's umbra. Payload powered down, "
                       "battery carries the housekeeping load.",
    },
    {
        "mode": "SUN_FACING",
        "label": "SUN FACING MODE",
        "start_s": 60.0,
        "end_s": 120.0,
        "banner": "ARRAY GENERATION NOMINAL",
        "payload_state": "STANDBY_CHARGING",
        "description": "Sunlit arc. Arrays sun-pointed, battery recharging, "
                       "payload thermally soaking in standby.",
    },
    {
        "mode": "ACTIVE",
        "label": "ACTIVE MODE",
        "start_s": 120.0,
        "end_s": 180.0,
        "banner": "TARGET ACQUIRED",
        "payload_state": "IMAGING",
        "description": "UAE coastal pass. Payload imaging, spectrometer "
                       "streaming, X-band downlink live.",
    },
]

MODES = [s["mode"] for s in TIMELINE_SEGMENTS]

# ---------------------------------------------------------------------------
# Ground segment / targets
# ---------------------------------------------------------------------------
# Desalination plants. Capacities are public design figures (MIGD =
# million imperial gallons per day).
DESAL_PLANTS = [
    {
        "id": "JEBEL_ALI",
        "name": "Jebel Ali Desalination Complex",
        "operator": "DEWA",
        "lat": 25.0000,
        "lon": 55.0600,
        "sea": "Arabian Gulf",
        "capacity_migd": 470,
        "intake_depth_m": 6.0,
        # The Arabian Gulf is shallow, warm and hypersaline — bloom-prone.
        "baseline_bloom_risk": 0.62,
        "intake_type": "Open surface intake",
    },
    {
        "id": "FUJAIRAH",
        "name": "Fujairah F1 / F2 Desalination Complex",
        "operator": "EWEC",
        "lat": 25.1100,
        "lon": 56.3500,
        "sea": "Gulf of Oman",
        "capacity_migd": 230,
        "intake_depth_m": 10.0,
        # Deeper, cooler, better flushed — but hit by the 2008-09 Cochlodinium
        # bloom that shut the plant down. Lower baseline, higher tail risk.
        "baseline_bloom_risk": 0.38,
        "intake_type": "Deep open intake",
    },
]

GROUND_STATIONS = [
    {"id": "DXB_GS", "name": "Dubai Primary", "lat": 25.2048, "lon": 55.2708,
     "band": "X", "rate_mbps": 120},
    {"id": "SVL_GS", "name": "Svalbard Polar", "lat": 78.2290, "lon": 15.4070,
     "band": "X", "rate_mbps": 310},
]

# Area of interest: UAE coastal waters bounding box.
AOI = {
    "id": "UAE_COASTAL",
    "name": "UAE Coastal Waters",
    # [W, S, E, N] — UAE coastal waters plus the southern approach the
    # swath crosses on the way in.
    "bbox": [51.0, 22.0, 57.2, 26.8],
    "center": {"lat": 24.6, "lon": 54.2},
}

# ---------------------------------------------------------------------------
# Spectroscopy
# ---------------------------------------------------------------------------
SPECTRO = {
    "lambda_min_nm": 400.0,
    "lambda_max_nm": 900.0,
    "bands": 96,
    # Diagnostic features the graph is meant to show, each with a reason.
    "features": [
        {"nm": 443, "name": "Chl-a Soret absorption", "kind": "absorption"},
        {"nm": 490, "name": "Blue reference", "kind": "reference"},
        {"nm": 555, "name": "Green reflectance peak", "kind": "peak"},
        {"nm": 620, "name": "Phycocyanin absorption", "kind": "absorption"},
        {"nm": 665, "name": "Chl-a red absorption", "kind": "absorption"},
        {"nm": 681, "name": "Sun-induced fluorescence", "kind": "peak"},
        {"nm": 709, "name": "NIR red-edge peak", "kind": "peak"},
        {"nm": 754, "name": "NIR reference", "kind": "reference"},
    ],
}
