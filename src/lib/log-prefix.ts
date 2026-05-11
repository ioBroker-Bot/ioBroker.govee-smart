/**
 * Channel status snapshot — what's configured AND what's currently up.
 *
 * Three states per channel:
 * - "on"   configured + connection up (LAN-Discovery has seen ≥1 device,
 *          Cloud HTTP succeeded recently, MQTT/OpenAPI TCP connected)
 * - "off"  configured but connection down right now
 * - "n/a"  not configured at all (User has no credentials for this channel)
 *
 * Channels:
 * - LAN     always configured (no User-Setup). Status reflects discovery.
 * - Cloud   configured iff `config.apiKey` is set. Status reflects last call.
 * - MQTT    configured iff `config.email` AND `config.password` are set.
 * - OpenAPI configured iff `config.apiKey` is set (same credential as Cloud).
 */
export interface ChannelStatusSnapshot {
  /** LAN listener — always configured. on = device discovered recently */
  lan: "on" | "off" | "n/a";
  /** Cloud HTTP — configured if apiKey set. on = last call succeeded */
  cloud: "on" | "off" | "n/a";
  /** AWS-IoT MQTT — configured if email+password set. on = TCP up */
  mqtt: "on" | "off" | "n/a";
  /** OpenAPI MQTT — configured if apiKey set (same cred as Cloud). on = TCP up */
  openapi: "on" | "off" | "n/a";
}

/**
 * Format a snapshot as a compact log prefix. Output looks like:
 *   [LAN=on Cloud=on MQTT=off OpenAPI=n/a]
 *
 * @param snap Current channel-status snapshot from main.ts
 */
export function formatChannelPrefix(snap: ChannelStatusSnapshot): string {
  return `[LAN=${snap.lan} Cloud=${snap.cloud} MQTT=${snap.mqtt} OpenAPI=${snap.openapi}]`;
}

/**
 * Wrap the adapter's log methods so every call gets the channel-status prefix.
 *
 * Idempotent — calling installLogPrefix() twice on the same adapter wraps
 * the same originals only once (we tag the wrapped functions so the second
 * call sees them and re-uses).
 *
 * The snapshot is pulled from `getSnap()` at log-call time, so updates to
 * channel state are reflected on subsequent log lines without re-installing.
 *
 * @param log Adapter logger (typically `this.log`)
 * @param getSnap Function returning the current channel snapshot
 */
export function installLogPrefix(log: ioBroker.Logger, getSnap: () => ChannelStatusSnapshot): void {
  const wrappedTag = "__channelPrefixWrapped";
  const tagged = log as unknown as Record<string, unknown>;
  if (tagged[wrappedTag]) {
    return; // already wrapped
  }
  tagged[wrappedTag] = true;

  // Channel-prefix is a diagnostic aid — only on debug + silly. info/warn/error
  // are user-facing and stay clean. Users with loglevel=debug see the prefix
  // when they look at debug lines; loglevel=info readers don't get the clutter.
  for (const level of ["silly", "debug"] as const) {
    const orig = log[level].bind(log);
    (log as unknown as Record<string, unknown>)[level] = (msg: string): void => {
      orig(`${formatChannelPrefix(getSnap())} ${msg}`);
    };
  }
}
