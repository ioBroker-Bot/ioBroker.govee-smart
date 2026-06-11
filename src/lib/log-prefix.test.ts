import { installLogPrefix, type ChannelStatusSnapshot } from "./log-prefix";

function makeLog(): { log: ioBroker.Logger; lines: Record<string, string[]> } {
  const lines: Record<string, string[]> = { silly: [], debug: [], info: [], warn: [], error: [] };
  const log = {
    silly: (m: string) => lines.silly.push(m),
    debug: (m: string) => lines.debug.push(m),
    info: (m: string) => lines.info.push(m),
    warn: (m: string) => lines.warn.push(m),
    error: (m: string) => lines.error.push(m),
    level: "debug",
  } as unknown as ioBroker.Logger;
  return { log, lines };
}

describe("installLogPrefix", () => {
  const snap: ChannelStatusSnapshot = { lan: "on", cloud: "off", mqtt: "n/a", openapi: "n/a" };

  it("prefixes debug and silly lines with the channel status", () => {
    const { log, lines } = makeLog();
    installLogPrefix(log, () => snap);
    log.debug("scan sent");
    log.silly("raw bytes");
    expect(lines.debug[0]).toBe("[LAN=on Cloud=off MQTT=n/a OpenAPI=n/a] scan sent");
    expect(lines.silly[0]).toBe("[LAN=on Cloud=off MQTT=n/a OpenAPI=n/a] raw bytes");
  });

  it("leaves info/warn/error untouched — user-facing lines stay clean", () => {
    const { log, lines } = makeLog();
    installLogPrefix(log, () => snap);
    log.info("adapter ready");
    log.warn("cloud failed");
    log.error("boom");
    expect(lines.info[0]).toBe("adapter ready");
    expect(lines.warn[0]).toBe("cloud failed");
    expect(lines.error[0]).toBe("boom");
  });

  it("pulls the snapshot at log-call time, not install time", () => {
    const { log, lines } = makeLog();
    const live: ChannelStatusSnapshot = { lan: "off", cloud: "n/a", mqtt: "n/a", openapi: "n/a" };
    installLogPrefix(log, () => live);
    log.debug("before");
    live.lan = "on";
    log.debug("after");
    expect(lines.debug[0]).toContain("[LAN=off");
    expect(lines.debug[1]).toContain("[LAN=on");
  });

  it("is idempotent — a second install must not double the prefix", () => {
    const { log, lines } = makeLog();
    installLogPrefix(log, () => snap);
    installLogPrefix(log, () => snap);
    log.debug("once");
    expect(lines.debug[0]).toBe("[LAN=on Cloud=off MQTT=n/a OpenAPI=n/a] once");
    expect(lines.debug[0].match(/\[LAN=/g)).toHaveLength(1);
  });
});
