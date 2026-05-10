import type { CachedDeviceData, SkuCache } from "../sku-cache";
import type { GoveeDevice } from "../types";

/**
 * Adapter surface required by the cache helpers — DeviceManager exposes
 * `skuCache`, `devices`, and `log` in this shape.
 */
export interface DeviceCacheAdapter {
  readonly log: ioBroker.Logger;
  readonly skuCache: SkuCache | null;
  readonly devices: Map<string, GoveeDevice>;
}

/**
 * Fill device.scenes from sceneLibrary when Cloud scenes are missing.
 * ptReal activation matches by name, so sceneLibrary names are sufficient.
 *
 * @param adapter DeviceManager-shaped surface
 * @param device Device to populate scenes for
 */
export function populateScenesFromLibrary(adapter: DeviceCacheAdapter, device: GoveeDevice): void {
  if (device.scenes.length === 0 && device.sceneLibrary.length > 0) {
    device.scenes = device.sceneLibrary.map(entry => ({
      name: entry.name,
      value: {}, // ptReal uses sceneLibrary directly, Cloud payload not needed
    }));
    adapter.log.debug(`${device.sku}: ${device.scenes.length} scenes from library (Cloud scenes missing)`);
  }
}

/**
 * Convert cached data to a GoveeDevice (runtime fields set to defaults).
 *
 */
export function cachedToGoveeDevice(cached: CachedDeviceData): GoveeDevice {
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
    channels: { lan: false, mqtt: false, cloud: false },
  };
}

/**
 * Extract cacheable data from a GoveeDevice.
 *
 */
export function goveeDeviceToCached(device: GoveeDevice): CachedDeviceData {
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
    segmentCount: typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : undefined,
    manualMode: device.manualMode ? true : undefined,
    manualSegments:
      device.manualMode && Array.isArray(device.manualSegments) && device.manualSegments.length > 0
        ? device.manualSegments.slice()
        : undefined,
    sceneSpeed: typeof device.sceneSpeed === "number" && device.sceneSpeed > 0 ? device.sceneSpeed : undefined,
    cachedAt: Date.now(),
  };
}

/**
 * Persist a device's current runtime state to the SKU cache. Safe no-op
 * when no cache is configured.
 *
 */
export function persistDeviceToCache(adapter: DeviceCacheAdapter, device: GoveeDevice): void {
  if (!adapter.skuCache) {
    return;
  }
  adapter.skuCache.save(goveeDeviceToCached(device));
}

/**
 * Save all devices to SKU cache, skipping only those never confirmed via
 * Cloud yet. Routine persistence — logs at debug.
 *
 */
export function saveDevicesToCache(adapter: DeviceCacheAdapter): void {
  if (!adapter.skuCache) {
    return;
  }

  let cachedCount = 0;
  let skippedCount = 0;
  for (const device of adapter.devices.values()) {
    const isLight = device.type === "devices.types.light";
    if (isLight && !device.scenesChecked) {
      skippedCount++;
      adapter.log.debug(`Not caching ${device.name} (${device.sku}) — scenes not yet checked`);
    } else {
      adapter.skuCache.save(goveeDeviceToCached(device));
      cachedCount++;
    }
  }
  if (skippedCount > 0) {
    adapter.log.debug(`Cached ${cachedCount} device(s), skipped ${skippedCount} not yet checked`);
  } else {
    adapter.log.debug(`Cached ${cachedCount} device(s) — next start uses cache`);
  }
}
