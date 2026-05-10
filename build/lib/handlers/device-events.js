"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var device_events_exports = {};
__export(device_events_exports, {
  onDeviceListChanged: () => onDeviceListChanged,
  onDeviceStateUpdate: () => onDeviceStateUpdate,
  refreshDeviceStates: () => refreshDeviceStates
});
module.exports = __toCommonJS(device_events_exports);
var import_capability_mapper = require("../capability-mapper");
var import_device_registry = require("../device-registry");
var import_types = require("../types");
var connectionState = __toESM(require("./connection-state"));
var groupFanoutHandler = __toESM(require("./group-fanout-handler"));
var groupStateHelpers = __toESM(require("./group-state-helpers"));
function onDeviceStateUpdate(adapter, device, state) {
  if (adapter.stateManager) {
    adapter.stateManager.updateDeviceState(device, state).catch(() => {
    });
  }
  connectionState.updateConnectionState(adapter);
  if (state.online !== void 0) {
    groupFanoutHandler.updateGroupReachability(adapter);
  }
  const powerOff = state.power === false || state.power === 0;
  if (powerOff && adapter.stateManager) {
    const prefix = adapter.stateManager.devicePrefix(device);
    groupStateHelpers.resetModeDropdowns(adapter, prefix, "").catch(() => void 0);
  }
}
function refreshDeviceStates(adapter, device, allDevices) {
  var _a;
  if (!adapter.stateManager) {
    return;
  }
  const localSnaps = (_a = adapter.localSnapshots) == null ? void 0 : _a.getSnapshots(device.sku, device.deviceId);
  let memberDevices;
  if (device.sku === "BaseGroup" && device.groupMembers) {
    memberDevices = groupFanoutHandler.resolveGroupMembers(device, allDevices);
  }
  const stateDefs = (0, import_capability_mapper.buildDeviceStateDefs)(device, localSnaps, memberDevices);
  const p = adapter.stateManager.createDeviceStates(device, stateDefs).then(async () => {
    var _a2, _b;
    await ((_a2 = adapter.stateManager) == null ? void 0 : _a2.migrateLegacyDiagnostics(device));
    await ((_b = adapter.stateManager) == null ? void 0 : _b.updateDeviceTier(device, (0, import_device_registry.getDeviceTier)(device.sku)));
  }).catch((e) => {
    adapter.log.error(`createDeviceStates failed for ${device.name}: ${(0, import_types.errMessage)(e)}`);
  });
  if (!adapter.statesReady) {
    adapter.stateCreationQueue.push(p);
  } else {
    void p;
  }
}
function onDeviceListChanged(adapter, devices) {
  var _a;
  if (!adapter.stateManager) {
    return;
  }
  for (const device of devices) {
    refreshDeviceStates(adapter, device, devices);
  }
  connectionState.updateConnectionState(adapter);
  if (adapter.statesReady) {
    (_a = adapter.reapStaleDevices) == null ? void 0 : _a.call(adapter).catch(() => void 0);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  onDeviceListChanged,
  onDeviceStateUpdate,
  refreshDeviceStates
});
//# sourceMappingURL=device-events.js.map
