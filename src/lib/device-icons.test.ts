import { GROUP_ICON, iconForGoveeType, shortenGoveeType } from "./device-icons";
import { GOVEE_DEVICE_TYPE } from "./govee-constants";

describe("device-icons", () => {
  describe("iconForGoveeType", () => {
    it("returns a base64 svg data-URI for every known device type", () => {
      for (const t of Object.values(GOVEE_DEVICE_TYPE)) {
        expect(iconForGoveeType(t)).toMatch(/^data:image\/svg\+xml;base64,/);
      }
    });

    it("maps thermometer and sensor to the same icon", () => {
      expect(iconForGoveeType(GOVEE_DEVICE_TYPE.SENSOR)).toBe(iconForGoveeType(GOVEE_DEVICE_TYPE.THERMOMETER));
    });

    it("maps humidifier and dehumidifier to the same icon", () => {
      expect(iconForGoveeType(GOVEE_DEVICE_TYPE.DEHUMIDIFIER)).toBe(iconForGoveeType(GOVEE_DEVICE_TYPE.HUMIDIFIER));
    });

    it("falls back to the light icon for unknown / undefined types", () => {
      expect(iconForGoveeType(undefined)).toBe(iconForGoveeType(GOVEE_DEVICE_TYPE.LIGHT));
      expect(iconForGoveeType("devices.types.something_new")).toBe(iconForGoveeType(GOVEE_DEVICE_TYPE.LIGHT));
    });

    it("GROUP_ICON is a distinct data-URI (not the light fallback)", () => {
      expect(GROUP_ICON).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(GROUP_ICON).not.toBe(iconForGoveeType(GOVEE_DEVICE_TYPE.LIGHT));
    });
  });

  describe("shortenGoveeType", () => {
    it("strips the devices.types. prefix", () => {
      expect(shortenGoveeType("devices.types.light")).toBe("light");
      expect(shortenGoveeType("devices.types.air_purifier")).toBe("air_purifier");
    });

    it("returns 'unknown' for missing / non-string / prefix-only input", () => {
      expect(shortenGoveeType(undefined)).toBe("unknown");
      expect(shortenGoveeType("")).toBe("unknown");
      expect(shortenGoveeType(42 as never)).toBe("unknown");
      expect(shortenGoveeType("devices.types.")).toBe("unknown");
    });
  });
});
