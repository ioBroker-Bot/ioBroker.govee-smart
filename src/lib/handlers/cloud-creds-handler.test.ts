import { cleanupLegacyMqttNativeOnce, type CloudCredsAdapter } from "./cloud-creds-handler";

function makeAdapter(native: Record<string, unknown> = {}): CloudCredsAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as ioBroker.Logger,
    namespace: "govee-smart.0",
    getStateAsync: async () => null,
    setStateAsync: async id => {
      calls.push(`setState:${id}`);
    },
    getForeignObjectAsync: async () => ({ native }),
    extendForeignObjectAsync: async (_id, obj) => {
      calls.push(`extend:${JSON.stringify(obj.native)}`);
    },
    encrypt: v => v,
    decrypt: v => v,
  };
}

describe("cleanupLegacyMqttNativeOnce", () => {
  it("returns without side-effects when native is clean", async () => {
    const adapter = makeAdapter({ mqttBearerToken: "", mqttTokenExpiresAt: 0 });
    await cleanupLegacyMqttNativeOnce(adapter);
    expect(adapter.calls).toHaveLength(0);
  });

  it("returns without side-effects when legacy fields are absent", async () => {
    const adapter = makeAdapter({});
    await cleanupLegacyMqttNativeOnce(adapter);
    expect(adapter.calls).toHaveLength(0);
  });

  it("wipes dirty legacy fields via extendForeignObjectAsync", async () => {
    const adapter = makeAdapter({ mqttBearerToken: "secret", mqttP12Cert: "cert-data", mqttTokenExpiresAt: 999 });
    await cleanupLegacyMqttNativeOnce(adapter);
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toContain("extend:");
    const wiped = JSON.parse(adapter.calls[0].replace("extend:", ""));
    expect(wiped.mqttBearerToken).toBe("");
    expect(wiped.mqttP12Cert).toBe("");
    expect(wiped.mqttTokenExpiresAt).toBe(0);
  });
});
