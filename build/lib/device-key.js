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
var device_key_exports = {};
__export(device_key_exports, {
  mapKey: () => mapKey,
  sessionKey: () => sessionKey,
  treeKey: () => treeKey
});
module.exports = __toCommonJS(device_key_exports);
var import_types = require("./types");
function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}
function mapKey(sku, deviceId) {
  return `${sku}_${(0, import_types.normalizeDeviceId)(deviceId)}`;
}
function treeKey(sku, deviceId) {
  const shortId = (0, import_types.normalizeDeviceId)(deviceId).slice(-4);
  return sanitizeId(`${sku}_${shortId}`);
}
function sessionKey(sku, deviceId) {
  return `${sku}:${deviceId}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mapKey,
  sessionKey,
  treeKey
});
//# sourceMappingURL=device-key.js.map
