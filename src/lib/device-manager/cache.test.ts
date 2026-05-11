import { expect } from "chai";
import type { GoveeDevice } from "../types";
import { cachedToGoveeDevice, goveeDeviceToCached } from "./cache";

/**
 * Tests for the cache <-> device round-trip. These are architecture-invariant
 * tests, not happy-path tests:
 *
 * - Round-trip preserves all cacheable fields automatically (spread, not
 *   hand-listed). Drift between save and load directions is structurally
 *   impossible.
 * - Runtime-only fields (state/channels/lanIp/groupMembers) are NEVER
 *   restored from the cache — they reset to their boot defaults so LAN
 *   discovery, MQTT status push, and groupMembers-refetch take over.
 */
describe("cache.cachedToGoveeDevice / goveeDeviceToCached", () => {
  function makeFullDevice(): GoveeDevice {
    return {
      sku: "H6172",
      deviceId: "AA:BB:CC:DD:EE:FF",
      name: "Living Room Strip",
      type: "devices.types.light",
      lanIp: "192.168.1.42",
      capabilities: [
        { type: "devices.capabilities.on_off", instance: "powerSwitch", parameters: { dataType: "ENUM" } },
      ],
      scenes: [{ name: "Aurora", value: { paramId: 1, sceneCode: 100 } }],
      diyScenes: [{ name: "MyDIY", value: { paramId: 2, sceneCode: 200 } }],
      snapshots: [{ name: "Movie Night", value: { paramId: 3 } }],
      sceneLibrary: [{ name: "Aurora", sceneCode: 100, scenceParam: "base64data" }],
      musicLibrary: [{ name: "Rolling", musicCode: 5, mode: 1 }],
      diyLibrary: [{ name: "MyDIY", diyCode: 200 }],
      skuFeatures: { someFeature: true },
      groupMembers: [{ sku: "H6172", deviceId: "OTHER" }],
      state: { online: true, power: true, brightness: 80 },
      channels: { lan: true, mqtt: true, cloud: true },
      segmentCount: 15,
      manualMode: true,
      manualSegments: [0, 1, 2, 5, 6, 7],
      sceneSpeed: 3,
      snapshotBleCmds: [[["aGV4ZGF0YQ=="]]],
      scenesChecked: true,
      lastSeenOnNetwork: 1234567890,
    };
  }

  describe("Runtime-only field exclusion (architecture invariant)", () => {
    it("does NOT persist 'state' to cache (recomputed from LAN/MQTT each boot)", () => {
      const original = makeFullDevice();
      const cached = goveeDeviceToCached(original);
      expect(cached).to.not.have.property("state");
    });

    it("does NOT persist 'channels' to cache (recomputed from connection results each boot)", () => {
      const original = makeFullDevice();
      const cached = goveeDeviceToCached(original);
      expect(cached).to.not.have.property("channels");
    });

    it("does NOT persist 'lanIp' to cache (re-discovered by LAN UDP scan each boot)", () => {
      const original = makeFullDevice();
      const cached = goveeDeviceToCached(original);
      expect(cached).to.not.have.property("lanIp");
    });

    it("does NOT persist 'groupMembers' to cache (re-resolved by loadGroupMembers each boot)", () => {
      const original = makeFullDevice();
      const cached = goveeDeviceToCached(original);
      expect(cached).to.not.have.property("groupMembers");
    });

    it("restored device has runtime-defaults for state/channels/lanIp/groupMembers", () => {
      const cached = goveeDeviceToCached(makeFullDevice());
      const restored = cachedToGoveeDevice(cached);
      expect(restored.state).to.deep.equal({ online: false });
      expect(restored.channels).to.deep.equal({ lan: false, mqtt: false, cloud: false });
      expect(restored.lanIp).to.equal(undefined);
      expect(restored.groupMembers).to.equal(undefined);
    });

    it("restored device cannot carry a forged lanIp from a tampered cache entry", () => {
      const cached = goveeDeviceToCached(makeFullDevice());
      // Tamper with the cache as if a malicious or stale write injected lanIp.
      // Because the destructure in cachedToGoveeDevice doesn't pull it, the
      // tampered value cannot survive into runtime.
      (cached as unknown as Record<string, unknown>).lanIp = "10.0.0.1";
      const restored = cachedToGoveeDevice(cached);
      expect(restored.lanIp).to.equal(undefined);
    });
  });

  describe("Round-trip preservation for cacheable fields", () => {
    it("all non-runtime fields survive cache → restore", () => {
      const original = makeFullDevice();
      const restored = cachedToGoveeDevice(goveeDeviceToCached(original));

      // Identity + display
      expect(restored.sku).to.equal(original.sku);
      expect(restored.deviceId).to.equal(original.deviceId);
      expect(restored.name).to.equal(original.name);
      expect(restored.type).to.equal(original.type);

      // Cloud data
      expect(restored.capabilities).to.deep.equal(original.capabilities);
      expect(restored.scenes).to.deep.equal(original.scenes);
      expect(restored.diyScenes).to.deep.equal(original.diyScenes);
      expect(restored.snapshots).to.deep.equal(original.snapshots);

      // Libraries
      expect(restored.sceneLibrary).to.deep.equal(original.sceneLibrary);
      expect(restored.musicLibrary).to.deep.equal(original.musicLibrary);
      expect(restored.diyLibrary).to.deep.equal(original.diyLibrary);
      expect(restored.skuFeatures).to.deep.equal(original.skuFeatures);

      // Segment state (cut-strip + learned)
      expect(restored.segmentCount).to.equal(original.segmentCount);
      expect(restored.manualMode).to.equal(original.manualMode);
      expect(restored.manualSegments).to.deep.equal(original.manualSegments);
      expect(restored.sceneSpeed).to.equal(original.sceneSpeed);

      // BLE + diagnostic
      expect(restored.snapshotBleCmds).to.deep.equal(original.snapshotBleCmds);
      expect(restored.scenesChecked).to.equal(original.scenesChecked);
      expect(restored.lastSeenOnNetwork).to.equal(original.lastSeenOnNetwork);
    });

    it("normalize drops segmentCount=0, manualMode=false, sceneSpeed=0 from the cache", () => {
      const original = makeFullDevice();
      original.segmentCount = 0;
      original.manualMode = false;
      original.manualSegments = [];
      original.sceneSpeed = 0;
      const cached = goveeDeviceToCached(original);
      expect(cached.segmentCount).to.equal(undefined);
      expect(cached.manualMode).to.equal(undefined);
      expect(cached.manualSegments).to.equal(undefined);
      expect(cached.sceneSpeed).to.equal(undefined);
    });
  });
});
