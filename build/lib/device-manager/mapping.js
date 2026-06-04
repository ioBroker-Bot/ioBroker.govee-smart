"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var mapping_exports = {};
__export(mapping_exports, {
  buildCapabilitiesFromAppEntry: () => buildCapabilitiesFromAppEntry,
  cloudDeviceToGoveeDevice: () => cloudDeviceToGoveeDevice,
  filterCloudDevicesWithCapabilities: () => filterCloudDevicesWithCapabilities
});
module.exports = __toCommonJS(mapping_exports);
var import_govee_constants = require("../govee-constants");
function cloudDeviceToGoveeDevice(cd) {
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
    channels: { lan: false, mqtt: false, cloud: true }
  };
}
function filterCloudDevicesWithCapabilities(raw) {
  return Array.isArray(raw) ? raw.filter(
    (cd) => cd && typeof cd.sku === "string" && typeof cd.device === "string" && Array.isArray(cd.capabilities) && cd.capabilities.length > 0
  ) : [];
}
function buildCapabilitiesFromAppEntry(entry) {
  const caps = [];
  const last = entry.lastData;
  if (!last) {
    return caps;
  }
  if (typeof last.online === "boolean") {
    caps.push({
      type: import_govee_constants.GOVEE_CAP_TYPE.ONLINE,
      instance: "online",
      state: { value: last.online }
    });
  }
  if (typeof last.tem === "number" && Number.isFinite(last.tem)) {
    caps.push({
      type: import_govee_constants.GOVEE_CAP_TYPE.PROPERTY,
      instance: "sensorTemperature",
      state: { value: last.tem / 100 }
    });
  }
  if (typeof last.hum === "number" && Number.isFinite(last.hum)) {
    caps.push({
      type: import_govee_constants.GOVEE_CAP_TYPE.PROPERTY,
      instance: "sensorHumidity",
      state: { value: last.hum / 100 }
    });
  }
  if (typeof last.battery === "number" && Number.isFinite(last.battery)) {
    caps.push({
      type: import_govee_constants.GOVEE_CAP_TYPE.PROPERTY,
      instance: "battery",
      state: { value: last.battery }
    });
  } else if (entry.settings && typeof entry.settings.battery === "number" && Number.isFinite(entry.settings.battery)) {
    caps.push({
      type: import_govee_constants.GOVEE_CAP_TYPE.PROPERTY,
      instance: "battery",
      state: { value: entry.settings.battery }
    });
  }
  return caps;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildCapabilitiesFromAppEntry,
  cloudDeviceToGoveeDevice,
  filterCloudDevicesWithCapabilities
});
//# sourceMappingURL=mapping.js.map
