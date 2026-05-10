import { expect } from "chai";
import { CommandRouter } from "./command-router";
import type { GoveeCloudClient } from "./govee-cloud-client";
import type { GoveeLanClient } from "./govee-lan-client";
import type { RateLimiter } from "./rate-limiter";
import { mockLog } from "./test-helpers";
import type { GoveeDevice, TimerAdapter } from "./types";

interface LanCall {
  method: string;
  args: unknown[];
}

function makeLanStub(): { client: GoveeLanClient; calls: LanCall[] } {
  const calls: LanCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  const client = {
    setPower: record("setPower"),
    setBrightness: record("setBrightness"),
    setColor: record("setColor"),
    setColorTemperature: record("setColorTemperature"),
    setScene: record("setScene"),
    setDiyScene: record("setDiyScene"),
    setMusicMode: record("setMusicMode"),
    setGradient: record("setGradient"),
    setSegmentColor: record("setSegmentColor"),
    setSegmentBrightness: record("setSegmentBrightness"),
    sendPtReal: record("sendPtReal"),
    requestStatus: record("requestStatus"),
  } as unknown as GoveeLanClient;
  return { client, calls };
}

interface CloudCall {
  sku: string;
  device: string;
  capabilityType: string;
  instance: string;
  value: unknown;
}

function makeCloudStub(throwOn?: string): { client: GoveeCloudClient; calls: CloudCall[] } {
  const calls: CloudCall[] = [];
  const client = {
    controlDevice: (sku: string, device: string, capabilityType: string, instance: string, value: unknown) => {
      calls.push({ sku, device, capabilityType, instance, value });
      if (throwOn === capabilityType) {
        return Promise.reject(new Error(`stub-throw on ${capabilityType}`));
      }
      return Promise.resolve();
    },
  } as unknown as GoveeCloudClient;
  return { client, calls };
}

function makeRateLimiter(): RateLimiter {
  // Direct-pass implementation — tests don't need queueing semantics here,
  // just "runs the callback inline".
  return {
    tryExecute: async (fn: () => Promise<void>): Promise<boolean> => {
      await fn();
      return true;
    },
  } as unknown as RateLimiter;
}

const noopTimers: TimerAdapter = {
  setInterval: () => undefined,
  clearInterval: () => undefined,
  setTimeout: (cb): ioBroker.Timeout | undefined => {
    cb();
    return undefined;
  },
  clearTimeout: () => undefined,
};

function makeDevice(overrides: Partial<GoveeDevice> = {}): GoveeDevice {
  return {
    sku: "H6160",
    deviceId: "AA:BB:CC:DD:EE:01",
    name: "Test Light",
    type: "devices.types.light",
    capabilities: [
      { type: "devices.capabilities.on_off", instance: "powerSwitch" },
      { type: "devices.capabilities.range", instance: "brightness" },
      { type: "devices.capabilities.color_setting", instance: "colorRgb" },
      { type: "devices.capabilities.color_setting", instance: "colorTemperatureK" },
      { type: "devices.capabilities.dynamic_scene", instance: "lightScene" },
      { type: "devices.capabilities.dynamic_scene", instance: "diyScene" },
      { type: "devices.capabilities.dynamic_scene", instance: "snapshot" },
      { type: "devices.capabilities.segment_color_setting", instance: "segmentedColorRgb" },
      { type: "devices.capabilities.segment_color_setting", instance: "segmentedBrightness" },
      { type: "devices.capabilities.mode", instance: "presetScene" },
    ],
    scenes: [{ name: "Aurora", value: { paramId: 1 } }],
    diyScenes: [{ name: "MyDiy", value: { paramId: 2 } }],
    snapshots: [{ name: "Snap1", value: 7 }],
    sceneLibrary: [],
    musicLibrary: [],
    diyLibrary: [],
    skuFeatures: null,
    state: { online: true },
    channels: { lan: true, mqtt: false, cloud: true },
    lanIp: "192.168.1.42",
    segmentCount: 10,
    ...overrides,
  };
}

