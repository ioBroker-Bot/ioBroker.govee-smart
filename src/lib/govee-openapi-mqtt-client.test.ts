import { vi } from "vitest";
import { GoveeOpenapiMqttClient } from "./govee-openapi-mqtt-client";

/**
 * Lifecycle tests for the OpenAPI-MQTT client (constructor + disconnect) plus
 * the connect/subscribe/reconnect paths inherited from ReconnectingMqttClient.
 *
 * The client calls mqtt.connect() directly (no DI), so the module is mocked
 * with a minimal fake client whose events the test drives by hand.
 */

const mqttMock = vi.hoisted(() => {
  interface FakeClient {
    connected: boolean;
    ended: boolean | null;
    on(ev: string, cb: () => void): FakeClient;
    emit(ev: string): void;
    subscribe(topic: string, opts: unknown, cb: (e: Error | null) => void): void;
    end(force: boolean): void;
    removeAllListeners(): FakeClient;
  }
  const clients: FakeClient[] = [];
  let subscribeBehavior: (cb: (e: Error | null) => void) => void = cb => cb(null);
  return {
    connect: (): FakeClient => {
      const handlers: Record<string, (() => void) | undefined> = {};
      const c: FakeClient = {
        connected: false,
        ended: null,
        on(ev, cb) {
          handlers[ev] = cb;
          return c;
        },
        emit(ev) {
          handlers[ev]?.();
        },
        subscribe(_topic, _opts, cb) {
          subscribeBehavior(cb);
        },
        end(force) {
          c.ended = force;
        },
        removeAllListeners() {
          for (const k of Object.keys(handlers)) {
            delete handlers[k];
          }
          return c;
        },
      };
      clients.push(c);
      return c;
    },
    clients,
    setSubscribeBehavior: (fn: (cb: (e: Error | null) => void) => void) => {
      subscribeBehavior = fn;
    },
    reset: () => {
      clients.length = 0;
      subscribeBehavior = cb => cb(null);
    },
  };
});

vi.mock("mqtt", () => ({ connect: () => mqttMock.connect() }));

const mockLog: ioBroker.Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  silly: () => {},
  level: "debug",
};

const mockTimers = {
  setInterval: () => undefined,
  clearInterval: () => {},
  setTimeout: () => undefined,
  clearTimeout: () => {},
  delay: () => Promise.resolve(),
};

describe("GoveeOpenapiMqttClient", () => {
  describe("constructor", () => {
    it("creates a client with the given API key", () => {
      const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as never);
      expect(client).toBeDefined();
      expect(client.connected).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("handles disconnect when not connected", () => {
      const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as never);
      expect(() => client.disconnect()).not.toThrow();
    });

    it("leaves the connected flag false after disconnect", () => {
      const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as never);
      client.disconnect();
      expect(client.connected).toBe(false);
    });
  });

  describe("session ID stability", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    it("generates a UUID-shaped session id once per instance", () => {
      const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as never);
      const sid = (client as unknown as { sessionUuid: string }).sessionUuid;
      expect(sid).toMatch(UUID_RE);
    });

    it("keeps the same session id for the lifetime of the instance", () => {
      const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as never);
      const before = (client as unknown as { sessionUuid: string }).sessionUuid;
      // Simulate adapter activity that previously rotated the id
      client.disconnect();
      const after = (client as unknown as { sessionUuid: string }).sessionUuid;
      expect(after).toBe(before);
    });

    it("uses a different session id per client instance", () => {
      const a = new GoveeOpenapiMqttClient("k", mockLog, mockTimers as never);
      const b = new GoveeOpenapiMqttClient("k", mockLog, mockTimers as never);
      const sa = (a as unknown as { sessionUuid: string }).sessionUuid;
      const sb = (b as unknown as { sessionUuid: string }).sessionUuid;
      expect(sa).not.toBe(sb);
    });
  });

  describe("connect / subscribe / reconnect (base scaffolding wiring)", () => {
    function makeCapturingTimers() {
      const scheduled: Array<() => void> = [];
      const timers = {
        setInterval: () => undefined,
        clearInterval: () => {},
        setTimeout: (cb: () => void) => {
          scheduled.push(cb);
          return scheduled.length;
        },
        clearTimeout: () => {},
        delay: () => Promise.resolve(),
      } as never;
      return { timers, scheduled };
    }

    beforeEach(() => mqttMock.reset());

    it("subscribes on connect and reports onConnection(true)", () => {
      const t = makeCapturingTimers();
      const client = new GoveeOpenapiMqttClient("key", mockLog, t.timers);
      let connFlag: boolean | null = null;
      client.connect(
        () => {},
        c => {
          connFlag = c;
        },
      );
      mqttMock.clients[0].emit("connect"); // → subscribe (default success) → onConnection(true)
      expect(connFlag).toBe(true);
      client.disconnect();
    });

    it("forces a close and does NOT report connected when subscribe fails", () => {
      mqttMock.setSubscribeBehavior(cb => cb(new Error("policy denied")));
      const t = makeCapturingTimers();
      const client = new GoveeOpenapiMqttClient("key", mockLog, t.timers);
      let connFlag: boolean | null = null;
      client.connect(
        () => {},
        c => {
          connFlag = c;
        },
      );
      const fake = mqttMock.clients[0];
      fake.emit("connect");
      expect(fake.ended).toBe(true); // forced close so the close-handler can reconnect
      expect(connFlag).toBeNull(); // onConnection(true) was NOT called
      client.disconnect();
    });

    it("re-enters connect() when the backoff timer fires after a close", () => {
      const t = makeCapturingTimers();
      const client = new GoveeOpenapiMqttClient("key", mockLog, t.timers);
      client.connect(
        () => {},
        () => {},
      );
      expect(mqttMock.clients).toHaveLength(1);
      mqttMock.clients[0].emit("close"); // → scheduleReconnect → backoff timer armed
      expect(t.scheduled).toHaveLength(1);
      t.scheduled[0](); // fire → base → reconnect() → connect() again
      expect(mqttMock.clients).toHaveLength(2); // second mqtt.connect = reconnect proven
      client.disconnect();
    });

    it("does not re-enter connect() when the timer fires after disconnect()", () => {
      const t = makeCapturingTimers();
      const client = new GoveeOpenapiMqttClient("key", mockLog, t.timers);
      client.connect(
        () => {},
        () => {},
      );
      mqttMock.clients[0].emit("close");
      expect(t.scheduled).toHaveLength(1);
      client.disconnect(); // disposed = true
      t.scheduled[0](); // stale timer fires
      expect(mqttMock.clients).toHaveLength(1); // no second connect — disposed guard held
    });
  });
});
