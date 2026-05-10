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
var snapshot_handler_glue_exports = {};
__export(snapshot_handler_glue_exports, {
  buildSnapshotHost: () => buildSnapshotHost
});
module.exports = __toCommonJS(snapshot_handler_glue_exports);
function buildSnapshotHost(adapter) {
  return {
    log: adapter.log,
    store: adapter.localSnapshots,
    namespace: adapter.namespace,
    devicePrefix: (device) => {
      var _a, _b;
      return (_b = (_a = adapter.stateManager) == null ? void 0 : _a.devicePrefix(device)) != null ? _b : "";
    },
    getState: (id) => adapter.getStateAsync(id),
    sendCommand: async (device, command, value) => {
      var _a;
      await ((_a = adapter.deviceManager) == null ? void 0 : _a.sendCommand(device, command, value));
    },
    refreshDeviceStates: (device) => {
      var _a, _b;
      adapter.refreshDeviceStates(device, (_b = (_a = adapter.deviceManager) == null ? void 0 : _a.getDevices()) != null ? _b : []);
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSnapshotHost
});
//# sourceMappingURL=snapshot-handler-glue.js.map
