import { vi } from "vitest";
import { GoveeApiClient, parseLastData, parseSettings } from "./govee-api-client";
import { httpsRequest } from "./http-client";

// The scene / music / DIY library walkers call the module-level httpsRequest
// (no DI), so mock it to drive walkCategories + the per-walker extraction.
vi.mock("./http-client", () => ({ httpsRequest: vi.fn() }));
const mockHttp = vi.mocked(httpsRequest);

const apiLog = {
  silly: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  level: "debug",
} as unknown as ioBroker.Logger;

/** Wrap a parsed body as the HttpResult envelope the walkers read via `result.value`. */
function httpOk(data: unknown) {
  return { value: data, statusCode: 200 } as never;
}

/**
 * App-API parser tests — parseLastData/parseSettings are pure helpers that
 * decode the JSON-in-JSON Govee returns from
 * `POST /device/rest/devices/v1/list`. They live in govee-api-client.ts
 * (same module as the unified GoveeApiClient class).
 *
 * Capability-synthesis tests (`buildCapabilitiesFromAppEntry`) follow in
 * session 6 once the device-manager learns to consume App-API payloads.
 */
describe("AppApiClient — lastDeviceData parser", () => {
  it("parses the full H5179 payload captured from /device/rest/devices/v1/list", () => {
    const raw = '{"online":true,"tem":2370,"hum":4290,"lastTime":1776704461000}';
    const out = parseLastData(raw);
    expect(out).toEqual({
      online: true,
      tem: 2370,
      hum: 4290,
      lastTime: 1776704461000,
    });
  });

  it("accepts numeric online=1/0 (older firmware variants)", () => {
    expect(parseLastData('{"online":1,"tem":100}')).toEqual(expect.objectContaining({ online: true }));
    expect(parseLastData('{"online":0}')).toEqual(expect.objectContaining({ online: false }));
  });

  it("ignores unexpected types for each field", () => {
    const raw = '{"online":"yes","tem":"warm","hum":4290}';
    const out = parseLastData(raw);
    expect(out).toEqual({ hum: 4290 });
  });

  it("ignores NaN/Infinity in tem/hum", () => {
    expect(parseLastData('{"tem":null,"hum":null}')).toEqual({});
  });

  it("returns undefined on malformed JSON", () => {
    expect(parseLastData("not json")).toBe(undefined);
    expect(parseLastData("")).toBe(undefined);
    expect(parseLastData(undefined)).toBe(undefined);
  });

  it("preserves battery when present", () => {
    expect(parseLastData('{"battery":75,"tem":2000}')).toEqual(expect.objectContaining({ battery: 75 }));
  });
});

describe("AppApiClient — deviceSettings parser", () => {
  it("parses the captured H5179 settings payload", () => {
    const raw =
      '{"uploadRate":10,"temMin":-2000,"battery":100,"wifiName":"krobisnet","temMax":6000,"humMin":0,"humMax":10000,"fahOpen":false}';
    const out = parseSettings(raw);
    expect(out).toEqual(
      expect.objectContaining({
        uploadRate: 10,
        temMin: -2000,
        battery: 100,
        wifiName: "krobisnet",
        fahOpen: false,
      }),
    );
  });

  it("returns undefined on malformed input", () => {
    expect(parseSettings("not json")).toBe(undefined);
    expect(parseSettings(undefined)).toBe(undefined);
    expect(parseSettings("")).toBe(undefined);
  });
});

