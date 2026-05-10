import type { DeviceManager } from "../device-manager";
import type { GoveeCloudClient } from "../govee-cloud-client";
import type { GoveeMqttClient } from "../govee-mqtt-client";
import type { GoveeOpenapiMqttClient } from "../govee-openapi-mqtt-client";
import { httpsRequest } from "../http-client";
import { errMessage } from "../types";
import { GOVEE_APP_VERSION } from "../govee-constants";

/**
 * Adapter surface required by the connection-state helpers — covers the
 * info.connection bookkeeping plus ready-summary + app-version drift
 * monitoring + stale-device reaping.
 */
export interface ConnectionStateAdapter {
  readonly log: ioBroker.Logger;
  readonly deviceManager: DeviceManager | null;
  readonly cloudClient: GoveeCloudClient | null;
  readonly cloudWasConnected: boolean;
  readonly diagnosticsLastRun: Map<string, number>;
  readonly mqttClient: GoveeMqttClient | null;
  readonly openapiMqttClient: GoveeOpenapiMqttClient | null;
  readonly lanClient: unknown;
  readonly stateManager: { cleanupDevices(devices: unknown[]): Promise<unknown> } | null;
  readonly lanScanDone: boolean;
  readonly statesReady: boolean;
  readonly cloudInitDone: boolean;
  readonly appApiInitialPollDone: boolean;
  readyLogged: boolean;
  lastConnectionState: boolean | null;
  setStateAsync(id: string, state: ioBroker.SettableState | ioBroker.StateValue): Promise<unknown>;
}

/**
 * Update global `info.connection` — the ioBroker-IDC indicator.
 *
 * Semantik:
 * - Mit Devices: `connected = true` wenn MIND. ein Device online ist.
 *   Wenn alle offline → false (User sieht: kein Device antwortet).
 * - Ohne Devices: `connected = true` wenn der LAN-Stack läuft. Sonst
 *   false (z.B. EADDRINUSE oder bind-Fehler).
 *
 * Write-only-on-change cache (lastConnectionState) so we don't spam
 * setStateAsync on every device-state-update.
 *
 */
export function updateConnectionState(adapter: ConnectionStateAdapter): void {
  const devices = adapter.deviceManager?.getDevices() ?? [];
  const hasDevices = devices.length > 0;
  const anyOnline = devices.some(d => d.state.online);
  const lanRunning = adapter.lanClient !== null;
  const connected = hasDevices ? anyOnline : lanRunning;
  if (connected !== adapter.lastConnectionState) {
    adapter.lastConnectionState = connected;
    adapter.setStateAsync("info.connection", { val: connected, ack: true }).catch(() => {});
  }
}

/**
 * Daily app-version-drift check vs. the iTunes app-store lookup.
 *
 * Govee's app2.govee.com endpoints reject very stale User-Agent strings.
 * Compares live iOS app version with local `GOVEE_APP_VERSION`. On drift
 * > 2 minor: warn-Log + state `info.appVersionDrift`. Failures (5xx,
 * network) are silent debug-logged — no user impact.
 *
 */
export async function checkAppVersionDrift(adapter: ConnectionStateAdapter): Promise<void> {
  try {
    const resp = await httpsRequest<{ resultCount?: number; results?: Array<{ version?: string }> }>({
      method: "GET",
      url: "https://itunes.apple.com/lookup?bundleId=com.ihoment.GoVeeSensor",
      headers: { "User-Agent": "ioBroker.govee-smart" },
      timeout: 10_000,
    });
    const liveVersion = resp.results?.[0]?.version;
    if (typeof liveVersion !== "string" || liveVersion.length === 0) {
      return;
    }
    const localParts = GOVEE_APP_VERSION.split(".").map(Number);
    const liveParts = liveVersion.split(".").map(Number);
    const localMajor = localParts[0] ?? 0;
    const localMinor = localParts[1] ?? 0;
    const liveMajor = liveParts[0] ?? 0;
    const liveMinor = liveParts[1] ?? 0;
    const liveTotal = liveMajor * 100 + liveMinor;
    const localTotal = localMajor * 100 + localMinor;
    const driftMinor = liveTotal - localTotal;
    const driftMessage =
      driftMinor === 0
        ? `current (live=${liveVersion}, local=${GOVEE_APP_VERSION})`
        : driftMinor <= 2
          ? `minor drift (live=${liveVersion}, local=${GOVEE_APP_VERSION})`
          : `STALE (live=${liveVersion}, local=${GOVEE_APP_VERSION}) — bump GOVEE_APP_VERSION`;
    await adapter.setStateAsync("info.appVersionDrift", { val: driftMessage, ack: true }).catch(() => undefined);
    if (driftMinor > 2) {
      adapter.log.warn(
        `Govee app version drift: live ${liveVersion} vs local ${GOVEE_APP_VERSION} — undocumented endpoints may start failing. Run sync-govee-app-version.py + release a new adapter version.`,
      );
    } else {
      adapter.log.debug(`App version: ${driftMessage}`);
    }
  } catch (e) {
    adapter.log.debug(`App version check failed: ${errMessage(e)}`);
  }
}

