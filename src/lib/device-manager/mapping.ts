import type { AppDeviceEntry } from "../govee-api-client";
import type { CloudDevice, CloudStateCapability, GoveeDevice } from "../types";

/** Convert Cloud device to internal device model. */
export function cloudDeviceToGoveeDevice(cd: CloudDevice): GoveeDevice {
  return {
    sku: cd.sku,
    deviceId: cd.device,
    name: cd.deviceName || cd.sku,
    type: cd.type || "unknown",
    capabilities: Array.isArray(cd.capabilities) ? cd.capabilities : [],
    scenes: [],
    diyScenes: [],
    snapshots: [],
    sceneLibrary: [],
    musicLibrary: [],
    diyLibrary: [],
    skuFeatures: null,
    state: { online: true },
    channels: { lan: false, mqtt: false, cloud: true },
  };
}

/**
 * Convert an AppApi device entry into a synthetic capability list — the
 * App API doesn't expose capability metadata, but the user wants the same
 * `info.online` / `sensorTemperature` / `sensorHumidity` / `battery`
 * states regardless of which channel delivered the data.
 *
 * Used to bridge App-API events into the same per-device state-tree shape
 * that Cloud-driven devices produce.
 *
 * @param entry App-API device entry from the recent-data endpoint
 */
export function buildCapabilitiesFromAppEntry(entry: AppDeviceEntry): CloudStateCapability[] {
  const caps: CloudStateCapability[] = [];
  const last = entry.lastData;
  if (!last) {
    return caps;
  }
  if (typeof last.online === "boolean") {
    caps.push({
      type: "devices.capabilities.online",
      instance: "online",
      state: { value: last.online },
    });
  }
  if (typeof last.tem === "number" && Number.isFinite(last.tem)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "sensorTemperature",
      state: { value: last.tem / 100 },
    });
  }
  if (typeof last.hum === "number" && Number.isFinite(last.hum)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "sensorHumidity",
      state: { value: last.hum / 100 },
    });
  }
  if (typeof last.battery === "number" && Number.isFinite(last.battery)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "battery",
      state: { value: last.battery },
    });
  } else if (entry.settings && typeof entry.settings.battery === "number" && Number.isFinite(entry.settings.battery)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "battery",
      state: { value: entry.settings.battery },
    });
  }
  return caps;
}
