import { buildDeviceStateDefs } from "../capability-mapper";
import type { DeviceManager } from "../device-manager";
import { getDeviceTier } from "../device-registry";
import type { LocalSnapshotStore } from "../local-snapshots";
import type { StateManager } from "../state-manager";
import { errMessage, type DeviceState, type GoveeDevice } from "../types";
import * as connectionState from "./connection-state";
import * as groupFanoutHandler from "./group-fanout-handler";
import * as groupStateHelpers from "./group-state-helpers";

/**
 * Adapter surface required by the device-event helpers — covers the
 * onDeviceStateUpdate + onDeviceListChanged + refreshDeviceStates path.
 *
 * Composes ConnectionStateAdapter (for updateConnectionState) plus
 * GroupFanoutHandlerAdapter and GroupStateHelpersAdapter via duck-typing
 * — the calling adapter implements all three sets implicitly.
 */
export interface DeviceEventsAdapter {
  readonly log: ioBroker.Logger;
  readonly namespace: string;
  readonly deviceManager: DeviceManager | null;
  readonly stateManager: StateManager | null;
  readonly localSnapshots: LocalSnapshotStore | null;
  readonly statesReady: boolean;
  readonly stateCreationQueue: Promise<void>[];
  /** Re-fired into stateManager + connection-state + groupFanout-reachability. */
  setStateAsync(id: string, state: ioBroker.SettableState | ioBroker.StateValue): Promise<unknown>;
  /** Optional reapStaleDevices delegate — owned by main.ts because it touches diagnosticsLastRun. */
  reapStaleDevices?(): Promise<void>;
}

/**
 * Called by device-manager when a device's per-state values change. Mirrors
 * the updates into stateManager, refreshes the global connection-state
 * indicator, updates group reachability, and resets all mode dropdowns
 * when the device just powered off (the user shouldn't see "playing
 * Aurora-A" on a device that's off).
 *
 * @param adapter
 * @param device
 * @param state
 */
export function onDeviceStateUpdate<
  T extends DeviceEventsAdapter &
    connectionState.ConnectionStateAdapter &
    groupFanoutHandler.GroupFanoutHandlerAdapter &
    groupStateHelpers.GroupStateHelpersAdapter,
>(adapter: T, device: GoveeDevice, state: Partial<DeviceState>): void {
  if (adapter.stateManager) {
    adapter.stateManager.updateDeviceState(device, state).catch(() => {});
  }
  connectionState.updateConnectionState(adapter);

  if (state.online !== undefined) {
    groupFanoutHandler.updateGroupReachability(adapter);
  }

  // Mirror power-off to mode-dropdown reset. Covers MQTT/LAN-initiated
  // power changes (Govee app or physical remote) so the UI stays honest:
  // a device that's off can't be "playing Aurora-A" anymore.
  // L11 — defensive auch 0 als false akzeptieren (Govee schickt Power
  // theoretisch als boolean, aber MQTT-Boundary könnte 0 durchschleusen).
  const powerOff = state.power === false || (state.power as unknown) === 0;
  if (powerOff && adapter.stateManager) {
    const prefix = adapter.stateManager.devicePrefix(device);
    groupStateHelpers.resetModeDropdowns(adapter, prefix, "").catch(() => undefined);
  }
}

/**
 * Rebuild state definitions for one device and feed them into StateManager.
 * Used both from the full-list callback and from targeted refreshes (e.g.
 * after a local snapshot was added or removed — no reason to rebuild the
 * entire tree for every device then).
 *
 * @param adapter
 * @param device
 * @param allDevices
 */
export function refreshDeviceStates(
  adapter: DeviceEventsAdapter,
  device: GoveeDevice,
  allDevices: GoveeDevice[],
): void {
  if (!adapter.stateManager) {
    return;
  }
  const localSnaps = adapter.localSnapshots?.getSnapshots(device.sku, device.deviceId);
  let memberDevices: GoveeDevice[] | undefined;
  if (device.sku === "BaseGroup" && device.groupMembers) {
    memberDevices = groupFanoutHandler.resolveGroupMembers(device, allDevices);
  }
  const stateDefs = buildDeviceStateDefs(device, localSnaps, memberDevices);
  const p = adapter.stateManager
    .createDeviceStates(device, stateDefs)
    .then(async () => {
      await adapter.stateManager?.migrateLegacyDiagnostics(device);
      await adapter.stateManager?.updateDeviceTier(device, getDeviceTier(device.sku));
    })
    .catch(e => {
      adapter.log.error(`createDeviceStates failed for ${device.name}: ${errMessage(e)}`);
    });
  // Until ready, collect so onReady can await the whole initial batch.
  // After ready, fire-and-forget — the queue would otherwise keep growing
  // with resolved promises for the lifetime of the adapter.
  if (!adapter.statesReady) {
    adapter.stateCreationQueue.push(p);
  } else {
    void p;
  }
}

/**
 * Called by device-manager when the device list changes. Triggers a
 * full state-tree rebuild for every device, refreshes connection state,
 * and reaps adapter-level maps for removed devices once the initial
 * boot phase has passed.
 *
 * @param adapter
 * @param devices
 */
export function onDeviceListChanged<T extends DeviceEventsAdapter & connectionState.ConnectionStateAdapter>(
  adapter: T,
  devices: GoveeDevice[],
): void {
  if (!adapter.stateManager) {
    return;
  }
  for (const device of devices) {
    refreshDeviceStates(adapter, device, devices);
  }
  connectionState.updateConnectionState(adapter);
  // Cache sync happens once after the initial setup completes (see
  // checkAllReady) — triggering here would fire on every device update.
  if (adapter.statesReady) {
    adapter.reapStaleDevices?.().catch(() => undefined);
  }
}
