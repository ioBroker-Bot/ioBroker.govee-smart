import { normalizeDeviceId, type GoveeDevice } from "../types";

/** Parsed per-segment data from MQTT BLE packets */
export interface MqttSegmentData {
  /** Segment index (0-based) */
  index: number;
  /** Per-segment brightness 0-100 */
  brightness: number;
  /** Red channel 0-255 */
  r: number;
  /** Green channel 0-255 */
  g: number;
  /** Blue channel 0-255 */
  b: number;
}

/**
 * Parse AA A5 BLE notification packets from MQTT op.command.
 * 5 packets × 4 segment slots = max 20 segments per push. The device sends
 * exactly as many packets as it has physical segments — so parsing out all
 * slots (and filtering empty-slot padding) gives us a reliable count of
 * what actually exists on the strip.
 *
 * Format per slot: [Brightness 0-100] [R] [G] [B].
 *
 * An "empty" slot (brightness = 0 AND r = g = b = 0) is treated as padding
 * in a partially-filled final packet, not as a real unlit segment — this
 * matters for devices that don't pad their last packet to 4 slots.
 *
 * @param commands Base64-encoded BLE packets from MQTT op.command
 */
export function parseMqttSegmentData(commands: string[]): MqttSegmentData[] {
  if (!Array.isArray(commands)) {
    return [];
  }

  const segments: MqttSegmentData[] = [];
  let highestPacket = 0;

  for (const cmd of commands) {
    if (typeof cmd !== "string") {
      continue;
    }
    const bytes = Buffer.from(cmd, "base64");
    if (bytes.length < 20 || bytes[0] !== 0xaa || bytes[1] !== 0xa5) {
      continue;
    }

    // M2 — XOR-Checksum-Validation. Govee BLE-Pakete haben am letzten Byte
    // (Index 19) einen XOR über Bytes 0-18. Spoofed/malformed Pakete
    // schlüpfen sonst durch und persistieren falsche segmentCount.
    let xor = 0;
    for (let i = 0; i < 19; i++) {
      xor ^= bytes[i];
    }
    if (xor !== bytes[19]) {
      continue;
    }

    const packetNum = bytes[2];
    if (packetNum < 1 || packetNum > 5) {
      continue;
    }
    if (packetNum > highestPacket) {
      highestPacket = packetNum;
    }

    const baseIndex = (packetNum - 1) * 4;
    for (let slot = 0; slot < 4; slot++) {
      const segIdx = baseIndex + slot;
      const offset = 3 + slot * 4;
      segments.push({
        index: segIdx,
        brightness: bytes[offset],
        r: bytes[offset + 1],
        g: bytes[offset + 2],
        b: bytes[offset + 3],
      });
    }
  }

  while (segments.length > 0) {
    const tail = segments[segments.length - 1];
    if (tail.brightness === 0 && tail.r === 0 && tail.g === 0 && tail.b === 0) {
      segments.pop();
    } else {
      break;
    }
  }

  return segments;
}

/**
 * Effective physical segment indices for a device.
 * Uses `device.manualSegments` when `device.manualMode=true` (cut strip override),
 * falls back to `0..segmentCount-1` otherwise. Empty if device has no segments.
 *
 * @param device Target device
 */
export function getEffectiveSegmentIndices(device: GoveeDevice): number[] {
  if (device.manualMode && Array.isArray(device.manualSegments) && device.manualSegments.length > 0) {
    return device.manualSegments.slice();
  }
  const count = device.segmentCount ?? 0;
  if (count <= 0) {
    return [];
  }
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * Resolve the authoritative segment count for a device.
 *
 * Priority:
 *   1. `device.segmentCount` if already set (from cache, MQTT discovery, or wizard)
 *   2. Minimum of positive `segment_color_setting` capability counts
 *   3. 0 if no capability advertises segments
 *
 * Why `min` over the capability caps: Govee reports `segmentedBrightness` and
 * `segmentedColorRgb` separately, and on at least one SKU (H70D1) those two
 * disagree — brightness says 10, colorRgb says 15, real device has 10.
 * Picking the smaller value is the safer starting point; MQTT discovery can
 * then grow it if the real device pushes more slots.
 *
 * @param device Target device
 */
export function resolveSegmentCount(device: GoveeDevice): number {
  if (typeof device.segmentCount === "number" && device.segmentCount > 0) {
    return device.segmentCount;
  }
  const caps = Array.isArray(device.capabilities) ? device.capabilities : [];
  let min = Number.POSITIVE_INFINITY;
  for (const c of caps) {
    if (!c || typeof c.type !== "string" || !c.type.includes("segment_color_setting")) {
      continue;
    }
    const params = (c as { parameters?: { fields?: unknown[] } }).parameters;
    const fields = Array.isArray(params?.fields) ? params.fields : [];
    for (const f of fields) {
      if (!f || typeof f !== "object") {
        continue;
      }
      const fn = (f as { fieldName?: unknown }).fieldName;
      const er = (f as { elementRange?: { max?: unknown } }).elementRange;
      const rawMax = er && typeof er.max === "number" ? er.max : -1;
      if (fn === "segment" && rawMax >= 0) {
        const n = rawMax + 1;
        if (n > 0 && n < min) {
          min = n;
        }
      }
    }
  }
  return Number.isFinite(min) ? min : 0;
}

/** Protocol limit: Govee's segment bitmask is 7 bytes × 8 bits = 56 slots (0..55). */
export const SEGMENT_HARD_MAX = 55;

/**
 * Generate stable map key for a device.
 *
 */
export function deviceKey(sku: string, deviceId: string): string {
  return `${sku}_${normalizeDeviceId(deviceId)}`;
}

/**
 * Locate a device in the registry by SKU + raw deviceId, with normalized
 * fallback. Direct key-hit first; if that misses, scan for a normalized
 * match (device IDs come from multiple sources with different
 * colon/case conventions).
 *
 */
export function findDeviceBySkuAndId(
  devices: Map<string, GoveeDevice>,
  sku: string,
  deviceId: string,
): GoveeDevice | undefined {
  const direct = devices.get(deviceKey(sku, deviceId));
  if (direct) {
    return direct;
  }
  const normalizedId = normalizeDeviceId(deviceId);
  for (const dev of devices.values()) {
    if (dev.sku === sku && normalizeDeviceId(dev.deviceId) === normalizedId) {
      return dev;
    }
  }
  return undefined;
}
