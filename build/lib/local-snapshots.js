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
var local_snapshots_exports = {};
__export(local_snapshots_exports, {
  LocalSnapshotStore: () => LocalSnapshotStore
});
module.exports = __toCommonJS(local_snapshots_exports);
var import_types = require("./types");
class LocalSnapshotStore {
  adapter;
  log;
  metaNamespace;
  /** key = `<sku>_<shortId>`, value = snapshots for that device */
  cache = /* @__PURE__ */ new Map();
  /** False until init() succeeds — guards save/load when meta.user is unreachable */
  dataAvailable = false;
  /**
   * @param adapter ioBroker adapter (for writeFileAsync/readFileAsync/readDirAsync/delFileAsync)
   * @param log ioBroker logger
   */
  constructor(adapter, log) {
    this.adapter = adapter;
    this.log = log;
    this.metaNamespace = `${adapter.namespace}.snapshots`;
  }
  /**
   * Load all existing snapshot files from the `<namespace>.snapshots` meta.user
   * object into the in-memory cache. Must be awaited before any `getSnapshots()`
   * call. Idempotent — safe to call multiple times.
   */
  async init() {
    this.cache.clear();
    try {
      const entries = await this.adapter.readDirAsync(this.metaNamespace, "");
      for (const entry of entries) {
        if (entry.isDir || !entry.file.endsWith(".json")) {
          continue;
        }
        const key = entry.file.slice(0, -".json".length);
        try {
          const { file } = await this.adapter.readFileAsync(this.metaNamespace, entry.file);
          const data = JSON.parse(typeof file === "string" ? file : file.toString("utf-8"));
          if (Array.isArray(data == null ? void 0 : data.snapshots)) {
            this.cache.set(key, data.snapshots);
          }
        } catch (e) {
          this.log.debug(`Snapshot read failed for ${entry.file}: ${(0, import_types.errMessage)(e)}`);
        }
      }
      this.dataAvailable = true;
    } catch (e) {
      this.dataAvailable = true;
      this.log.debug(`Snapshot directory empty or unreachable: ${(0, import_types.errMessage)(e)}`);
    }
  }
  /**
   * Get all snapshots for a device. Sync — reads from the in-memory cache
   * populated by `init()`.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   */
  getSnapshots(sku, deviceId) {
    var _a;
    if (!this.dataAvailable) {
      return [];
    }
    return (_a = this.cache.get(this.deviceKey(sku, deviceId))) != null ? _a : [];
  }
  /**
   * Save a new snapshot (or overwrite existing with same name). Updates the
   * in-memory cache synchronously, then persists to meta.user.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   * @param snapshot Snapshot data to save
   */
  async saveSnapshot(sku, deviceId, snapshot) {
    var _a;
    if (!this.dataAvailable) {
      this.log.warn(`Cannot save snapshot "${snapshot.name}" \u2014 snapshot storage not initialised`);
      return;
    }
    const key = this.deviceKey(sku, deviceId);
    const snapshots = (_a = this.cache.get(key)) != null ? _a : [];
    const existing = snapshots.findIndex((s) => s.name === snapshot.name);
    if (existing >= 0) {
      snapshots[existing] = snapshot;
    } else {
      snapshots.push(snapshot);
    }
    this.cache.set(key, snapshots);
    await this.persist(key, snapshots);
    this.log.debug(`Local snapshot saved: "${snapshot.name}" for ${sku}`);
  }
  /**
   * Delete a snapshot by name. Updates the in-memory cache synchronously,
   * then persists to meta.user.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   * @param name Snapshot name to delete
   */
  async deleteSnapshot(sku, deviceId, name) {
    var _a;
    if (!this.dataAvailable) {
      return false;
    }
    const key = this.deviceKey(sku, deviceId);
    const snapshots = (_a = this.cache.get(key)) != null ? _a : [];
    const idx = snapshots.findIndex((s) => s.name === name);
    if (idx < 0) {
      return false;
    }
    snapshots.splice(idx, 1);
    if (snapshots.length === 0) {
      this.cache.delete(key);
      try {
        await this.adapter.delFileAsync(this.metaNamespace, `${key}.json`);
      } catch (e) {
        this.log.debug(`Snapshot file delete failed for ${key}: ${(0, import_types.errMessage)(e)}`);
      }
    } else {
      this.cache.set(key, snapshots);
      await this.persist(key, snapshots);
    }
    this.log.debug(`Local snapshot deleted: "${name}" for ${sku}`);
    return true;
  }
  /**
   * Write snapshot file for a device to meta.user storage.
   *
   * @param key device key
   * @param snapshots Snapshot array to persist
   */
  async persist(key, snapshots) {
    try {
      const data = { snapshots };
      await this.adapter.writeFileAsync(this.metaNamespace, `${key}.json`, JSON.stringify(data, null, 2));
    } catch (e) {
      this.log.warn(`Snapshot write failed for ${key}: ${(0, import_types.errMessage)(e)}`);
    }
  }
  /**
   * Build device key for cache + filename.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   */
  deviceKey(sku, deviceId) {
    const safeSku = typeof sku === "string" ? sku : "";
    const safeId = typeof deviceId === "string" ? deviceId : "";
    const shortId = safeId.replace(/:/g, "").toLowerCase().slice(-4);
    return `${safeSku.toLowerCase()}_${shortId}`;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LocalSnapshotStore
});
//# sourceMappingURL=local-snapshots.js.map
