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
var log_prefix_exports = {};
__export(log_prefix_exports, {
  formatChannelPrefix: () => formatChannelPrefix,
  installLogPrefix: () => installLogPrefix
});
module.exports = __toCommonJS(log_prefix_exports);
function formatChannelPrefix(snap) {
  return `[LAN=${snap.lan} Cloud=${snap.cloud} MQTT=${snap.mqtt} OpenAPI=${snap.openapi}]`;
}
function installLogPrefix(log, getSnap) {
  const wrappedTag = "__channelPrefixWrapped";
  const tagged = log;
  if (tagged[wrappedTag]) {
    return;
  }
  tagged[wrappedTag] = true;
  for (const level of ["silly", "debug", "info", "warn", "error"]) {
    const orig = log[level].bind(log);
    log[level] = (msg) => {
      orig(`${formatChannelPrefix(getSnap())} ${msg}`);
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatChannelPrefix,
  installLogPrefix
});
//# sourceMappingURL=log-prefix.js.map
