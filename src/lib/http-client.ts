import * as https from "node:https";

/**
 * Module-level keep-alive Agent — vermeidet TLS-Handshake (~200ms) pro
 * Request. maxSockets begrenzt parallele Verbindungen pro Host damit wir
 * nicht aus Versehen Govee mit 100 gleichzeitigen Calls treffen.
 */
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

/** Options for an HTTPS request */
export interface HttpRequestOptions {
  /** HTTP method */
  method: "GET" | "POST";
  /** Full URL */
  url: string;
  /** HTTP headers */
  headers: Record<string, string>;
  /** Request body (POST only, will be JSON-serialized) */
  body?: unknown;
  /** Timeout in milliseconds (default 15000) */
  timeout?: number;
  /** Optional AbortSignal — wird der Request abgebrochen sobald abort() */
  signal?: AbortSignal;
}

/**
 * Result envelope returned by every successful httpsRequest. `value` is the
 * parsed JSON; it is `null` when Govee returned an empty body or a plain-text
 * HTTP-status-line body (see `fallback`). The status code + body snippet are
 * always present so callers can debug-log without enabling silly level — this
 * closes the gap from Issue #13 where `App API .../sku-supported-feature: null`
 * gave no hint *why* it was null.
 */
export interface HttpResult<T> {
  /** Parsed JSON. `null` when fallback is `"empty"` or `"plain-text-status"`. */
  value: T | null;
  /** HTTP status code (200-399 — 4xx/5xx reject as HttpError). */
  statusCode: number;
  /**
   * Set when the response wasn't JSON. `"empty"` = empty/whitespace body
   * (some Govee endpoints return bare 200 for SKUs they don't recognise).
   * `"plain-text-status"` = body like `"403 Forbbiden"` (Govee's typo) — a
   * server-side bug observed for some SKU/bearer combinations.
   */
  fallback?: "empty" | "plain-text-status";
  /**
   * First ~100 chars of the body when `fallback` is set, so callers can
   * log "why is this null" without enabling silly-level wire logging.
   */
  bodySnippet?: string;
}

/**
 * Signature der httpsRequest-Funktion. Cloud/Mqtt-Clients nehmen das als
 * optionalen DI-Parameter — Default ist die echte httpsRequest, Tests können
 * einen Mock injizieren ohne Module-Replacement.
 */
export type HttpsRequestFn = <T>(options: HttpRequestOptions) => Promise<HttpResult<T>>;

/**
 * Perform an HTTPS request and parse the JSON response. Resolves with an
 * {@link HttpResult} envelope (`value` + `statusCode` + optional `fallback`/
 * `bodySnippet`) for 2xx/3xx, rejects with {@link HttpError} for 4xx/5xx.
 *
 * @param options Request options
 */
