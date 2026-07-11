"""Constants for the AirGradient Public Location integration."""

from __future__ import annotations

DOMAIN = "airgradient_public"

API_BASE = "https://api.airgradient.com/public/api/v1"
CURRENT_MEASURES_URL = API_BASE + "/world/locations/{location_id}/measures/current"

CONF_LOCATION_ID = "location_id"
CONF_SCAN_INTERVAL_MINUTES = "scan_interval_minutes"

DEFAULT_SCAN_INTERVAL_MINUTES = 3
MIN_SCAN_INTERVAL_MINUTES = 1
MAX_SCAN_INTERVAL_MINUTES = 60

CARD_URL_PATH = "/airgradient_public_files/airgradient-map-card.js"

# US EPA PM2.5 AQI breakpoints (May 2024 revision).
# (conc_low, conc_high, aqi_low, aqi_high, category)
PM25_AQI_BREAKPOINTS: list[tuple[float, float, int, int, str]] = [
    (0.0, 9.0, 0, 50, "good"),
    (9.1, 35.4, 51, 100, "moderate"),
    (35.5, 55.4, 101, 150, "unhealthy_sensitive"),
    (55.5, 125.4, 151, 200, "unhealthy"),
    (125.5, 225.4, 201, 300, "very_unhealthy"),
    (225.5, 500.4, 301, 500, "hazardous"),
]


def pm25_to_aqi(pm25: float) -> tuple[int, str]:
    """Convert a PM2.5 concentration (µg/m³) to US AQI and category."""
    conc = max(0.0, round(pm25, 1))
    for c_lo, c_hi, a_lo, a_hi, category in PM25_AQI_BREAKPOINTS:
        if conc <= c_hi:
            aqi = (a_hi - a_lo) / (c_hi - c_lo) * (conc - c_lo) + a_lo
            return round(aqi), category
    return 500, "hazardous"
