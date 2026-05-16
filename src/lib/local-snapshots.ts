import { errMessage } from "./types";

/** Per-segment state in a local snapshot */
export interface SnapshotSegment {
  /** Color as "#RRGGBB" */
  color: string;
  /** Brightness 0-100 */
  brightness: number;
}

/** A single locally saved device state snapshot */
export interface LocalSnapshot {
  /** User-given name */
  name: string;
  /** Power state */
  power: boolean;
  /** Brightness 0-100 */
  brightness: number;
  /** Color as "#RRGGBB" */
  colorRgb: string;
  /** Color temperature in Kelvin (0 = RGB mode) */
  colorTemperature: number;
  /** Per-segment color+brightness (index = segment number) */
  segments?: SnapshotSegment[];
  /** Timestamp when saved */
  savedAt: number;
}

/** Per-device snapshot file format */
interface SnapshotFile {
  snapshots: LocalSnapshot[];
}

/**
 * Minimal adapter surface used by the snapshot store. Lets unit tests inject
 * a fake without pulling the full ioBroker.Adapter type.
 */
export interface LocalSnapshotStoreAdapter {
  /** Adapter namespace, e.g. `govee-smart.0` */
  readonly namespace: string;
  /**
   * Read a file from the given meta object.
   *
   * @param meta Meta-object id (e.g. `<namespace>.snapshots`)
   * @param name File name relative to the meta object
   */
  readFileAsync(meta: string, name: string): Promise<{ file: Buffer | string; mimeType?: string }>;
  /**
   * Write a file to the given meta object.
   *
   * @param meta Meta-object id
   * @param name File name relative to the meta object
   * @param data File contents
   */
  writeFileAsync(meta: string, name: string, data: Buffer | string): Promise<void>;
  /**
   * Delete a file from the given meta object.
   *
   * @param meta Meta-object id
   * @param name File name relative to the meta object
   */
  delFileAsync(meta: string, name: string): Promise<void>;
  /**
   * List files within the given meta object.
   *
   * @param meta Meta-object id
   * @param path Sub-path within the meta object (empty string = root)
   */
  readDirAsync(meta: string, path: string): Promise<{ file: string; isDir: boolean }[]>;
}

/**
 * Local snapshot storage — saves/restores device states without Cloud.
 *
 * Files are stored in the `<namespace>.snapshots` meta.user object, so they
 * are included in `iob backup` / BackItUp. `getSnapshots()` reads from an
 * in-memory cache populated at `init()` — sync access for consumers like the
 * diagnostics provider that can't be made async.
 */
export class LocalSnapshotStore {
  private readonly adapter: LocalSnapshotStoreAdapter;
  private readonly log: ioBroker.Logger;
  private readonly metaNamespace: string;
  /** key = `<sku>_<shortId>`, value = snapshots for that device */
  private readonly cache = new Map<string, LocalSnapshot[]>();
  /** False until init() succeeds — guards save/load when meta.user is unreachable */
  private dataAvailable = false;

  /**
   * @param adapter ioBroker adapter (for writeFileAsync/readFileAsync/readDirAsync/delFileAsync)
   * @param log ioBroker logger
   */
  constructor(adapter: LocalSnapshotStoreAdapter, log: ioBroker.Logger) {
    this.adapter = adapter;
    this.log = log;
    this.metaNamespace = `${adapter.namespace}.snapshots`;
  }

  /**
   * Load all existing snapshot files from the `<namespace>.snapshots` meta.user
   * object into the in-memory cache. Must be awaited before any `getSnapshots()`
   * call. Idempotent — safe to call multiple times.
   */
  async init(): Promise<void> {
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
          const data = JSON.parse(typeof file === "string" ? file : file.toString("utf-8")) as SnapshotFile;
          if (Array.isArray(data?.snapshots)) {
            this.cache.set(key, data.snapshots);
          }
        } catch (e) {
          this.log.debug(`Snapshot read failed for ${entry.file}: ${errMessage(e)}`);
        }
      }
      this.dataAvailable = true;
    } catch (e) {
      // readDirAsync throws if the meta object doesn't exist yet — first run
      // before any snapshot was saved. instanceObjects ensures it's created,
      // but defensive in case the object got deleted manually.
      this.dataAvailable = true;
      this.log.debug(`Snapshot directory empty or unreachable: ${errMessage(e)}`);
    }
  }

  /**
   * Get all snapshots for a device. Sync — reads from the in-memory cache
   * populated by `init()`.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   */
  getSnapshots(sku: string, deviceId: string): LocalSnapshot[] {
    if (!this.dataAvailable) {
      return [];
    }
    return this.cache.get(this.deviceKey(sku, deviceId)) ?? [];
  }

  /**
   * Save a new snapshot (or overwrite existing with same name). Updates the
   * in-memory cache synchronously, then persists to meta.user.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   * @param snapshot Snapshot data to save
   */
  async saveSnapshot(sku: string, deviceId: string, snapshot: LocalSnapshot): Promise<void> {
    if (!this.dataAvailable) {
      this.log.warn(`Cannot save snapshot "${snapshot.name}" — snapshot storage not initialised`);
      return;
    }
    const key = this.deviceKey(sku, deviceId);
    const snapshots = this.cache.get(key) ?? [];
    const existing = snapshots.findIndex(s => s.name === snapshot.name);
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
  async deleteSnapshot(sku: string, deviceId: string, name: string): Promise<boolean> {
    if (!this.dataAvailable) {
      return false;
    }
    const key = this.deviceKey(sku, deviceId);
    const snapshots = this.cache.get(key) ?? [];
    const idx = snapshots.findIndex(s => s.name === name);
    if (idx < 0) {
      return false;
    }
    snapshots.splice(idx, 1);
    if (snapshots.length === 0) {
      this.cache.delete(key);
      try {
        await this.adapter.delFileAsync(this.metaNamespace, `${key}.json`);
      } catch (e) {
        this.log.debug(`Snapshot file delete failed for ${key}: ${errMessage(e)}`);
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
  private async persist(key: string, snapshots: LocalSnapshot[]): Promise<void> {
    try {
      const data: SnapshotFile = { snapshots };
      await this.adapter.writeFileAsync(this.metaNamespace, `${key}.json`, JSON.stringify(data, null, 2));
    } catch (e) {
      this.log.warn(`Snapshot write failed for ${key}: ${errMessage(e)}`);
    }
  }

  /**
   * Build device key for cache + filename.
   *
   * @param sku Product model
   * @param deviceId Device identifier
   */
  private deviceKey(sku: string, deviceId: string): string {
    const safeSku = typeof sku === "string" ? sku : "";
    const safeId = typeof deviceId === "string" ? deviceId : "";
    const shortId = safeId.replace(/:/g, "").toLowerCase().slice(-4);
    return `${safeSku.toLowerCase()}_${shortId}`;
  }
}
