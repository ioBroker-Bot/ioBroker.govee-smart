import { CloudRetryLoop, type CloudRetryHost } from "../cloud-retry";
import type { DeviceManager } from "../device-manager";
import type { GoveeCloudClient } from "../govee-cloud-client";
import type { StateManager } from "../state-manager";
import { errMessage, type CloudLoadResult } from "../types";
import { READY_TIMEOUT_MS } from "../timing-constants";

/**
 * Adapter surface required by the cloud-retry handler. Mutates several
 * adapter fields so they need to be writable from outside.
 */
export interface CloudRetryHandlerAdapter {
  readonly log: ioBroker.Logger;
  readonly deviceManager: DeviceManager | null;
  readonly cloudClient: GoveeCloudClient | null;
  readonly stateManager: StateManager | null;
  cloudInitTimer: ioBroker.Timeout | undefined;
  cloudRetry: CloudRetryLoop | undefined;
  cloudWasConnected: boolean;
  setStateAsync(id: string, state: ioBroker.SettableState | ioBroker.StateValue): Promise<unknown>;
  setTimeout(cb: () => void, ms: number): ioBroker.Timeout | undefined;
  clearTimeout(h: ioBroker.Timeout): void;
  /** Reload Cloud-state-tree after a recovered connection. */
  loadCloudStates(): Promise<void>;
}

/**
 * Initial Cloud-Load mit 60-Sekunden-Hardtimeout. Blockiert nicht länger —
 * wenn Cloud hängt, geht Adapter mit LAN+MQTT weiter, und der Retry-Loop
 * probiert's passend zum Fehlergrund erneut.
 *
 * @param adapter
 */
export async function cloudInitWithTimeout(adapter: CloudRetryHandlerAdapter): Promise<CloudLoadResult> {
  if (!adapter.deviceManager) {
    return { ok: false, reason: "transient" };
  }
  const loadPromise = adapter.deviceManager.loadFromCloud();
  const timeoutPromise = new Promise<CloudLoadResult>(resolve => {
    adapter.cloudInitTimer = adapter.setTimeout(() => resolve({ ok: false, reason: "transient" }), READY_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([loadPromise, timeoutPromise]);
    if (adapter.cloudInitTimer) {
      adapter.clearTimeout(adapter.cloudInitTimer);
      adapter.cloudInitTimer = undefined;
    }
    return result;
  } catch {
    if (adapter.cloudInitTimer) {
      adapter.clearTimeout(adapter.cloudInitTimer);
      adapter.cloudInitTimer = undefined;
    }
    return { ok: false, reason: "transient" };
  }
}

/**
 * Build the host object for {@link CloudRetryLoop}.
 *
 * @param adapter
 */
export function buildCloudRetryHost(adapter: CloudRetryHandlerAdapter): CloudRetryHost {
  return {
    log: adapter.log,
    setTimeout: (cb, ms) => adapter.setTimeout(cb, ms),
    clearTimeout: h => adapter.clearTimeout(h as ioBroker.Timeout),
    loadFromCloud: () => cloudInitWithTimeout(adapter),
    onCloudRestored: async () => {
      adapter.cloudWasConnected = true;
      adapter.setStateAsync("info.cloudConnected", { val: true, ack: true }).catch(() => {});
      adapter.stateManager?.updateGroupsOnline(true).catch(() => {});
      await adapter.loadCloudStates();
    },
  };
}

/**
 * Lazy-initialise the retry loop on first use.
 *
 * @param adapter
 */
export function ensureCloudRetry(adapter: CloudRetryHandlerAdapter): CloudRetryLoop {
  if (!adapter.cloudRetry) {
    adapter.cloudRetry = new CloudRetryLoop(buildCloudRetryHost(adapter));
    adapter.cloudRetry.setConnected(adapter.cloudWasConnected);
  }
  return adapter.cloudRetry;
}

/**
 * React to a Cloud-load outcome — delegates to {@link CloudRetryLoop}.
 *
 * @param adapter
 * @param result
 */
export function handleCloudFailure(adapter: CloudRetryHandlerAdapter, result: CloudLoadResult): void {
  ensureCloudRetry(adapter).handleResult(result);
}

/**
 * React to the user writing `info.refresh_cloud_data = true`. Performs one
 * full Cloud reload cycle so newly created scenes/snapshots from the Govee
 * Home app show up without an adapter restart.
 *
 * @param adapter
 */
export async function handleManualCloudRefresh(adapter: CloudRetryHandlerAdapter): Promise<void> {
  if (!adapter.deviceManager || !adapter.cloudClient) {
    adapter.log.info(`Refresh cloud data: no Cloud client configured (API key missing) — nothing to do`);
    return;
  }
  adapter.log.info(`Refresh cloud data: re-fetching scenes and snapshots for all devices`);
  try {
    const changed = await adapter.deviceManager.refreshSceneData();
    if (changed) {
      await adapter.loadCloudStates();
    }
  } catch (e) {
    adapter.log.warn(`Refresh cloud data failed: ${errMessage(e)}`);
  }
}
