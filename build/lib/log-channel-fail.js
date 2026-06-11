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
var log_channel_fail_exports = {};
__export(log_channel_fail_exports, {
  formatChannelFail: () => formatChannelFail,
  logChannelFail: () => logChannelFail
});
module.exports = __toCommonJS(log_channel_fail_exports);
var import_http_client = require("./http-client");
var import_types = require("./types");
function logChannelFail(log, opts) {
  const { channel, err, retryHint, context, dedup } = opts;
  const category = (0, import_types.classifyError)(err);
  const userMessage = formatChannelFail(channel, category, err, retryHint, context);
  const rawMessage = err instanceof Error ? err.message : String(err);
  if (dedup.lastCategory === category) {
    log.debug(`${userMessage} (repeated; raw: ${rawMessage})`);
    return;
  }
  dedup.lastCategory = category;
  log.warn(userMessage);
  if (err instanceof Error && err.stack) {
    log.debug(`${channel} fail detail: ${err.stack}`);
  } else {
    log.debug(`${channel} fail detail: ${rawMessage}`);
  }
}
function formatChannelFail(channel, category, err, retryHint, context) {
  var _a;
  const contextSuffix = context ? ` (${context})` : "";
  const retrySuffix = retryHint ? ` \u2014 ${retryHint}` : "";
  switch (category) {
    case "TIMEOUT": {
      const detail = err instanceof Error ? err.message : "Timeout";
      return `${channel}: ${detail}${retrySuffix}`;
    }
    case "NETWORK": {
      const code = err instanceof Error ? (_a = err.code) != null ? _a : "" : "";
      const codePart = code ? ` (${code})` : "";
      return `${channel}: network error${codePart}${contextSuffix}${retrySuffix}`;
    }
    case "AUTH": {
      const status = err instanceof import_http_client.HttpError ? err.statusCode : null;
      const statusPart = status ? ` (HTTP ${status})` : "";
      return `${channel}: authentication failed${statusPart} \u2014 check adapter config, no auto-retry`;
    }
    case "RATE_LIMIT": {
      const status = err instanceof import_http_client.HttpError ? err.statusCode : null;
      const statusPart = status ? ` (HTTP ${status})` : "";
      const hint = retryHint != null ? retryHint : "retrying after Retry-After window";
      return `${channel}: rate-limited by Govee${statusPart} \u2014 ${hint}`;
    }
    case "VERIFICATION_PENDING":
      return `${channel}: verification code required \u2014 open adapter Settings and request a code`;
    case "VERIFICATION_FAILED":
      return `${channel}: verification code rejected \u2014 request a fresh code in Settings`;
    case "UNKNOWN":
    default: {
      const msg = err instanceof Error ? err.message : String(err);
      return `${channel}: request failed${contextSuffix} \u2014 ${msg}${retrySuffix}`;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatChannelFail,
  logChannelFail
});
//# sourceMappingURL=log-channel-fail.js.map
