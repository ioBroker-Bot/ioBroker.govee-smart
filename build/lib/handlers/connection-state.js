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
var connection_state_exports = {};
__export(connection_state_exports, {
  checkAllReady: () => checkAllReady,
  checkAppVersionDrift: () => checkAppVersionDrift,
  logDeviceSummary: () => logDeviceSummary,
  reapStaleDevices: () => reapStaleDevices,
  updateConnectionState: () => updateConnectionState
});
module.exports = __toCommonJS(connection_state_exports);
var import_http_client = require("../http-client");
var import_types = require("../types");
var import_govee_constants = require("../govee-constants");
function updateConnectionState(adapter) {
  var _a, _b;
  const devices = (_b = (_a = adapter.deviceManager) == null ? void 0 : _a.getDevices()) != null ? _b : [];
  const hasDevices = devices.length > 0;
  const anyOnline = devices.some((d) => d.state.online);
  const lanRunning = adapter.lanClient !== null;
  const connected = hasDevices ? anyOnline : lanRunning;
  if (connected !== adapter.lastConnectionState) {
    adapter.lastConnectionState = connected;
    adapter.setStateAsync("info.connection", { val: connected, ack: true }).catch(() => {
    });
  }
}
async function checkAppVersionDrift(adapter) {
  var _a, _b, _c, _d, _e, _f;
  try {
    const resp = await (0, import_http_client.httpsRequest)({
      method: "GET",
      url: "https://itunes.apple.com/lookup?bundleId=com.ihoment.GoVeeSensor",
      headers: { "User-Agent": "ioBroker.govee-smart" },
      timeout: 1e4
    });
    const liveVersion = (_b = (_a = resp.results) == null ? void 0 : _a[0]) == null ? void 0 : _b.version;
    if (typeof liveVersion !== "string" || liveVersion.length === 0) {
      return;
    }
    const localParts = import_govee_constants.GOVEE_APP_VERSION.split(".").map(Number);
    const liveParts = liveVersion.split(".").map(Number);
    const localMajor = (_c = localParts[0]) != null ? _c : 0;
    const localMinor = (_d = localParts[1]) != null ? _d : 0;
    const liveMajor = (_e = liveParts[0]) != null ? _e : 0;
    const liveMinor = (_f = liveParts[1]) != null ? _f : 0;
    const liveTotal = liveMajor * 100 + liveMinor;
    const localTotal = localMajor * 100 + localMinor;
    const driftMinor = liveTotal - localTotal;
    const driftMessage = driftMinor === 0 ? `current (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION})` : driftMinor <= 2 ? `minor drift (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION})` : `STALE (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION}) \u2014 bump GOVEE_APP_VERSION`;
    await adapter.setStateAsync("info.appVersionDrift", { val: driftMessage, ack: true }).catch(() => void 0);
    if (driftMinor > 2) {
      adapter.log.warn(
        `Govee app version drift: live ${liveVersion} vs local ${import_govee_constants.GOVEE_APP_VERSION} \u2014 undocumented endpoints may start failing. Run sync-govee-app-version.py + release a new adapter version.`
      );
    } else {
      adapter.log.debug(`App version: ${driftMessage}`);
    }
  } catch (e) {
    adapter.log.debug(`App version check failed: ${(0, import_types.errMessage)(e)}`);
  }
}
async function reapStaleDevices(adapter) {
  if (!adapter.stateManager || !adapter.deviceManager) {
    return;
  }
  const currentDevices = adapter.deviceManager.getDevices();
  await adapter.stateManager.cleanupDevices(currentDevices);
  const liveDeviceIds = new Set(currentDevices.map((d) => d.deviceId));
  adapter.deviceManager.getDiagnostics().pruneOrphans(liveDeviceIds);
  const liveKeys = new Set(currentDevices.map((d) => `${d.sku}:${d.deviceId}`));
  for (const key of adapter.diagnosticsLastRun.keys()) {
    if (!liveKeys.has(key)) {
      adapter.diagnosticsLastRun.delete(key);
    }
  }
}
function checkAllReady(adapter) {
  var _a, _b;
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
  if (((_a = adapter.deviceManager) == null ? void 0 : _a.hasDeviceNeedingAppApi()) && !adapter.appApiInitialPollDone) {
    return;
  }
  adapter.readyLogged = true;
  logDeviceSummary(adapter);
  (_b = adapter.deviceManager) == null ? void 0 : _b.saveDevicesToCache();
}
function logDeviceSummary(adapter) {
  var _a, _b;
  if (!adapter.deviceManager) {
    return;
  }
  const all = adapter.deviceManager.getDevices();
  const devices = all.filter((d) => d.sku !== "BaseGroup");
  const groups = all.filter((d) => d.sku === "BaseGroup");
  const channels = ["LAN"];
  if (adapter.cloudWasConnected) {
    channels.push("Cloud");
  }
  if ((_a = adapter.mqttClient) == null ? void 0 : _a.connected) {
    channels.push("MQTT");
  }
  if ((_b = adapter.openapiMqttClient) == null ? void 0 : _b.connected) {
    channels.push("Cloud-events");
  }
  const lightDevices = devices.filter((d) => d.type === "devices.types.light");
  const onlineDevices = devices.filter((d) => d.state.online === true);
  const parts = [];
  if (devices.length > 0) {
    const onlineLights = lightDevices.filter((d) => d.state.online === true).length;
    const totalLights = lightDevices.length;
    if (totalLights > 0) {
      parts.push(
        totalLights === onlineLights ? `${totalLights} light${totalLights > 1 ? "s" : ""} online` : `${totalLights} light${totalLights > 1 ? "s" : ""} (${onlineLights} online, ${totalLights - onlineLights} offline)`
      );
    }
    const sensors = devices.length - lightDevices.length;
    if (sensors > 0) {
      const onlineSensors = onlineDevices.filter((d) => d.type !== "devices.types.light").length;
      parts.push(`${sensors} sensor${sensors > 1 ? "s" : ""} (${onlineSensors} with data)`);
    }
  }
  if (groups.length > 0) {
    parts.push(`${groups.length} group${groups.length > 1 ? "s" : ""}`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : "no devices found";
  adapter.log.info(`Govee adapter ready \u2014 ${summary} \u2014 channels: ${channels.join("+")}`);
  if (adapter.cloudClient && !adapter.cloudWasConnected) {
    const reason = adapter.cloudClient.getFailureReason();
    adapter.log.warn(reason ? `Cloud not connected \u2014 ${reason}` : `Cloud not connected \u2014 see earlier errors`);
  }
  if (adapter.mqttClient && !adapter.mqttClient.connected) {
    const reason = adapter.mqttClient.getFailureReason();
    adapter.log.warn(reason ? `MQTT not connected \u2014 ${reason}` : `MQTT not connected \u2014 see earlier errors`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkAllReady,
  checkAppVersionDrift,
  logDeviceSummary,
  reapStaleDevices,
  updateConnectionState
});
//# sourceMappingURL=connection-state.js.map
