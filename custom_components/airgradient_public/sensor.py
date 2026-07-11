"""Sensors for AirGradient Public Location."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
    CONCENTRATION_PARTS_PER_MILLION,
    PERCENTAGE,
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    EntityCategory,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import AirGradientPublicConfigEntry
from .const import DOMAIN, pm25_to_aqi
from .coordinator import AirGradientPublicCoordinator


@dataclass(frozen=True, kw_only=True)
class AirGradientSensorDescription(SensorEntityDescription):
    """Describes an AirGradient public sensor."""

    value_fn: Callable[[dict[str, Any]], Any]
    attrs_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None


def _aqi_value(data: dict[str, Any]) -> int | None:
    pm25 = data.get("pm02")
    if pm25 is None:
        return None
    return pm25_to_aqi(pm25)[0]


def _aqi_attrs(data: dict[str, Any]) -> dict[str, Any]:
    pm25 = data.get("pm02")
    if pm25 is None:
        return {}
    return {"category": pm25_to_aqi(pm25)[1]}


SENSORS: tuple[AirGradientSensorDescription, ...] = (
    AirGradientSensorDescription(
        key="pm02",
        name="PM2.5",
        device_class=SensorDeviceClass.PM25,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("pm02"),
    ),
    AirGradientSensorDescription(
        key="pm01",
        name="PM1",
        device_class=SensorDeviceClass.PM1,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("pm01"),
    ),
    AirGradientSensorDescription(
        key="pm10",
        name="PM10",
        device_class=SensorDeviceClass.PM10,
        native_unit_of_measurement=CONCENTRATION_MICROGRAMS_PER_CUBIC_METER,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("pm10"),
    ),
    AirGradientSensorDescription(
        key="aqi",
        name="Air quality index",
        device_class=SensorDeviceClass.AQI,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_aqi_value,
        attrs_fn=_aqi_attrs,
    ),
    AirGradientSensorDescription(
        key="rco2",
        name="Carbon dioxide",
        device_class=SensorDeviceClass.CO2,
        native_unit_of_measurement=CONCENTRATION_PARTS_PER_MILLION,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("rco2"),
    ),
    AirGradientSensorDescription(
        key="atmp",
        name="Temperature",
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("atmp"),
    ),
    AirGradientSensorDescription(
        key="rhum",
        name="Humidity",
        device_class=SensorDeviceClass.HUMIDITY,
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.get("rhum"),
    ),
    AirGradientSensorDescription(
        key="tvocIndex",
        name="TVOC index",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:molecule",
        value_fn=lambda d: d.get("tvocIndex"),
    ),
    AirGradientSensorDescription(
        key="noxIndex",
        name="NOx index",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:molecule",
        value_fn=lambda d: d.get("noxIndex"),
    ),
    AirGradientSensorDescription(
        key="pm003Count",
        name="PM0.3 count",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:blur",
        entity_registry_enabled_default=False,
        value_fn=lambda d: d.get("pm003Count"),
    ),
    AirGradientSensorDescription(
        key="wifi",
        name="Wi-Fi signal",
        device_class=SensorDeviceClass.SIGNAL_STRENGTH,
        native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda d: d.get("wifi"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: AirGradientPublicConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors for the location."""
    coordinator = entry.runtime_data
    async_add_entities(
        AirGradientPublicSensor(coordinator, description) for description in SENSORS
    )


class AirGradientPublicSensor(
    CoordinatorEntity[AirGradientPublicCoordinator], SensorEntity
):
    """A single measure from the public location."""

    _attr_has_entity_name = True
    _attr_attribution = "Data provided by AirGradient (CC BY-SA 4.0)"
    entity_description: AirGradientSensorDescription

    def __init__(
        self,
        coordinator: AirGradientPublicCoordinator,
        description: AirGradientSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.location_id}-{description.key}"
        data = coordinator.data or {}
        name = (
            data.get("publicLocationName")
            or data.get("locationName")
            or f"AirGradient {coordinator.location_id}"
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, str(coordinator.location_id))},
            name=name,
            manufacturer="AirGradient",
            model=data.get("model"),
            configuration_url=(
                f"https://www.airgradient.com/map?loc={coordinator.location_id}"
            ),
        )

    @property
    def available(self) -> bool:
        return super().available and not (self.coordinator.data or {}).get(
            "offline", False
        )

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data or {})

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.entity_description.attrs_fn is None:
            return None
        return self.entity_description.attrs_fn(self.coordinator.data or {})
