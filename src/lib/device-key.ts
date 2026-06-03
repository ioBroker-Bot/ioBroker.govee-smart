import { normalizeDeviceId } from "./types";

/**
 * Sanitize a string for use inside an ioBroker object id — lowercase, only
 * `[a-z0-9_-]` survive (everything else becomes `_`). Matches the historical
 * `sanitize` helpers in state-manager/sku-cache so existing object ids and
 * cache filenames keep the exact same shape.
 *
 * @param str Raw string
 */
function sanitizeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Runtime map key for the in-memory device registry — `${sku}_<normalizedId>`
 * with the FULL normalized device id. NOT an object id, never written to disk.
 *
 * @param sku Govee SKU
 * @param deviceId Raw device id
 */
export function mapKey(sku: string, deviceId: string): string {
  return `${sku}_${normalizeDeviceId(deviceId)}`;
}

/**
 * State-tree / on-disk key — `${skuLower}_<last4>`, sanitized for use as an
 * ioBroker object id. Used for the device-object prefix (below the
 * `devices.`/`groups.` folder), the SKU-cache filename and the local-snapshot
 * filename, plus the comma-separated group-member lists. Stable across
 * restarts — the short, sanitized form is what users already have on disk.
 *
 * @param sku Govee SKU
 * @param deviceId Raw device id
 */
export function treeKey(sku: string, deviceId: string): string {
  const shortId = normalizeDeviceId(deviceId).slice(-4);
  return sanitizeId(`${sku}_${shortId}`);
}

/**
 * Session key for the wizard + diagnostics-throttle maps — `${sku}:${deviceId}`
 * with the RAW (un-normalized) device id, matching the existing in-memory keys.
 * In-memory only (never persisted), so the raw form is fine.
 *
 * @param sku Govee SKU
 * @param deviceId Raw device id
 */
export function sessionKey(sku: string, deviceId: string): string {
  return `${sku}:${deviceId}`;
}
