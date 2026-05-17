import { parseLastData, parseSettings } from "./govee-api-client";

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
    expect(parseLastData('{"online":1,"tem":100}')).toEqual(
      expect.objectContaining({ online: true }),
    );
    expect(parseLastData('{"online":0}')).toEqual(
      expect.objectContaining({ online: false }),
    );
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
    expect(parseLastData('{"battery":75,"tem":2000}')).toEqual(
      expect.objectContaining({ battery: 75 }),
    );
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
