# AirGradient Public Location for Home Assistant

Follow any **public sensor from the [AirGradient map](https://www.airgradient.com/map)** in
Home Assistant — no account or API token needed — and show it on your dashboard with an
animated, AirGradient-map-style card.

One HACS install gives you both parts:

- **Integration** (`airgradient_public`) — polls the AirGradient public API for a location
  and creates sensors: PM2.5, PM10, PM1, US AQI (computed), CO₂, temperature, humidity,
  TVOC index, NOx index (+ optional PM0.3 count and Wi-Fi signal diagnostics).
- **Lovelace card** (`custom:airgradient-map-card`) — bundled and auto-registered, no
  separate resource setup. A compact animated scene whose colours and mascot mood follow
  the US EPA PM2.5 category; tap it to expand into the full view with a 24-hour chart,
  12 h / 24 h averages, WHO annual-guideline comparison, cigarette equivalent, and a
  10-days-by-hour heatmap.

## Installation

### HACS (recommended)

1. HACS → three-dot menu → **Custom repositories** → add this repository URL,
   category **Integration**.
2. Install **AirGradient Public Location**, restart Home Assistant.

### Manual

Copy `custom_components/airgradient_public` into your `config/custom_components/`
folder and restart.

## Setup

1. **Settings → Devices & Services → Add Integration → AirGradient Public Location.**
2. Enter the **location ID** of the public sensor you want to follow.

   To find it: open the sensor on the [AirGradient map](https://www.airgradient.com/map),
   then check the API URL
   `https://api.airgradient.com/public/api/v1/world/locations/<ID>/measures/current` —
   or fetch `.../world/locations/measures/current` (all public sensors) and search for the
   sensor's name. Note: the `loc=` parameter in the map page URL is **not** the location ID.
3. Add the card to a dashboard:

```yaml
type: custom:airgradient-map-card
entity: sensor.<location_name>_pm2_5
```

The card finds the temperature/humidity/CO₂ sensors from the same device automatically
(override with `temperature:`, `humidity:`, `co2:` if you want different ones), and it is
also available in the visual card picker.

## How the history charts work

AirGradient's public API only serves *current* values for locations you don't own, so the
card builds its charts from **Home Assistant's own recorder statistics**. Charts start
empty and fill in as data accumulates: the 24-hour chart after a few hours, the 10-day
heatmap and the 30-day WHO / cigarette figures over the following days. (When you own the
sensor, an AirGradient API token could unlock server-side history — future enhancement.)

The cigarette equivalent uses the Berkeley Earth rule of thumb: a day breathing
22 µg/m³ of PM2.5 ≈ one cigarette. The WHO comparison uses the 2021 annual guideline of
5 µg/m³. AQI categories use the US EPA May-2024 PM2.5 breakpoints.

## Options

- **Update interval** (default 3 min): Settings → Devices & Services →
  AirGradient Public Location → Configure.

## Attribution

Air quality data is provided by [AirGradient](https://www.airgradient.com/) under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This project is not
affiliated with AirGradient; the card artwork is original.
