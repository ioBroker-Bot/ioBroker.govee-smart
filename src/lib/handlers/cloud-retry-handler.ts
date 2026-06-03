import { CloudRetryLoop, type CloudRetryHost } from "../cloud-retry";
import type { DeviceManager } from "../device-manager";
import type { GoveeCloudClient } from "../govee-cloud-client";
import type { StateManager } from "../state-manager";
import type { CloudLoadResult } from "../types";
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
  setTimeout: (cb: () => void, ms: number) => ioBroker.Timeout | undefined;
  clearTimeout: (h: ioBroker.Timeout) => void;
  /** Reload Cloud-state-tree after a recovered connection. */
  loadCloudStates(): Promise<void>;
}

/**
 * Initial Cloud-Load mit 60-Sekunden-Hardtimeout. Blockiert nicht länger —
 * wenn Cloud hängt, geht Adapter mit LAN+MQTT weiter, und der Retry-Loop
 * probiert's passend zum Fehlergrund erneut.
 *
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
 */
export function handleCloudFailure(adapter: CloudRetryHandlerAdapter, result: CloudLoadResult): void {
  ensureCloudRetry(adapter).handleResult(result);
}

/**
 * Reload the Cloud-state-tree — used by the per-device refresh button after
 * a successful `refreshSceneDataForDevice`, so the new states (e.g. fresh
 * snapshot_cloud dropdown options) propagate to ioBroker objects.
 *
 */
export async function reloadCloudStates(adapter: { loadCloudStates(): Promise<void> }): Promise<void> {
  await adapter.loadCloudStates();
}
