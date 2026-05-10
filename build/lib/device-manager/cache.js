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
var cache_exports = {};
__export(cache_exports, {
  cachedToGoveeDevice: () => cachedToGoveeDevice,
  goveeDeviceToCached: () => goveeDeviceToCached,
  persistDeviceToCache: () => persistDeviceToCache,
  populateScenesFromLibrary: () => populateScenesFromLibrary,
  saveDevicesToCache: () => saveDevicesToCache
});
module.exports = __toCommonJS(cache_exports);
function populateScenesFromLibrary(adapter, device) {
  if (device.scenes.length === 0 && device.sceneLibrary.length > 0) {
    device.scenes = device.sceneLibrary.map((entry) => ({
      name: entry.name,
      value: {}
      // ptReal uses sceneLibrary directly, Cloud payload not needed
    }));
    adapter.log.debug(`${device.sku}: ${device.scenes.length} scenes from library (Cloud scenes missing)`);
  }
}
function cachedToGoveeDevice(cached) {
  return {
    sku: cached.sku,
    deviceId: cached.deviceId,
    name: cached.name,
    type: cached.type,
    capabilities: cached.capabilities,
    scenes: cached.scenes,
    diyScenes: cached.diyScenes,
    snapshots: cached.snapshots,
    sceneLibrary: cached.sceneLibrary,
    musicLibrary: cached.musicLibrary,
    diyLibrary: cached.diyLibrary,
    skuFeatures: cached.skuFeatures,
    snapshotBleCmds: cached.snapshotBleCmds,
    scenesChecked: cached.scenesChecked,
    lastSeenOnNetwork: cached.lastSeenOnNetwork,
    // Restore learned count so it wins over Cloud capability on next start.
    segmentCount: cached.segmentCount,
    manualMode: cached.manualMode,
    manualSegments: cached.manualSegments,
    sceneSpeed: cached.sceneSpeed,
    state: { online: false },
    channels: { lan: false, mqtt: false, cloud: false }
  };
}
function goveeDeviceToCached(device) {
  return {
    sku: device.sku,
    deviceId: device.deviceId,
    name: device.name,
    type: device.type,
    capabilities: device.capabilities,
    scenes: device.scenes,
    diyScenes: device.diyScenes,
    snapshots: device.snapshots,
    sceneLibrary: device.sceneLibrary,
    musicLibrary: device.musicLibrary,
    diyLibrary: device.diyLibrary,
    skuFeatures: device.skuFeatures,
    snapshotBleCmds: device.snapshotBleCmds,
    scenesChecked: device.scenesChecked,
    lastSeenOnNetwork: device.lastSeenOnNetwork,
    segmentCount: typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : void 0,
    manualMode: device.manualMode ? true : void 0,
    manualSegments: device.manualMode && Array.isArray(device.manualSegments) && device.manualSegments.length > 0 ? device.manualSegments.slice() : void 0,
    sceneSpeed: typeof device.sceneSpeed === "number" && device.sceneSpeed > 0 ? device.sceneSpeed : void 0,
    cachedAt: Date.now()
  };
}
function persistDeviceToCache(adapter, device) {
  if (!adapter.skuCache) {
    return;
  }
  adapter.skuCache.save(goveeDeviceToCached(device));
}
function saveDevicesToCache(adapter) {
  if (!adapter.skuCache) {
    return;
  }
  let cachedCount = 0;
  let skippedCount = 0;
  for (const device of adapter.devices.values()) {
    const isLight = device.type === "devices.types.light";
    if (isLight && !device.scenesChecked) {
      skippedCount++;
      adapter.log.debug(`Not caching ${device.name} (${device.sku}) \u2014 scenes not yet checked`);
    } else {
      adapter.skuCache.save(goveeDeviceToCached(device));
      cachedCount++;
    }
  }
  if (skippedCount > 0) {
    adapter.log.debug(`Cached ${cachedCount} device(s), skipped ${skippedCount} not yet checked`);
  } else {
    adapter.log.debug(`Cached ${cachedCount} device(s) \u2014 next start uses cache`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cachedToGoveeDevice,
  goveeDeviceToCached,
  persistDeviceToCache,
  populateScenesFromLibrary,
  saveDevicesToCache
});
//# sourceMappingURL=cache.js.map