export function httpsRequest<T>(options: HttpRequestOptions): Promise<HttpResult<T>> {
  return new Promise((resolve, reject) => {
    const u = new URL(options.url);
    const postData = options.body ? JSON.stringify(options.body) : undefined;

    const reqOptions: https.RequestOptions = {
      method: options.method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        ...options.headers,
        ...(postData
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
            }
          : {}),
      },
      timeout: options.timeout ?? 15_000,
      agent: keepAliveAgent,
    };

    // Track the abort listener so we can detach it when the request resolves
    // or rejects normally — without this the AbortSignal accumulates one
    // dead listener per completed request, leaking memory if the same signal
    // is re-used for many requests.
    let onAbort: (() => void) | null = null;
    const cleanupAbort = (): void => {
      if (onAbort && options.signal) {
        options.signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
    };

    const req = https.request(reqOptions, res => {
      const chunks: Buffer[] = [];
      // res.on("error") catches mid-stream failures (TCP RST after headers,
      // socket-close before "end" fires). Without this, such errors propagate
      // to the global "uncaughtException" handler instead of rejecting the
      // promise — and the caller sees the request hang until the 15 s timeout.
      res.on("error", err => {
        cleanupAbort();
        reject(err);
      });
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        cleanupAbort();
        const raw = Buffer.concat(chunks).toString();
        const statusCode = res.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 400) {
          // M4 — Body-Snippet aus Error-Message rausnehmen damit
          // Tokens/API-Keys nicht im warn-Log auftauchen wenn der
          // Server sie reflektiert. responseBody bleibt für debug
          // separat verfügbar.
          reject(new HttpError(`HTTP ${statusCode}`, statusCode, res.headers, raw));
          return;
        }

        // Empty/whitespace-only 2xx body is legitimate for several Govee
        // undocumented endpoints — `/appsku/v1/music-effect-libraries`,
        // `diy-light-effect-libraries`, and `sku-supported-feature` all
        // return a bare 200 with no body for SKUs they don't recognise.
        // Resolve as `null` so the caller can treat it as "no data" via the
        // existing optional-chaining guards instead of seeing an
        // `Invalid JSON` stack trace in the log (Issue #13).
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          resolve({ value: null, statusCode, fallback: "empty" });
          return;
        }

        // Govee also returns HTTP 200 with a plain-text *HTTP-status-line*
        // body for SKU/Bearer combos without permission — e.g. the literal
        // string `"403 Forbbiden"` (their typo). The conservative regex
        // `^<3-digit-status> <non-whitespace>` plus a 100-char length cap
        // catches these without swallowing JSON literals that happen to
        // start with a number (`123.45` lacks the trailing whitespace+text).
        // Issue #13 follow-up (tukey42, H61A8 — 2026-05-12). v2.8.3 carries
        // the body snippet through HttpResult so callers can debug-log it.
        if (trimmed.length < 100 && /^\d{3}\s+\S/.test(trimmed)) {
          resolve({ value: null, statusCode, fallback: "plain-text-status", bodySnippet: trimmed });
          return;
        }

        try {
          resolve({ value: JSON.parse(raw) as T, statusCode });
        } catch (parseErr) {
          // Include a 100-char prefix of the body so a "this endpoint
          // returned HTML / a non-JSON 200" can be diagnosed without
          // enabling debug log. Body cap is intentional — Govee may echo
          // request data and we don't want full payloads in warn logs.
          const snippet = raw.length > 100 ? `${raw.slice(0, 100)}…` : raw;
          const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
          reject(new Error(`Invalid JSON in HTTP ${statusCode} response: ${detail} — body starts with: ${snippet}`));
        }
      });
    });

    req.on("error", err => {
      cleanupAbort();
      reject(err);
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));

    // M3 — AbortSignal-Support. Wer den Request macht kann ihn abbrechen
    // (z.B. Adapter-onUnload via AbortController) damit der Stop nicht
    // 15s auf das Timeout warten muss.
    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new Error("Aborted"));
        reject(new Error("Aborted"));
        return;
      }
      onAbort = (): void => {
        req.destroy(new Error("Aborted"));
        reject(new Error("Aborted"));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/** HTTP error with status code, response headers, and response body (debug-only) */
export class HttpError extends Error {
  /** HTTP status code */
  readonly statusCode: number;
  /** Response headers */
  readonly headers: Record<string, string | string[] | undefined>;
  /**
   * Raw response body — NICHT in `message` damit Tokens/API-Keys nicht
   * via warn-Log geleakt werden. Nur für gezieltes debug-Logging beim
   * Caller verfügbar.
   */
  readonly responseBody: string;

  /**
   * @param message Error message (Body-frei)
   * @param statusCode HTTP status code
   * @param headers Response headers
   * @param responseBody Raw response body (kann sensitive Echo-Daten enthalten)
   */
  constructor(
    message: string,
    statusCode: number,
    headers: Record<string, string | string[] | undefined> = {},
    responseBody: string = "",
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.headers = headers;
    this.responseBody = responseBody;
  }
}
