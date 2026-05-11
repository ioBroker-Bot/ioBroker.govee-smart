import { LAN_STATE_IDS, mapCloudStateValue, planCloudCapabilityWrites } from "../capability-mapper";
import type { DeviceManager } from "../device-manager";
import type { GoveeCloudClient } from "../govee-cloud-client";
import type { StateManager } from "../state-manager";
import type { CloudStateCapability, GoveeDevice } from "../types";

/**
 * Adapter surface required by the cloud-state-loader helpers. Loose
 * `setStateAsync` for utils.Adapter structural matching.
 */
export interface CloudStateLoaderAdapter {
  readonly log: ioBroker.Logger;
  readonly cloudClient: GoveeCloudClient | null;
  readonly deviceManager: DeviceManager | null;
  readonly stateManager: StateManager | null;
  setStateAsync(id: string, state: ioBroker.SettableState | ioBroker.StateValue): Promise<unknown>;
}

/**
 * Load current state for all Cloud devices and populate state values.
 * Called once after initial Cloud device list load.
 *
 * LAN-first: never overwrite LAN states with Cloud values. For
 * LAN-capable devices, the LAN state IDs are filtered out — Cloud only
 * fills the gaps the LAN client doesn't cover.
 *
 */
export async function loadCloudStates(adapter: CloudStateLoaderAdapter): Promise<void> {
  if (!adapter.cloudClient || !adapter.deviceManager || !adapter.stateManager) {
    return;
  }

  const devices = adapter.deviceManager.getDevices();
  let loaded = 0;

  for (const device of devices) {
    if (!device.channels.cloud || device.capabilities.length === 0) {
      continue;
    }

    try {
      const caps = await adapter.cloudClient.getDeviceState(device.sku, device.deviceId);
      const prefix = adapter.stateManager.devicePrefix(device);

      const writes: Promise<unknown>[] = [];
      for (const cap of caps) {
        const mapped = mapCloudStateValue(cap);
        if (!mapped) {
          continue;
        }
        if (device.lanIp && LAN_STATE_IDS.has(mapped.stateId)) {
          continue;
        }
        const statePath = adapter.stateManager.resolveStatePath(prefix, mapped.stateId);
        // Fire-and-forget — States are created before loadCloudStates runs;
        // a rejection here means the state was deleted out-of-band and
        // can be safely ignored.
        writes.push(adapter.setStateAsync(statePath, { val: mapped.value, ack: true }).catch(() => undefined));
      }
      await Promise.all(writes);
      loaded++;
    } catch {
      adapter.log.debug(`Could not load Cloud state for ${device.name} (${device.sku})`);
    }
  }

  if (loaded > 0) {
    adapter.log.debug(`Cloud states loaded for ${loaded} devices`);
  }
}

/**
 * Apply a list of synthesized Cloud-state capabilities to a single device —
 * the App-API poll and OpenAPI-MQTT events both use this path so their
 * values flow through the same `mapCloudStateValue` pipeline that polled
 * Cloud states use.
 *
 * App-API and OpenAPI-MQTT deliver state IDs (battery, temperature,
 * humidity, lackWater, …) that the Cloud-capability pipeline doesn't
 * declare for sensor/appliance SKUs — the state objects therefore don't
 * exist yet on first write. ensureSyntheticStateObject creates them
 * lazily with the right channel + role + unit.
 *
 */
export async function applyCloudCapabilities(
  adapter: CloudStateLoaderAdapter,
  device: GoveeDevice,
  caps: CloudStateCapability[],
): Promise<void> {
  if (!adapter.stateManager) {
    return;
  }
  const prefix = adapter.stateManager.devicePrefix(device);
  const planned = planCloudCapabilityWrites(caps, Boolean(device.lanIp), LAN_STATE_IDS);
  for (const mapped of planned) {
    await adapter.stateManager.ensureSyntheticStateObject(prefix, mapped.stateId);
  }
  const writes = planned.map(mapped => {
    const statePath = adapter.stateManager!.resolveStatePath(prefix, mapped.stateId);
    return adapter.setStateAsync(statePath, { val: mapped.value, ack: true }).catch(() => undefined);
  });
  await Promise.all(writes);
}
