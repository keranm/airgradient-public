"""The AirGradient Public Location integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CARD_URL_PATH, DOMAIN
from .coordinator import AirGradientPublicCoordinator

PLATFORMS = [Platform.SENSOR]

# This integration has no YAML configuration — it is set up from config entries
# (async_setup only serves the bundled Lovelace card).
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

AirGradientPublicConfigEntry = ConfigEntry[AirGradientPublicCoordinator]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the bundled Lovelace card and load it on every dashboard."""
    card_path = Path(__file__).parent / "www" / "airgradient-map-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_PATH, str(card_path), cache_headers=False)]
    )
    add_extra_js_url(hass, CARD_URL_PATH)
    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: AirGradientPublicConfigEntry
) -> bool:
    """Set up a public location from a config entry."""
    coordinator = AirGradientPublicCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: AirGradientPublicConfigEntry
) -> None:
    """Reload the entry when options (poll interval) change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(
    hass: HomeAssistant, entry: AirGradientPublicConfigEntry
) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