/**
 * Delete ioBroker objects for devices no longer present and drop the same
 * devices from adapter-level maps. Diagnostics-buffer + diagnosticsLastRun
 * are reaped so removed-device data doesn't leak into the next adapter
 * lifetime.
 *
 */
export async function reapStaleDevices(adapter: ConnectionStateAdapter): Promise<void> {
  if (!adapter.stateManager || !adapter.deviceManager) {
    return;
  }
  const currentDevices = adapter.deviceManager.getDevices();
  await adapter.stateManager.cleanupDevices(currentDevices);

  const liveDeviceIds = new Set(currentDevices.map(d => d.deviceId));
  adapter.deviceManager.getDiagnostics().pruneOrphans(liveDeviceIds);

  const liveKeys = new Set(currentDevices.map(d => `${d.sku}:${d.deviceId}`));
  for (const key of adapter.diagnosticsLastRun.keys()) {
    if (!liveKeys.has(key)) {
      adapter.diagnosticsLastRun.delete(key);
    }
  }
}

/**
 * Check if all configured channels are initialized and log ready message.
 * Called from MQTT onConnection callback and end of onReady.
 *
 */
export function checkAllReady(adapter: ConnectionStateAdapter): void {
  if (adapter.readyLogged) {
    return;
  }
  if (!adapter.lanScanDone) {
    return;
  }
  if (!adapter.statesReady) {
    return;
  }
  if (adapter.cloudClient && !adapter.cloudInitDone) {
    return;
  }
  if (adapter.mqttClient && !adapter.mqttClient.connected) {
    return;
  }
  if (adapter.openapiMqttClient && !adapter.openapiMqttClient.connected) {
    return;
  }
  if (adapter.deviceManager?.hasDeviceNeedingAppApi() && !adapter.appApiInitialPollDone) {
    return;
  }
  adapter.readyLogged = true;
  logDeviceSummary(adapter);
  // Persist any learned changes from the initial load (e.g. resolveSegmentCount
  // collapsing Cloud's 15 to the real 10 on H70D1). One-shot on first ready;
  // subsequent mutations persist themselves (MQTT bumps, wizard, manual-mode).
  adapter.deviceManager?.saveDevicesToCache();
}

/**
 * Log final ready message with device/group/channel summary.
 *
 */
export function logDeviceSummary(adapter: ConnectionStateAdapter): void {
  if (!adapter.deviceManager) {
    return;
  }
  const all = adapter.deviceManager.getDevices();
  const devices = all.filter(d => d.sku !== "BaseGroup");
  const groups = all.filter(d => d.sku === "BaseGroup");

  const channels: string[] = ["LAN"];
  if (adapter.cloudWasConnected) {
    channels.push("Cloud");
  }
  if (adapter.mqttClient?.connected) {
    channels.push("MQTT");
  }
  if (adapter.openapiMqttClient?.connected) {
    channels.push("Cloud-events");
  }

  const lightDevices = devices.filter(d => d.type === "devices.types.light");
  const onlineDevices = devices.filter(d => d.state.online === true);
  const parts: string[] = [];
  if (devices.length > 0) {
    const onlineLights = lightDevices.filter(d => d.state.online === true).length;
    const totalLights = lightDevices.length;
    if (totalLights > 0) {
      parts.push(
        totalLights === onlineLights
          ? `${totalLights} light${totalLights > 1 ? "s" : ""} online`
          : `${totalLights} light${totalLights > 1 ? "s" : ""} (${onlineLights} online, ${totalLights - onlineLights} offline)`,
      );
    }
    const sensors = devices.length - lightDevices.length;
    if (sensors > 0) {
      const onlineSensors = onlineDevices.filter(d => d.type !== "devices.types.light").length;
      parts.push(`${sensors} sensor${sensors > 1 ? "s" : ""} (${onlineSensors} with data)`);
    }
  }
  if (groups.length > 0) {
    parts.push(`${groups.length} group${groups.length > 1 ? "s" : ""}`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : "no devices found";
  adapter.log.info(`Govee adapter ready — ${summary} — channels: ${channels.join("+")}`);

  if (adapter.cloudClient && !adapter.cloudWasConnected) {
    const reason = adapter.cloudClient.getFailureReason();
    adapter.log.warn(reason ? `Cloud not connected — ${reason}` : `Cloud not connected — see earlier errors`);
  }
  if (adapter.mqttClient && !adapter.mqttClient.connected) {
    const reason = adapter.mqttClient.getFailureReason();
    adapter.log.warn(reason ? `MQTT not connected — ${reason}` : `MQTT not connected — see earlier errors`);
  }
}
