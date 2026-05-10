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
var cloud_retry_handler_exports = {};
__export(cloud_retry_handler_exports, {
  buildCloudRetryHost: () => buildCloudRetryHost,
  cloudInitWithTimeout: () => cloudInitWithTimeout,
  ensureCloudRetry: () => ensureCloudRetry,
  handleCloudFailure: () => handleCloudFailure,
  handleManualCloudRefresh: () => handleManualCloudRefresh
});
module.exports = __toCommonJS(cloud_retry_handler_exports);
var import_cloud_retry = require("../cloud-retry");
var import_types = require("../types");
var import_timing_constants = require("../timing-constants");
async function cloudInitWithTimeout(adapter) {
  if (!adapter.deviceManager) {
    return { ok: false, reason: "transient" };
  }
  const loadPromise = adapter.deviceManager.loadFromCloud();
  const timeoutPromise = new Promise((resolve) => {
    adapter.cloudInitTimer = adapter.setTimeout(() => resolve({ ok: false, reason: "transient" }), import_timing_constants.READY_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([loadPromise, timeoutPromise]);
    if (adapter.cloudInitTimer) {
      adapter.clearTimeout(adapter.cloudInitTimer);
      adapter.cloudInitTimer = void 0;
    }
    return result;
  } catch {
    if (adapter.cloudInitTimer) {
      adapter.clearTimeout(adapter.cloudInitTimer);
      adapter.cloudInitTimer = void 0;
    }
    return { ok: false, reason: "transient" };
  }
}
function buildCloudRetryHost(adapter) {
  return {
    log: adapter.log,
    setTimeout: (cb, ms) => adapter.setTimeout(cb, ms),
    clearTimeout: (h) => adapter.clearTimeout(h),
    loadFromCloud: () => cloudInitWithTimeout(adapter),
    onCloudRestored: async () => {
      var _a;
      adapter.cloudWasConnected = true;
      adapter.setStateAsync("info.cloudConnected", { val: true, ack: true }).catch(() => {
      });
      (_a = adapter.stateManager) == null ? void 0 : _a.updateGroupsOnline(true).catch(() => {
      });
      await adapter.loadCloudStates();
    }
  };
}
function ensureCloudRetry(adapter) {
  if (!adapter.cloudRetry) {
    adapter.cloudRetry = new import_cloud_retry.CloudRetryLoop(buildCloudRetryHost(adapter));
    adapter.cloudRetry.setConnected(adapter.cloudWasConnected);
  }
  return adapter.cloudRetry;
}
function handleCloudFailure(adapter, result) {
  ensureCloudRetry(adapter).handleResult(result);
}
async function handleManualCloudRefresh(adapter) {
  if (!adapter.deviceManager || !adapter.cloudClient) {
    adapter.log.info(`Refresh cloud data: no Cloud client configured (API key missing) \u2014 nothing to do`);
    return;
  }
  adapter.log.info(`Refresh cloud data: re-fetching scenes and snapshots for all devices`);
  try {
    const changed = await adapter.deviceManager.refreshSceneData();
    if (changed) {
      await adapter.loadCloudStates();
    }
  } catch (e) {
    adapter.log.warn(`Refresh cloud data failed: ${(0, import_types.errMessage)(e)}`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildCloudRetryHost,
  cloudInitWithTimeout,
  ensureCloudRetry,
  handleCloudFailure,
  handleManualCloudRefresh
});
//# sourceMappingURL=cloud-retry-handler.js.map
