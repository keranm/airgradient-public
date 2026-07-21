"""Config flow for AirGradient Public Location."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback

from .const import (
    CONF_LOCATION_ID,
    CONF_SCAN_INTERVAL_MINUTES,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DOMAIN,
    MAX_SCAN_INTERVAL_MINUTES,
    MIN_SCAN_INTERVAL_MINUTES,
)
from .coordinator import async_fetch_current_measures

USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_LOCATION_ID): vol.All(vol.Coerce(int), vol.Range(min=1)),
    }
)


class AirGradientPublicConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow: ask for the public location id and validate it."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            location_id = user_input[CONF_LOCATION_ID]
            await self.async_set_unique_id(str(location_id))
            self._abort_if_unique_id_configured()
            try:
                data = await async_fetch_current_measures(self.hass, location_id)
            except aiohttp.ClientResponseError as err:
                errors["base"] = (
                    "invalid_location" if err.status == 404 else "cannot_connect"
                )
            except (aiohttp.ClientError, asyncio.TimeoutError):
                errors["base"] = "cannot_connect"
            else:
                name = (
                    data.get("publicLocationName")
                    or data.get("locationName")
                    or f"AirGradient {location_id}"
                )
                return self.async_create_entry(
                    title=name, data={CONF_LOCATION_ID: location_id}
                )

        return self.async_show_form(
            step_id="user",
            data_schema=USER_SCHEMA,
            errors=errors,
            description_placeholders={"map_url": "https://www.airgradient.com/map"},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return AirGradientPublicOptionsFlow()


class AirGradientPublicOptionsFlow(OptionsFlow):
    """Options: polling interval."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        current = self.config_entry.options.get(
            CONF_SCAN_INTERVAL_MINUTES, DEFAULT_SCAN_INTERVAL_MINUTES
        )
        schema = vol.Schema(
            {
                vol.Required(CONF_SCAN_INTERVAL_MINUTES, default=current): vol.All(
                    vol.Coerce(int),
                    vol.Range(
                        min=MIN_SCAN_INTERVAL_MINUTES, max=MAX_SCAN_INTERVAL_MINUTES
                    ),
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