describe("CommandRouter", () => {
  describe("sendCommand — LAN priority", () => {
    it("routes power to LAN setPower when device has lanIp", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "power", true);
      expect(lan.calls).to.have.length(1);
      expect(lan.calls[0].method).to.equal("setPower");
      expect(lan.calls[0].args).to.deep.equal(["192.168.1.42", true]);
    });

    it("routes brightness to LAN setBrightness", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "brightness", 75);
      expect(lan.calls[0].method).to.equal("setBrightness");
      expect(lan.calls[0].args).to.deep.equal(["192.168.1.42", 75]);
    });

    it("routes colorRgb to LAN setColor with hex parsed to rgb", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "colorRgb", "#FF6600");
      expect(lan.calls[0].method).to.equal("setColor");
      expect(lan.calls[0].args).to.deep.equal(["192.168.1.42", 0xff, 0x66, 0x00]);
    });

    it("routes colorTemperature to LAN setColorTemperature", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "colorTemperature", 4000);
      expect(lan.calls[0].method).to.equal("setColorTemperature");
      expect(lan.calls[0].args).to.deep.equal(["192.168.1.42", 4000]);
    });

    it("routes gradientToggle to LAN setGradient", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "gradientToggle", true);
      expect(lan.calls[0].method).to.equal("setGradient");
      expect(lan.calls[0].args).to.deep.equal(["192.168.1.42", true]);
    });
  });

  describe("sendCommand — Cloud fallback", () => {
    it("routes to Cloud when device has no lanIp", async () => {
      const cloud = makeCloudStub();
      const limiter = makeRateLimiter();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setCloudClient(cloud.client);
      router.setRateLimiter(limiter);
      const device = makeDevice({ lanIp: undefined });
      await router.sendCommand(device, "power", true);
      expect(cloud.calls).to.have.length(1);
      expect(cloud.calls[0].instance).to.equal("powerSwitch");
      expect(cloud.calls[0].value).to.equal(1);
    });

    it("debug-logs without warn when Cloud client not yet ready (init-race)", async () => {
      const router = new CommandRouter(mockLog, noopTimers);
      // No lanClient, no cloudClient — but channel says cloud:true (init-race)
      const device = makeDevice({ lanIp: undefined, channels: { lan: false, mqtt: false, cloud: true } });
      await router.sendCommand(device, "power", true);
      // No throw — false alarm dropped at debug level
    });

    it("warns when no channel available at all", async () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const device = makeDevice({ lanIp: undefined, channels: { lan: false, mqtt: false, cloud: false } });
      await router.sendCommand(device, "power", true);
      // No throw — warn fired but no exception bubbles
    });
  });

  describe("segmentColor / segmentBrightness routing", () => {
    it("routes segmentColor:N to LAN setColor + setSegmentColor (forceColorMode + ptReal)", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "segmentColor:3", "#0000FF");
      // forceColorMode sends a setColor first
      const setColorCall = lan.calls.find(c => c.method === "setColor");
      expect(setColorCall).to.exist;
      const segColorCall = lan.calls.find(c => c.method === "setSegmentColor");
      expect(segColorCall).to.exist;
      expect(segColorCall!.args).to.deep.equal(["192.168.1.42", 0x00, 0x00, 0xff, [3]]);
    });

    it("routes segmentBrightness:N to setSegmentBrightness", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "segmentBrightness:5", 50);
      const segBrightCall = lan.calls.find(c => c.method === "setSegmentBrightness");
      expect(segBrightCall).to.exist;
      expect(segBrightCall!.args).to.deep.equal(["192.168.1.42", 50, [5]]);
    });

    it("rejects negative segment index", async () => {
      const lan = makeLanStub();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setLanClient(lan.client);
      await router.sendCommand(makeDevice(), "segmentColor:-1", "#FF0000");
      expect(lan.calls).to.have.length(0);
    });
  });

  describe("parseSegmentBatch", () => {
    it("parses range syntax (0-5:#ff0000:50)", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.parseSegmentBatch(makeDevice(), "0-5:#ff0000:50");
      expect(result).to.deep.equal({ segments: [0, 1, 2, 3, 4, 5], color: 0xff0000, brightness: 50 });
    });

    it("parses comma-list (0,3,7:#00ff00:100)", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.parseSegmentBatch(makeDevice(), "0,3,7:#00ff00:100");
      expect(result).to.deep.equal({ segments: [0, 3, 7], color: 0x00ff00, brightness: 100 });
    });

    it("parses 'all' to expanded indices", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.parseSegmentBatch(makeDevice({ segmentCount: 4 }), "all:#ffffff:75");
      expect(result?.segments).to.deep.equal([0, 1, 2, 3]);
    });

    it("respects manualSegments (cut-strip)", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const device = makeDevice({ manualMode: true, manualSegments: [0, 2, 4] });
      const result = router.parseSegmentBatch(device, "all:#ff0000:50");
      expect(result?.segments).to.deep.equal([0, 2, 4]);
    });

    it("filters out-of-range indices", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const device = makeDevice({ segmentCount: 5 });
      const result = router.parseSegmentBatch(device, "3-10:#ff0000:50");
      expect(result?.segments).to.deep.equal([3, 4]);
    });

    it("returns null for empty/invalid input", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.parseSegmentBatch(makeDevice(), "")).to.be.null;
      expect(router.parseSegmentBatch(makeDevice(), "::100")).to.be.null;
    });

    it("returns null when neither color nor brightness given", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.parseSegmentBatch(makeDevice(), "0-5")).to.be.null;
    });

    it("accepts brightness-only (no color)", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.parseSegmentBatch(makeDevice(), "0-3::25");
      expect(result).to.deep.equal({ segments: [0, 1, 2, 3], color: undefined, brightness: 25 });
    });

    it("rejects brightness above 100", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.parseSegmentBatch(makeDevice(), "0-3::150");
      expect(result?.brightness).to.be.undefined;
    });

    it("rejects non-string input", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.parseSegmentBatch(makeDevice(), 42 as unknown as string)).to.be.null;
    });
  });

  describe("toCloudValue", () => {
    it("converts power true → 1, false → 0", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.toCloudValue(makeDevice(), "power", true)).to.equal(1);
      expect(router.toCloudValue(makeDevice(), "power", false)).to.equal(0);
    });

    it("converts colorRgb hex to packed int", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.toCloudValue(makeDevice(), "colorRgb", "#FF6600")).to.equal(0xff6600);
    });

    it("resolves lightScene index to value payload", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.toCloudValue(makeDevice(), "lightScene", "1");
      expect(result).to.deep.equal({ paramId: 1 });
    });

    it("resolves diyScene index", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.toCloudValue(makeDevice(), "diyScene", "1")).to.deep.equal({ paramId: 2 });
    });

    it("resolves snapshot index", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.toCloudValue(makeDevice(), "snapshot", "1")).to.equal(7);
    });

    it("returns input value for invalid scene index", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.toCloudValue(makeDevice(), "lightScene", "99")).to.equal("99");
    });

    it("converts segmentColor:N to {segment, rgb}", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.toCloudValue(makeDevice(), "segmentColor:3", "#FF0000") as {
        segment: number[];
        rgb: number;
      };
      expect(result.segment).to.deep.equal([3]);
      expect(result.rgb).to.equal(0xff0000);
    });

    it("converts segmentBrightness:N to {segment, brightness}", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const result = router.toCloudValue(makeDevice(), "segmentBrightness:7", 50);
      expect(result).to.deep.equal({ segment: [7], brightness: 50 });
    });
  });

  describe("findCapabilityForCommand", () => {
    it("matches power → on_off", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "power");
      expect(cap?.instance).to.equal("powerSwitch");
    });

    it("matches brightness → range/brightness", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "brightness");
      expect(cap?.instance).to.equal("brightness");
    });

    it("matches colorRgb → color_setting/colorRgb", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "colorRgb");
      expect(cap?.instance).to.equal("colorRgb");
    });

    it("matches lightScene → dynamic_scene/lightScene", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "lightScene");
      expect(cap?.instance).to.equal("lightScene");
    });

    it("matches segmentColor:N → segment_color_setting (NOT brightness)", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "segmentColor:0");
      expect(cap?.instance).to.equal("segmentedColorRgb");
    });

    it("matches segmentBrightness:N → segment_color_setting/brightness-flavour", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const cap = router.findCapabilityForCommand(makeDevice(), "segmentBrightness:0");
      expect(cap?.instance).to.equal("segmentedBrightness");
    });

    it("returns undefined for unknown command", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      expect(router.findCapabilityForCommand(makeDevice(), "xyz")).to.be.undefined;
    });

    it("returns undefined when capabilities is empty", () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const dev = makeDevice({ capabilities: [] });
      expect(router.findCapabilityForCommand(dev, "power")).to.be.undefined;
    });
  });

  describe("sendCapabilityCommand (generic capability route)", () => {
    it("forwards toggle as 0/1", async () => {
      const cloud = makeCloudStub();
      const limiter = makeRateLimiter();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setCloudClient(cloud.client);
      router.setRateLimiter(limiter);
      await router.sendCapabilityCommand(makeDevice(), "devices.capabilities.toggle", "gradientToggle", true);
      expect(cloud.calls).to.have.length(1);
      expect(cloud.calls[0].value).to.equal(1);
    });

    it("forwards non-toggle value verbatim", async () => {
      const cloud = makeCloudStub();
      const limiter = makeRateLimiter();
      const router = new CommandRouter(mockLog, noopTimers);
      router.setCloudClient(cloud.client);
      router.setRateLimiter(limiter);
      await router.sendCapabilityCommand(makeDevice(), "devices.capabilities.dynamic_scene", "snapshot", { v: 1 });
      expect(cloud.calls[0].value).to.deep.equal({ v: 1 });
    });

    it("no-op when Cloud not configured", async () => {
      const router = new CommandRouter(mockLog, noopTimers);
      const device = makeDevice({ channels: { lan: true, mqtt: false, cloud: false } });
      await router.sendCapabilityCommand(device, "devices.capabilities.toggle", "any", true);
      // Just verifies no throw
    });
  });
});