// D4 — the scene/music/DIY walkers share walkCategories. These exercise the
// refactored branches: multi-variant naming, the no-effects scene-level code,
// speedInfo carry-through, the defensive guards, the music modeIdx counter and
// the bearer-token gate. Previously the walkers had zero coverage repo-wide.
describe("GoveeApiClient — library walkers (walkCategories)", () => {
  beforeEach(() => mockHttp.mockReset());

  describe("fetchSceneLibrary", () => {
    it("expands multi-variant scenes into Name-suffix entries", async () => {
      mockHttp.mockResolvedValue(
        httpOk({
          data: {
            categories: [
              {
                scenes: [
                  {
                    sceneName: "Aurora",
                    lightEffects: [
                      { sceneCode: 10, scenceName: "A", scenceParam: "p1" },
                      { sceneCode: 11, scenceName: "B", scenceParam: "p2" },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      );
      const scenes = await new GoveeApiClient(apiLog).fetchSceneLibrary("H61BE");
      expect(scenes).toEqual([
        { name: "Aurora-A", sceneCode: 10, scenceParam: "p1" },
        { name: "Aurora-B", sceneCode: 11, scenceParam: "p2" },
      ]);
    });

    it("uses the scene-level code when there are no lightEffects", async () => {
      mockHttp.mockResolvedValue(
        httpOk({ data: { categories: [{ scenes: [{ sceneName: "Solid", sceneCode: 42, lightEffects: [] }] }] } }),
      );
      expect(await new GoveeApiClient(apiLog).fetchSceneLibrary("H61BE")).toEqual([{ name: "Solid", sceneCode: 42 }]);
    });

    it("carries speedInfo only when supSpeed is true", async () => {
      mockHttp.mockResolvedValue(
        httpOk({
          data: {
            categories: [
              {
                scenes: [
                  {
                    sceneName: "Fast",
                    lightEffects: [{ sceneCode: 5, speedInfo: { supSpeed: true, speedIndex: 2, config: "cfg" } }],
                  },
                ],
              },
            ],
          },
        }),
      );
      const scenes = await new GoveeApiClient(apiLog).fetchSceneLibrary("H61BE");
      expect(scenes[0].speedInfo).toEqual({ supSpeed: true, speedIndex: 2, config: "cfg" });
    });

    it("skips non-string sceneNames and codes <= 0 (walkCategories guards)", async () => {
      mockHttp.mockResolvedValue(
        httpOk({
          data: {
            categories: [
              null,
              { scenes: "nope" },
              {
                scenes: [
                  { sceneName: 123, lightEffects: [{ sceneCode: 9 }] },
                  { sceneName: "", lightEffects: [{ sceneCode: 9 }] },
                  { sceneName: "Zero", lightEffects: [{ sceneCode: 0 }] },
                  { sceneName: "Keep", lightEffects: [{ sceneCode: 7 }] },
                ],
              },
            ],
          },
        }),
      );
      expect(await new GoveeApiClient(apiLog).fetchSceneLibrary("H61BE")).toEqual([{ name: "Keep", sceneCode: 7 }]);
    });

    it("returns [] for a non-array categories payload", async () => {
      mockHttp.mockResolvedValue(httpOk({ data: { categories: "broken" } }));
      expect(await new GoveeApiClient(apiLog).fetchSceneLibrary("H61BE")).toEqual([]);
    });
  });

  describe("fetchMusicLibrary", () => {
    it("returns [] without a bearer token (auth-gated)", async () => {
      const modes = await new GoveeApiClient(apiLog).fetchMusicLibrary("H61BE");
      expect(modes).toEqual([]);
      expect(mockHttp).not.toHaveBeenCalled();
    });

    it("assigns an incrementing mode index per scene and uses lightEffects[0]", async () => {
      mockHttp.mockResolvedValue(
        httpOk({
          data: {
            categories: [
              {
                scenes: [
                  { sceneName: "Energic", lightEffects: [{ sceneCode: 20, scenceParam: "m1" }] },
                  { sceneName: "Spectrum", sceneCode: 21, lightEffects: [] },
                ],
              },
            ],
          },
        }),
      );
      const client = new GoveeApiClient(apiLog);
      client.setBearerToken("tok");
      expect(await client.fetchMusicLibrary("H61BE")).toEqual([
        { name: "Energic", musicCode: 20, scenceParam: "m1", mode: 0 },
        { name: "Spectrum", musicCode: 21, mode: 1 },
      ]);
    });
  });

  describe("fetchDiyLibrary", () => {
    it("returns [] without a bearer token (auth-gated)", async () => {
      expect(await new GoveeApiClient(apiLog).fetchDiyLibrary("H61BE")).toEqual([]);
    });

    it("parses diy codes from lightEffects[0]", async () => {
      mockHttp.mockResolvedValue(
        httpOk({
          data: {
            categories: [{ scenes: [{ sceneName: "MyDIY", lightEffects: [{ sceneCode: 30, scenceParam: "d1" }] }] }],
          },
        }),
      );
      const client = new GoveeApiClient(apiLog);
      client.setBearerToken("tok");
      expect(await client.fetchDiyLibrary("H61BE")).toEqual([{ name: "MyDIY", diyCode: 30, scenceParam: "d1" }]);
    });
  });
});
