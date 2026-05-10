/**
 * Zentrale Zeitkonstanten für den Adapter.
 *
 * Magic-Numbers vermeiden — wenn eine Konstante an mehreren Stellen
 * gebraucht wird, importiert sie hier und benennt sie eindeutig.
 *
 * Konvention: `_MS` für Millisekunden, `_S` für Sekunden, `_MIN` für Minuten.
 */

// === MQTT ===

/** Erste Backoff-Wartezeit beim MQTT-Reconnect (5 s). Verdoppelt sich bis MAX. */
export const MQTT_RECONNECT_BASE_MS = 5_000;

/** Obergrenze für MQTT-Reconnect-Backoff (5 min). */
export const MQTT_RECONNECT_MAX_MS = 300_000;

/** Maximale konsekutive Auth-Fehler bevor Reconnect permanent gestoppt wird. */
export const MQTT_MAX_AUTH_FAILURES = 3;

// === LAN ===

/** Periodisches LAN-Multicast-Scan-Intervall (30 s). */
export const LAN_SCAN_INTERVAL_MS = 30_000;

/** Wartezeit nach erstem LAN-Scan bevor lanScanDone gesetzt wird (3 s). */
export const LAN_INITIAL_WAIT_MS = 3_000;

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

// === Cloud-Retry ===

/** Wartezeit bei transientem Cloud-Fail bevor erneuter Versuch (5 min). */
export const CLOUD_RETRY_TRANSIENT_MS = 5 * 60 * 1000;

// === SKU-Cache ===

/** Maximales Alter eines Cache-Eintrags ohne LAN-Sichtung (Tage). */
export const CACHE_MAX_AGE_DAYS = 14;

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
