"""Data update coordinator for AirGradient Public Location."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_LOCATION_ID,
    CONF_SCAN_INTERVAL_MINUTES,
    CURRENT_MEASURES_URL,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)


async def async_fetch_current_measures(
    hass: HomeAssistant, location_id: int
) -> dict[str, Any]:
    """Fetch the current measures for a public location.

    Raises aiohttp.ClientResponseError on HTTP errors (404 = unknown location).
    """
    session = async_get_clientsession(hass)
    url = CURRENT_MEASURES_URL.format(location_id=location_id)
    async with session.get(url, timeout=REQUEST_TIMEOUT) as resp:
        resp.raise_for_status()
        return await resp.json()


class AirGradientPublicCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls the AirGradient public world API for one location."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        minutes = entry.options.get(
            CONF_SCAN_INTERVAL_MINUTES, DEFAULT_SCAN_INTERVAL_MINUTES
        )
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}-{entry.data[CONF_LOCATION_ID]}",
            config_entry=entry,
            update_interval=timedelta(minutes=minutes),
        )
        self.location_id: int = entry.data[CONF_LOCATION_ID]

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await async_fetch_current_measures(self.hass, self.location_id)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise UpdateFailed(f"Error fetching AirGradient data: {err}") from err
