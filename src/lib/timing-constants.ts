/**
 * Zentrale Zeitkonstanten für den Adapter.
 *
 * Magic-Numbers vermeiden — wenn eine Konstante an mehreren Stellen
 * gebraucht wird, importiert sie hier und benennt sie eindeutig.
 *
 * Konvention: `_MS` für Millisekunden, `_S` für Sekunden, `_MIN` für Minuten.
 */

// === MQTT ===

/** Maximale konsekutive Auth-Fehler bevor Reconnect permanent gestoppt wird. */
export const MQTT_MAX_AUTH_FAILURES = 3;

// === App-API (Sensor-Polling) ===

/** Intervall für den App-API-Poll (Sensor-Werte). 2 min. */
export const APP_API_POLL_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Verzögerung des ersten App-API-Polls nach Adapter-Start (5 s — gibt MQTT
 * Zeit für den Bearer-Login).
 */
export const APP_API_INITIAL_DELAY_MS = 5_000;

// === Adapter-Lifecycle ===

/** Hard-Timeout für Cloud-Initialisierung (60 s). */
export const READY_TIMEOUT_MS = 60_000;

/** Minimum Gap zwischen zwei `mqttAuth: requestCode` Calls (30 s). */
export const VERIFICATION_REQUEST_THROTTLE_MS = 30_000;

/** Initial wait for the first LAN-scan replies before flipping lanScanDone (3 s). */
export const LAN_SCAN_INITIAL_WAIT_MS = 3_000;

/** Multicast LAN-discovery scan interval (30 s). */
export const LAN_SCAN_INTERVAL_MS = 30_000;

/** info.online re-evaluation interval for all devices (20 s). */
export const ONLINE_SYNC_INTERVAL_MS = 20_000;

/** Safety timeout to log "ready" even if a channel is still settling (60 s). */
export const READY_SAFETY_TIMEOUT_MS = 60_000;

/** Delay after startup before reaping stale devices (30 s — lets the LAN scan settle). */
export const STALE_DEVICE_CLEANUP_DELAY_MS = 30_000;

/** Daily app-version-drift check interval (24 h). */
export const APP_VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Initial app-version-drift check delay after startup (2 min). */
export const APP_VERSION_INITIAL_DELAY_MS = 2 * 60 * 1000;

/** Fallback retry delay after a transient Cloud-load failure (5 min). */
export const TRANSIENT_RETRY_MS = 5 * 60_000;

/** Per-device diagnostics-export throttle (2 s) — guards against button spam. */
export const DIAGNOSTICS_EXPORT_THROTTLE_MS = 2_000;

// === Wizard ===

/** Idle-Timeout für den Segment-Detection-Wizard (5 min). */
export const WIZARD_IDLE_TIMEOUT_MS = 5 * 60_000;

// === LAN command-router ===

/**
 * Wartezeit zwischen `colorwc`-Modus-Wechsel und folgenden Segment-Befehlen.
 * Empirisch: ~150 ms; kürzer und Govee verschluckt das Segment-Update weil
 * das Gerät noch im Scene/Music-Modus ist.
 */
export const FORCE_COLOR_MODE_SETTLE_MS = 150;

// === Cloud Rate-Limiter ===

/**
 * Govee Cloud-API-Budget (mit Sicherheitsmargen). Govee gibt 10/min und
 * 10.000/Tag — wir halten uns auf 8/min und 9.000/Tag damit Spitzen
 * (z.B. paralleles Refresh aller Devices) nicht ins 429 laufen.
 */
export const CLOUD_FULL_LIMITS = { perMinute: 8, perDay: 9000 };

// === OpenAPI-MQTT ===

/**
 * Maximale konsekutive Auth-Fehler beim OpenAPI-MQTT-Connect bevor der
 * Reconnect permanent gestoppt wird. Govee sendet 401 wenn der API-Key
 * ungültig ist — endlosens retry würde nur Account-Lock-Risiken pflegen.
 */
export const OPENAPI_MQTT_MAX_AUTH_FAILURES = 5;
