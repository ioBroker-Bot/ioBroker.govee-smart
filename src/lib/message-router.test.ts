import { MessageRouter, type MessageRouterHost } from "./message-router";
import type { GoveeMqttClient } from "./govee-mqtt-client";

const mockLog = {
  silly: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  level: "info",
} as unknown as ioBroker.Logger;

interface FakeProbeOpts {
  /** When set, simulate a successful login + connected state. */
  connected?: boolean;
  /** Throw this error from probe.connect (overrides connected). */
  connectError?: Error;
  /** Throw this from probe.requestVerificationCode. */
  requestError?: Error;
}

function makeProbe(opts: FakeProbeOpts): GoveeMqttClient {
  const probe = {
    setVerificationCode: (_code: string) => {},
    disconnect: () => {},
    requestVerificationCode: async (): Promise<void> => {
      if (opts.requestError) {
        throw opts.requestError;
      }
    },
    connect: async (
      _onStatus: unknown,
      onConnection: (connected: boolean) => void,
    ): Promise<void> => {
      if (opts.connectError) {
        throw opts.connectError;
      }
      // Simulate the "connect" event firing during connect()
      if (opts.connected) {
        onConnection(true);
      }
    },
  } as unknown as GoveeMqttClient;
  return probe;
}

interface RecordedResponse {
  obj: ioBroker.Message;
  data: unknown;
}

function makeHost(opts: {
  email?: string;
  password?: string;
  segmentDevices?: Array<{ value: string; label: string }>;
  wizardResponse?: Record<string, unknown>;
  probe?: GoveeMqttClient;
}): { host: MessageRouterHost; responses: RecordedResponse[] } {
  const responses: RecordedResponse[] = [];
  const host: MessageRouterHost = {
    log: mockLog,
    getConfig: () => ({
      goveeEmail: opts.email ?? "user@example.com",
      goveePassword: opts.password ?? "password",
      mqttVerificationCode: "",
    }),
    sendResponse: (obj, data) => responses.push({ obj, data }),
    createMqttProbeClient: () => opts.probe ?? makeProbe({ connected: false }),
    getSegmentDeviceList: () => opts.segmentDevices ?? [],
    runWizardStep: () => Promise.resolve(opts.wizardResponse ?? { ok: true }),
  };
  return { host, responses };
}

function makeMessage(command: string, message?: unknown): ioBroker.Message {
  return {
    command,
    message: message as never,
    from: "system.adapter.test.0",
    callback: { id: 1 } as unknown as ioBroker.Message["callback"],
    _id: 1,
  } as ioBroker.Message;
}

describe("MessageRouter", () => {
  describe("getSegmentDevices", () => {
    it("forwards the host's device list verbatim", async () => {
      const list = [
        { value: "H6160:AA:01", label: "Strip 1" },
        { value: "H6160:AA:02", label: "Strip 2" },
      ];
      const { host, responses } = makeHost({ segmentDevices: list });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("getSegmentDevices"));
      // Allow the catch-then chain to settle (sync in fact)
      await new Promise(r => setTimeout(r, 0));
      expect(responses).toHaveLength(1);
      expect(responses[0].data).toEqual(list);
    });

    it("returns empty list when host has no segment-capable devices", async () => {
      const { host, responses } = makeHost({ segmentDevices: [] });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("getSegmentDevices"));
      await new Promise(r => setTimeout(r, 0));
      expect(responses[0].data).toEqual([]);
    });
  });

  describe("segmentWizard", () => {
    it("forwards action+device payload to runWizardStep and returns the result", async () => {
      const { host, responses } = makeHost({
        wizardResponse: { progress: "Segment 1", active: true },
      });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("segmentWizard", { action: "start", device: "H6160:AA:01" }));
      await new Promise(r => setTimeout(r, 0));
      expect(responses).toHaveLength(1);
      expect(responses[0].data).toEqual({ progress: "Segment 1", active: true });
    });

    it("handles missing payload gracefully (defaults action='', device='')", async () => {
      const { host, responses } = makeHost({ wizardResponse: { error: "no action" } });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("segmentWizard"));
      await new Promise(r => setTimeout(r, 0));
      expect(responses[0].data).toEqual({ error: "no action" });
    });
  });

  describe("mqttAuth — test action", () => {
    it("returns success message when probe connects", async () => {
      const { host, responses } = makeHost({ probe: makeProbe({ connected: true }) });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      expect(responses).toHaveLength(1);
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("erfolgreich");
    });

    it("returns 2FA hint on Verification required error", async () => {
      const probe = makeProbe({ connectError: new Error("Verification required by Govee") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("2-Faktor");
    });

    it("returns invalid-code hint on Verification code invalid", async () => {
      const probe = makeProbe({ connectError: new Error("Verification code invalid or expired") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("ungültig");
    });

    it("returns email-not-registered on matching error", async () => {
      const probe = makeProbe({ connectError: new Error("Login failed: email not registered") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("nicht registriert");
    });

    it("returns rate-limit hint", async () => {
      const probe = makeProbe({ connectError: new Error("Rate limited by Govee") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("Rate-Limit");
    });

    it("returns account-locked hint", async () => {
      const probe = makeProbe({ connectError: new Error("Account temporarily locked by Govee") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("gesperrt");
    });

    it("rejects when email or password missing", async () => {
      const { host, responses } = makeHost({ email: "", password: "" });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "test" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("Email + Passwort");
    });
  });

  describe("mqttAuth — requestCode action", () => {
    it("succeeds and returns confirmation message", async () => {
      const { host, responses } = makeHost({ probe: makeProbe({ connected: true }) });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "requestCode" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("Code wurde an");
    });

    it("throttles double-click within 30s window", async () => {
      const { host, responses } = makeHost({ probe: makeProbe({ connected: true }) });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "requestCode" }));
      await new Promise(r => setTimeout(r, 10));
      router.onMessage(makeMessage("mqttAuth", { action: "requestCode" }));
      await new Promise(r => setTimeout(r, 10));
      expect(responses).toHaveLength(2);
      const second = responses[1].data as { result: string };
      expect(second.result).toContain("warten");
    });

    it("surfaces Govee rejection on requestVerificationCode error", async () => {
      const probe = makeProbe({ requestError: new Error("Govee rejected") });
      const { host, responses } = makeHost({ probe });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "requestCode" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("abgelehnt");
    });
  });

  describe("unknown commands", () => {
    it("ignores commands with no command field", () => {
      const { host, responses } = makeHost({});
      const router = new MessageRouter(host);
      router.onMessage({ command: "" } as ioBroker.Message);
      expect(responses).toHaveLength(0);
    });

    it("returns 'Unbekannte Aktion' for unknown mqttAuth action", async () => {
      const { host, responses } = makeHost({ probe: makeProbe({ connected: true }) });
      const router = new MessageRouter(host);
      router.onMessage(makeMessage("mqttAuth", { action: "weirdAction" }));
      await new Promise(r => setTimeout(r, 10));
      const r = responses[0].data as { result: string };
      expect(r.result).toContain("Unbekannte Aktion");
    });
  });
});
