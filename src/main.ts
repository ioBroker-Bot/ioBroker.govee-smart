import * as utils from "@iobroker/adapter-core";
import { initDeviceRegistry } from "./lib/device-registry";
import { DeviceManager, resolveSegmentCount } from "./lib/device-manager";
import { GoveeApiClient } from "./lib/govee-api-client";
import { GoveeCloudClient } from "./lib/govee-cloud-client";
import { GoveeLanClient } from "./lib/govee-lan-client";
import { GoveeMqttClient } from "./lib/govee-mqtt-client";
import { GoveeOpenapiMqttClient } from "./lib/govee-openapi-mqtt-client";
import { LocalSnapshotStore } from "./lib/local-snapshots";
import { installLogPrefix, type ChannelStatusSnapshot } from "./lib/log-prefix";
import { SnapshotHandler } from "./lib/snapshot-handler";
import { GroupFanoutHandler } from "./lib/group-fanout";
import { MessageRouter, type MessageRouterHost } from "./lib/message-router";
import type { CloudRetryLoop } from "./lib/cloud-retry";
import * as cloudCreds from "./lib/handlers/cloud-creds-handler";
import * as cloudRetryHandler from "./lib/handlers/cloud-retry-handler";
import * as cloudStateLoader from "./lib/handlers/cloud-state-loader";
import * as connectionState from "./lib/handlers/connection-state";
import * as deviceEvents from "./lib/handlers/device-events";
import * as groupFanoutHandler from "./lib/handlers/group-fanout-handler";
import * as groupStateHelpers from "./lib/handlers/group-state-helpers";
import * as snapshotHandlerGlue from "./lib/handlers/snapshot-handler-glue";
import * as stateChangeRouter from "./lib/handlers/state-change-router";
import * as wizardHandler from "./lib/handlers/wizard-handler";
import { RateLimiter } from "./lib/rate-limiter";
import type { SegmentWizard } from "./lib/segment-wizard";
import { wizardIdleText } from "./lib/segment-wizard";
import { SkuCache } from "./lib/sku-cache";
import { StateManager } from "./lib/state-manager";
import {
  errMessage,
  rgbIntToHex,
  rgbToHex,
  type AdapterConfig,
  type CloudStateCapability,
  type GoveeDevice,
} from "./lib/types";
import { APP_API_INITIAL_DELAY_MS, APP_API_POLL_INTERVAL_MS, CLOUD_FULL_LIMITS } from "./lib/timing-constants";

// Rate-limit defaults moved to lib/timing-constants.ts as CLOUD_FULL_LIMITS so
// every module that touches Govee budgeting reads the same canonical values.

class GoveeAdapter extends utils.Adapter {
  /** Public for handler modules (state-change-router, group-fanout, wizard, snapshot, diagnostics). */
  public deviceManager: DeviceManager | null = null;
  /** Public for handler modules. */
  public stateManager: StateManager | null = null;
  /** Public for handler modules. */
  public lanClient: GoveeLanClient | null = null;
  /** Public for handler modules (connection-state). */
  public mqttClient: GoveeMqttClient | null = null;
  /** Public for handler modules (connection-state). */
  public openapiMqttClient: GoveeOpenapiMqttClient | null = null;
  /** Public for handler modules. */
  public cloudClient: GoveeCloudClient | null = null;
  private rateLimiter: RateLimiter | null = null;
  /** Repeating timer for the App-API poll (sensor-state pull). */
  private appApiPollTimer: ioBroker.Interval | undefined;
  /**
   * One-shot timer for the FIRST app-api poll (5s nach start) — Handle
   *  damit onUnload das wegräumen kann bevor es ins Leere feuert.
   */
  private appApiInitialTimer: ioBroker.Timeout | undefined;
  /** One-shot timer for cloud-init 60s safety timeout — gleiches Pattern. */
  /** Public for handler modules. */
  public cloudInitTimer: ioBroker.Timeout | undefined;
  /**
   * Letzter info.connection-Wert — Cache damit nicht jeder device-update
   *  einen unnötigen setStateAsync macht (H4).
   */
  /** Public for handler modules (connection-state). */
  public lastConnectionState: boolean | null = null;
  // === Lifecycle-Flags (Adapter-Boot-Sequenz) ===
  // checkAllReady() prüft alle 5 Voraussetzungen gleichzeitig — sie laufen
  // parallel ab, kein lineares STATE_MACHINE-Pattern weil Channels
  // unabhängig connecten.
  /** LAN-Scan-Initial-Wait abgeschlossen — public for connection-state handler. */
  public lanScanDone = false;
  /** State-Tree-Erstellung fertig — public for connection-state + device-events handlers. */
  public statesReady = false;
  /** Cloud-Init-Phase abgeschlossen — public for connection-state handler. */
  public cloudInitDone = false;
  /** App-API-Poll fertig — public for connection-state handler. */
  public appApiInitialPollDone = false;
  /** Mehrfach-Ready-Log-Guard — public for connection-state handler. */
  public readyLogged = false;
  /** Cloud war mindestens einmal connected — für „restored"-Log nach Down. */
  /** Public for handler modules. */
  public cloudWasConnected = false;
  /** Tägliches Interval für App-Version-Drift-Check gegen App-Store. */
  private appVersionCheckTimer: ioBroker.Interval | undefined;
  /**
   * 20 s Timer that re-evaluates `info.online` for every device via
   * StateManager.syncInfoOnline. Drives the offline-transition for Lights
   * (TTL-based on lastLanReplyAt) and the no-op write-suppression for all
   * devices. Cleared synchronously in onUnload.
   */
  private onlineSyncTimer: ioBroker.Interval | undefined;
  // === Sub-Komponenten ===
  private skuCache: SkuCache | null = null;
  /** Public for handler modules. */
  public localSnapshots: LocalSnapshotStore | null = null;
  /** Public for handler modules (state-change-router). */
  public snapshotHandler: SnapshotHandler | null = null;
  /** Public for handler modules (state-change-router). */
  public groupFanout: GroupFanoutHandler | null = null;
  private messageRouter: MessageRouter | null = null;
  /** Current channel status — pulled by the log-prefix wrapper on every log call. */
  public channelStatus: ChannelStatusSnapshot = { lan: "n/a", cloud: "n/a", mqtt: "n/a", openapi: "n/a" };
  /** Public for handler modules (device-events). */
  public stateCreationQueue: Promise<void>[] = [];
  private lanScanTimer: ioBroker.Timeout | undefined;
  private cleanupTimer: ioBroker.Timeout | undefined;
  private readyTimer: ioBroker.Timeout | undefined;
  /** Public for handler modules. Undefined until first ensureCloudRetry() call. */
  public cloudRetry: CloudRetryLoop | undefined;
  /** Public for handlers/wizard-handler — lazily instantiated by `runWizardStep`. */
  public segmentWizard: SegmentWizard | null = null;
  private unhandledRejectionHandler: ((reason: unknown) => void) | null = null;
  private uncaughtExceptionHandler: ((err: Error) => void) | null = null;
  /** Per-device timestamp of the last diagnostics export — throttle gate */
  /** Public for handler modules (state-change-router, diagnostics). */
  public diagnosticsLastRun = new Map<string, number>();
  /** Cached admin language from system.config — used for wizard UI text */
  /** Public for handler modules. */
  public adminLanguage = "en";
  /** Last time `requestCode` was triggered via onMessage — guards against double-click email spam. */
  private lastVerificationRequestMs = 0;
  /**
   * Set true at the start of onUnload — async paths (onStateChange,
   * applyCloudCapabilities, retrySceneData, …) check this between awaits
   * and bail before further setStateAsync against a torn-down adapter.
   */
  /** Public for handler modules (state-change-router). */
  public unloading = false;
  /** Initial app-version-check timer (2 min after start) — kept so onUnload can clear it. */
  private appVersionInitialTimer: ioBroker.Timeout | undefined;

  /** @param options Adapter options */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "govee-smart" });
    // Per ioBroker rule: async handlers registered on events MUST .catch,
    // otherwise rejections become unhandled → SIGKILL code 6 → restart loop.
    this.on("ready", () =>
      this.onReady().catch(e =>
        this.log.error(`onReady crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`),
      ),
    );
    this.on("stateChange", (id, state) =>
      stateChangeRouter
        .onStateChange(this, id, state)
        .catch(e => this.log.warn(`onStateChange crashed for ${id}: ${errMessage(e)}`)),
    );
    this.on("message", obj => this.messageRouter?.onMessage(obj));
    this.on("unload", callback => this.onUnload(callback));
    // Last-line-of-defence against unhandled rejections / sync throws from
    // fire-and-forget paths. The per-handler .catch() wrappers cover the
    // direct entry points; this catches whatever slips past them so the
    // adapter logs the cause instead of triggering js-controller SIGKILL.
    this.unhandledRejectionHandler = (reason: unknown) => {
      this.log.error(
        `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
      );
    };
    this.uncaughtExceptionHandler = (err: Error) => {
      this.log.error(`Uncaught exception: ${err.stack ?? err.message}`);
    };
    process.on("unhandledRejection", this.unhandledRejectionHandler);
    process.on("uncaughtException", this.uncaughtExceptionHandler);
  }

  /** Adapter started — initialize all channels */
  private async onReady(): Promise<void> {
    const config = this.config as unknown as AdapterConfig;

    // Channel-status prefix for every log line — must run BEFORE sub-libraries
    // are constructed so they pick up the wrapped adapter.log automatically.
    // Initial snapshot reflects which credentials the user provided; status
    // flips to "on" / "off" as connections come up or fail.
    this.channelStatus = {
      lan: "off", // LAN listener always exists; flips to "on" after first discovery
      cloud: config.apiKey ? "off" : "n/a",
      mqtt: config.goveeEmail && config.goveePassword ? "off" : "n/a",
      openapi: config.apiKey ? "off" : "n/a",
    };
    installLogPrefix(this.log, () => this.channelStatus);

    // info channel + states are declared as instanceObjects in
    // io-package.json, so js-controller materialises them on install /
    // upgrade. We only initialise the runtime values here.
    await this.setStateAsync("info.connection", { val: false, ack: true });
    await this.setStateAsync("info.mqttConnected", { val: false, ack: true });
    await this.setStateAsync("info.cloudConnected", { val: false, ack: true });
    await this.setStateAsync("info.openapiMqttConnected", {
      val: false,
      ack: true,
    });
    // Load admin language from system.config so wizard prose matches the
    // user's Admin UI. Falls back to English on any lookup failure. Adapter
    // logs themselves stay English by ioBroker convention; this language is
    // used only for the segment wizard's user-facing status text.
    try {
      const sysConf = await this.getForeignObjectAsync("system.config");
      const lang = (sysConf?.common as { language?: string } | undefined)?.language;
      if (typeof lang === "string" && lang.length > 0) {
        this.adminLanguage = lang;
      }
    } catch {
      // Keep default "en"
    }
    await this.setStateAsync("info.wizardStatus", {
      val: wizardIdleText(this.adminLanguage),
      ack: true,
    });

    this.stateManager = new StateManager(this);
    // General groups online state (reflects Cloud connection)
    await this.stateManager.createGroupsOnlineState(false);
    this.deviceManager = new DeviceManager(this.log, this);
    const dataDir = utils.getAbsoluteInstanceDataDir(this);

    // Load device registry from devices.json in the adapter package root.
    // Status filter: verified+reported active by default; seed-status entries
    // require the experimentalQuirks config toggle.
    initDeviceRegistry({
      experimental: config.experimentalQuirks === true,
      log: this.log,
    });
    this.skuCache = new SkuCache(dataDir, this.log);
    this.localSnapshots = new LocalSnapshotStore(dataDir, this.log);
    this.snapshotHandler = new SnapshotHandler(snapshotHandlerGlue.buildSnapshotHost(this));
    this.groupFanout = new GroupFanoutHandler(groupFanoutHandler.buildGroupFanoutHost(this));
    this.messageRouter = new MessageRouter(this.buildMessageRouterHost());
    this.deviceManager.setSkuCache(this.skuCache);

    // API client for undocumented scene/music/DIY libraries (always available)
    const apiClient = new GoveeApiClient(this.log);
    apiClient.setEmail(config.goveeEmail);
    this.deviceManager.setApiClient(apiClient);

    this.deviceManager.setCallbacks({
      onUpdate: (device, state) => deviceEvents.onDeviceStateUpdate(this, device, state),
      onLanDeviceReady: (device, allDevices) => deviceEvents.onLanDeviceReady(this, device, allDevices),
      onCloudDataReady: (device, allDevices) => deviceEvents.onCloudDataReady(this, device, allDevices),
      onGroupMembersReady: (group, allDevices) => deviceEvents.onGroupMembersReady(this, group, allDevices),
    });

    // Update info.ip when LAN IP changes
    this.deviceManager.onLanIpChanged = (device, ip) => {
      const prefix = this.stateManager!.devicePrefix(device);
      this.setStateAsync(`${prefix}.info.ip`, { val: ip, ack: true }).catch(() => {});
    };

    // Sync individual segment states after batch command.
    // Wichtig: Wizard sendet `segmentBatch` mit Indizes 0..SEGMENT_HARD_MAX
    // damit das Gerät die echte Strip-Länge selbst zeigt. Wir dürfen das
    // ECHO aber nur in States schreiben die wirklich existieren — sonst
    // produziert js-controller den „has no existing object"-WARN für
    // jeden index oberhalb der Cap (z.B. segments.51..55 bei 19-Strip).
    this.deviceManager.onSegmentBatchUpdate = (device, batch) => {
      const prefix = this.stateManager!.devicePrefix(device);
      const cap = typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : 0;
      for (const idx of batch.segments) {
        if (cap === 0 || idx >= cap) {
          continue;
        }
        if (batch.color !== undefined) {
          const hex = rgbIntToHex(batch.color);
          this.setStateAsync(`${prefix}.segments.${idx}.color`, {
            val: hex,
            ack: true,
          }).catch(() => {});
        }
        if (batch.brightness !== undefined) {
          this.setStateAsync(`${prefix}.segments.${idx}.brightness`, {
            val: batch.brightness,
            ack: true,
          }).catch(() => {});
        }
      }
    };

    // Sync per-segment states from MQTT BLE status push (AA A5 packets).
    // Gleicher Cap-Filter wie bei batch — defensive vor stale Pakete.
    this.deviceManager.onMqttSegmentUpdate = (device, segments) => {
      const prefix = this.stateManager!.devicePrefix(device);
      const cap = typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : 0;
      for (const seg of segments) {
        if (cap === 0 || seg.index >= cap) {
          continue;
        }
        this.setStateAsync(`${prefix}.segments.${seg.index}.color`, {
          val: rgbToHex(seg.r, seg.g, seg.b),
          ack: true,
        }).catch(() => {});
        this.setStateAsync(`${prefix}.segments.${seg.index}.brightness`, {
          val: seg.brightness,
          ack: true,
        }).catch(() => {});
      }
    };

    // When MQTT reveals more segments than the Cloud advertised, rebuild
    // the device's state tree so the extra segments get their datapoints.
    this.deviceManager.onSegmentCountGrown = device => {
      if (!this.stateManager) {
        return;
      }
      this.stateManager.createSegmentStates(device).catch(e => {
        this.log.warn(`Failed to rebuild segment tree for ${device.name} after count growth: ${errMessage(e)}`);
      });
    };

    // Log startup with configured channels
    const startChannels: string[] = ["LAN"];
    if (config.apiKey) {
      startChannels.push("Cloud");
    }
    if (config.goveeEmail && config.goveePassword) {
      startChannels.push("MQTT");
    }
    this.log.info(
      `Starting (${startChannels.join(", ")}) — please wait, a "ready" message will follow when all channels are up`,
    );

    // --- LAN (always active) ---
    this.lanClient = new GoveeLanClient(this.log, this);
    this.deviceManager.setLanClient(this.lanClient);

    this.lanClient.start(
      lanDevice => {
        this.deviceManager!.handleLanDiscovery(lanDevice);
        // Poll status only when MQTT is unavailable. With an active MQTT
        // subscription Govee pushes state changes authoritatively, so the
        // LAN devStatus request would be duplicate traffic.
        if (!this.mqttClient?.connected) {
          this.lanClient!.requestStatus(lanDevice.ip);
        }
      },
      (sourceIp, status) => {
        this.deviceManager!.handleLanStatus(sourceIp, status);
      },
      30_000,
      config.networkInterface || "",
    );

    // Wait for first LAN scan responses (UDP multicast, devices respond within 1-2s)
    this.lanScanTimer = this.setTimeout(() => {
      this.lanScanDone = true;
      connectionState.checkAllReady(this);
    }, 3_000);

    // --- MQTT (if account credentials provided) ---
    // Initialize MQTT before Cloud so scene library can load on first cycle
    if (config.goveeEmail && config.goveePassword) {
      this.mqttClient = new GoveeMqttClient(config.goveeEmail, config.goveePassword, this.log, this);

      // Forward every parsed MQTT op.command into the diagnostics ring buffer
      // so diag.export contains the recent packets per device.
      this.mqttClient.setPacketHook((deviceId, topic, hex) => {
        this.deviceManager?.getDiagnostics().addMqttPacket(deviceId, topic, hex);
      });

      // 2FA: forward optional code from settings into the next login attempt;
      // clear the field automatically once Govee has accepted it.
      this.mqttClient.setVerificationCode(config.mqttVerificationCode ?? "");
      this.mqttClient.setOnVerificationConsumed(() => {
        cloudCreds.clearVerificationCodeSetting(this).catch(e => {
          this.log.warn(`Could not clear mqttVerificationCode: ${errMessage(e)}`);
        });
      });
      this.mqttClient.setOnVerificationFailed(reason => {
        // On 'failed' (455 / 454+code-was-sent) blank the code so the user
        // doesn't keep retrying with a stale value. On 'pending' (454 + no
        // code) we leave the field as-is — the user is about to fill it.
        if (reason === "failed") {
          cloudCreds.clearVerificationCodeSetting(this).catch(() => {});
        }
      });

      // Re-use cached MQTT credentials across restarts. Stored in the
      // info.mqttCredentials state (NOT in adapter native): writing to
      // system.adapter.X.0 native triggers a js-controller adapter
      // restart, which would loop endlessly on every login. States are
      // restart-safe.
      //
      // One-shot: clean up legacy v2.1.0/v2.1.1/v2.1.2 native fields
      // that contained plaintext credentials. Best-effort.
      await cloudCreds.cleanupLegacyMqttNativeOnce(this);
      const cachedCreds = await cloudCreds.loadPersistedCredsFromState(this);
      if (cachedCreds) {
        this.mqttClient.setPersistedCredentials(cachedCreds);
      }
      this.mqttClient.setOnCredentialsRefresh(creds => {
        cloudCreds.persistCredsToState(this, creds).catch(e => {
          this.log.warn(`Could not persist MQTT credentials: ${errMessage(e)}`);
        });
      });

      await this.mqttClient.connect(
        update => this.deviceManager!.handleMqttStatus(update),
        connected => {
          this.setStateAsync("info.mqttConnected", {
            val: connected,
            ack: true,
          }).catch(() => {});
          if (connected) {
            connectionState.checkAllReady(this);
          }
          connectionState.updateConnectionState(this);
        },
        // Forward every fresh bearer token — fires on initial login and on
        // each reconnect-login, so the API client never runs with a stale one.
        token => apiClient.setBearerToken(token),
      );
    }

    // --- Device data: Cache first, Cloud only on cache miss ---
    const cachedOk = this.deviceManager.loadFromCache();

    if (config.apiKey) {
      this.cloudClient = new GoveeCloudClient(config.apiKey, this.log);
      // Capture the most recent Cloud response per (deviceId, endpoint) for
      // diagnostics — bounded by the DiagnosticsCollector's response slot cap.
      this.cloudClient.setResponseHook((deviceId, endpoint, body) => {
        this.deviceManager?.getDiagnostics().setApiResponse(deviceId, endpoint, body);
      });
      this.deviceManager.setCloudClient(this.cloudClient);

      // Bridge synthetic capabilities (App-API, OpenAPI-MQTT events) into the
      // same setState pipeline as polled Cloud state. Keeps mapCloudStateValue
      // as the single source of truth for value coercion + state-id resolution.
      this.deviceManager.setOnCloudCapabilities((device, caps) => {
        cloudStateLoader
          .applyCloudCapabilities(this, device, caps)
          .catch(e => this.log.warn(`applyCloudCapabilities failed for ${device.sku}: ${errMessage(e)}`));
      });

      this.rateLimiter = new RateLimiter(this.log, this, CLOUD_FULL_LIMITS.perMinute, CLOUD_FULL_LIMITS.perDay);
      this.rateLimiter.start();
      this.deviceManager.setRateLimiter(this.rateLimiter);

      // OpenAPI-MQTT — push channel for appliance/sensor events
      // (lackWater, iceFull, bodyAppeared etc.). API key is enough; no
      // separate credentials required. Connection runs in parallel to
      // the AWS-IoT MQTT used for status push of regular devices.
      this.openapiMqttClient = new GoveeOpenapiMqttClient(config.apiKey, this.log, this);
      this.openapiMqttClient.connect(
        event => this.deviceManager?.handleOpenApiEvent(event),
        connected => {
          this.setStateAsync("info.openapiMqttConnected", {
            val: connected,
            ack: true,
          }).catch(() => {});
        },
      );

      // App-API poll — every 2 minutes, pulls state for sensors like H5179
      // where OpenAPI v2 /device/state returns empty. Bearer token comes
      // from the AWS-IoT MQTT login, so a no-op until that succeeds.
      const triggerAppApiPoll = (): void => {
        this.deviceManager
          ?.pollAppApi()
          .then(() => {
            // H2 — Mark initial-poll-done und re-check Ready damit der
            // Adapter „ready" loggen kann sobald Sensor-Werte da sind.
            if (!this.appApiInitialPollDone) {
              this.appApiInitialPollDone = true;
              connectionState.checkAllReady(this);
            }
          })
          .catch(e => this.log.debug(`pollAppApi failed: ${errMessage(e)}`));
      };
      this.appApiPollTimer = this.setInterval(triggerAppApiPoll, APP_API_POLL_INTERVAL_MS);
      // Initial poll: gibt MQTT Zeit für den Bearer-Login. Ohne diesen
      // Sofort-Poll bleiben Sensoren wie H5179 die ersten 2 Minuten nach
      // Start offline (Online-Signal kommt nur via App-API). Handle in
      // Member-Variable damit onUnload den Timer cleart.
      this.appApiInitialTimer = this.setTimeout(triggerAppApiPoll, APP_API_INITIAL_DELAY_MS);

      if (!cachedOk) {
        // No cache — first start, fetch from Cloud with 60s hard-timeout.
        // If Cloud hangs/fails, we don't want to block adapter startup indefinitely.
        const result = await cloudRetryHandler.cloudInitWithTimeout(this);
        this.cloudWasConnected = result.ok;
        cloudRetryHandler.ensureCloudRetry(this).setConnected(result.ok);
        this.setStateAsync("info.cloudConnected", {
          val: result.ok,
          ack: true,
        }).catch(() => {});
        this.stateManager?.updateGroupsOnline(result.ok).catch(() => {});

        if (result.ok) {
          await cloudStateLoader.loadCloudStates(this);
        } else {
          cloudRetryHandler.handleCloudFailure(this, result);
        }
      } else {
        this.log.info(`Using cached device data — no Cloud calls needed`);
        this.cloudWasConnected = true;
        cloudRetryHandler.ensureCloudRetry(this).setConnected(true);
        this.setStateAsync("info.cloudConnected", {
          val: true,
          ack: true,
        }).catch(() => {});
        this.stateManager?.updateGroupsOnline(true).catch(() => {});
      }
      // Load group membership from undocumented API (needs bearer token + device map)
      await this.deviceManager.loadGroupMembers();

      this.cloudInitDone = true;
    }

    // Wait for all state creation from cache/cloud load to complete.
    // Drain-loop: a callback that fires during the await (e.g. a late LAN
    // discovery) can push fresh promises into the queue — we need to await
    // those too before flipping statesReady, otherwise the initial state
    // tree would be incomplete on very fast startups.
    while (this.stateCreationQueue.length > 0) {
      const pending = this.stateCreationQueue;
      this.stateCreationQueue = [];
      await Promise.all(pending);
    }

    // v2.8.0 one-shot migration: pure-LAN devices (no API key, never went
    // through a Cloud-phase) on prior versions had scenes/music/snapshots
    // states briefly created then orphaned. Wipe those leftovers now.
    // Idempotent — second run does nothing, the LAN_STATE_IDS skip in
    // cleanupCloudOwnedStates protects power/brightness/colorRgb/colorTemperature.
    if (this.stateManager && this.deviceManager) {
      for (const device of this.deviceManager.getDevices()) {
        if (device.lanIp && device.capabilities.length === 0) {
          const prefix = this.stateManager.devicePrefix(device);
          await this.stateManager.cleanupCloudOwnedStates(prefix, []).catch(e => {
            this.log.debug(`v2.8.0 migration cleanup failed for ${device.name}: ${errMessage(e)}`);
          });
          this.log.info(`Migrated v2.8.0: removed legacy cloud-owned states for ${device.name} (pure-LAN, no API key)`);
        }
      }
    }

    this.statesReady = true;

    // Subscribe to all writable device and group states
    await this.subscribeStatesAsync("devices.*");
    await this.subscribeStatesAsync("groups.*");

    // Cleanup stale devices after initial discovery (30s delay for LAN scan).
    // Reaps devices from every adapter-level map that was keyed on them so the
    // process doesn't leak memory across Cloud-side device turnover.
    this.cleanupTimer = this.setTimeout(() => {
      connectionState.reapStaleDevices(this).catch(e => this.log.debug(`Device cleanup failed: ${errMessage(e)}`));
    }, 30_000);

    // info.online sync — re-evaluates per-device online truth every 20 s.
    // For Lights this drives the offline-transition (lastLanReplyAt TTL).
    // For all devices it suppresses ts-rewrite-spam (no setStateAsync when
    // value is unchanged). When a Light flips online/offline, also refreshes
    // group-reachability since the original onDeviceUpdate path no longer
    // sees those transitions for Lights.
    this.onlineSyncTimer = this.setInterval(() => {
      if (this.unloading || !this.stateManager || !this.deviceManager) {
        return;
      }
      void (async (): Promise<void> => {
        let anyLightChanged = false;
        for (const device of this.deviceManager!.getDevices()) {
          const changed = await this.stateManager!.syncInfoOnline(device).catch(() => false);
          if (changed) {
            anyLightChanged = true;
          }
        }
        if (anyLightChanged) {
          groupFanoutHandler.updateGroupReachability(this);
        }
      })();
    }, 20_000);

    // App-Version-Drift-Monitor — daily check + initial nach 2 min wenn der
    // Adapter-Start ohne MQTT-Login durchgeschlagen ist (z.B. LAN-only).
    this.appVersionCheckTimer = this.setInterval(
      () => {
        connectionState
          .checkAppVersionDrift(this)
          .catch(e => this.log.debug(`App version check error: ${errMessage(e)}`));
      },
      24 * 60 * 60 * 1000,
    );
    this.appVersionInitialTimer = this.setTimeout(
      () => {
        this.appVersionInitialTimer = undefined;
        if (this.unloading) {
          return;
        }
        connectionState
          .checkAppVersionDrift(this)
          .catch(e => this.log.debug(`App version check error: ${errMessage(e)}`));
      },
      2 * 60 * 1000,
    );

    connectionState.updateConnectionState(this);

    // Check if all channels are ready — may already be true if MQTT connected fast
    connectionState.checkAllReady(this);
    // Safety timeout: log ready even if a channel takes too long.
    // 60s deckt normalen MQTT-Connect + 1 Reconnect-Attempt ab.
    this.readyTimer = this.setTimeout(() => {
      if (!this.readyLogged) {
        // Safety-Timeout: log ready trotzdem auch wenn ein Channel zu lange
        // braucht. READY_TIMEOUT_MS deckt normalen MQTT-Connect + 1 Reconnect.
        this.readyLogged = true;
        connectionState.logDeviceSummary(this);
      }
    }, 60_000);
  }

  /**
   * Adapter stopping — MUST be synchronous.
   *
   * @param callback Completion callback
   */
  private onUnload(callback: () => void): void {
    // Set first — async paths read this between awaits and bail before
    // further setStateAsync, sendCommand, etc. against a torn-down adapter.
    this.unloading = true;
    try {
      if (this.lanScanTimer) {
        this.clearTimeout(this.lanScanTimer);
      }
      if (this.cleanupTimer) {
        this.clearTimeout(this.cleanupTimer);
      }
      if (this.readyTimer) {
        this.clearTimeout(this.readyTimer);
      }
      if (this.appApiPollTimer) {
        this.clearInterval(this.appApiPollTimer);
        this.appApiPollTimer = undefined;
      }
      if (this.onlineSyncTimer) {
        this.clearInterval(this.onlineSyncTimer);
        this.onlineSyncTimer = undefined;
      }
      if (this.appApiInitialTimer) {
        this.clearTimeout(this.appApiInitialTimer);
        this.appApiInitialTimer = undefined;
      }
      if (this.cloudInitTimer) {
        this.clearTimeout(this.cloudInitTimer);
        this.cloudInitTimer = undefined;
      }
      if (this.appVersionCheckTimer) {
        this.clearInterval(this.appVersionCheckTimer);
        this.appVersionCheckTimer = undefined;
      }
      if (this.appVersionInitialTimer) {
        this.clearTimeout(this.appVersionInitialTimer);
        this.appVersionInitialTimer = undefined;
      }
      this.cloudRetry?.dispose();
      this.segmentWizard?.dispose();
      this.lanClient?.stop();
      this.mqttClient?.disconnect();
      this.openapiMqttClient?.disconnect();
      this.rateLimiter?.stop();
      // Remove process-level handlers so an adapter restart doesn't stack them.
      if (this.unhandledRejectionHandler) {
        process.off("unhandledRejection", this.unhandledRejectionHandler);
        this.unhandledRejectionHandler = null;
      }
      if (this.uncaughtExceptionHandler) {
        process.off("uncaughtException", this.uncaughtExceptionHandler);
        this.uncaughtExceptionHandler = null;
      }
      // onUnload MUST be synchronous — don't await, but silence potential
      // promise rejection during teardown to avoid "unhandled rejection" warnings.
      this.setState("info.connection", { val: false, ack: true }).catch(() => {});
      this.setState("info.mqttConnected", { val: false, ack: true }).catch(() => {});
      this.setState("info.openapiMqttConnected", {
        val: false,
        ack: true,
      }).catch(() => {});
      this.setState("info.cloudConnected", { val: false, ack: true }).catch(() => {});
    } catch {
      // ignore
    }
    callback();
  }

  /**
   * Public delegate to stateChangeRouter — required by GroupFanoutHandlerAdapter interface.
   *
   * @param device Target device
   * @param prefix Device state prefix
   * @param changedSuffix State suffix that changed
   * @param newValue New value written
   */
  public async sendMusicCommand(
    device: GoveeDevice,
    prefix: string,
    changedSuffix: string,
    newValue: ioBroker.StateValue,
  ): Promise<void> {
    return stateChangeRouter.sendMusicCommand(this, device, prefix, changedSuffix, newValue);
  }

  /**
   * Called by device-manager when a device state changes
   *
   * @param device Updated device
   * @param state Changed state values
   */

  /**
   * Rebuild state definitions for one device and feed them into StateManager.
   * Used both from the full-list callback and from targeted refreshes
   * (e.g. after a local snapshot was added or removed — no reason to rebuild
   * the entire tree for every device then).
   *
   * @param device Target device
   * @param allDevices Full device list (needed to resolve group members)
   */
  /**
   * Public delegate for snapshot-glue + state-change-router modules — a
   * Cloud-data event (new snapshot in app, refresh-button, etc.) needs a
   * full Cloud-phase rebuild for the affected device.
   *
   * @param device Target device
   * @param allDevices Full device list
   */
  public fireCloudDataReady(device: GoveeDevice, allDevices: GoveeDevice[]): void {
    deviceEvents.onCloudDataReady(this, device, allDevices);
  }

  /**
   * Called by device-manager when the device list changes
   *
   * @param devices Current list of all devices
   */

  /** Public delegate — connection-state handler exports the real implementation. */
  public reapStaleDevices(): Promise<void> {
    return connectionState.reapStaleDevices(this);
  }

  /**
   * Find device for a state ID
   *
   * @param localId Local state ID without namespace prefix
   */
  /**
   * Map state suffix to command name.
   *
   * Simple suffixes live in a lookup table, segment indices need regex
   * extraction because they're dynamic. The three music states all route
   * to the same "music" command — the handler reads sibling values.
   *
   * @param suffix State ID suffix (e.g. "power", "brightness")
   */
  /**
   * Public delegate for handler modules — stateless lookup, lives in lib/handlers/group-state-helpers.
   *
   * @param suffix State suffix
   */
  public stateToCommand(suffix: string): string | null {
    return groupStateHelpers.stateToCommand(suffix);
  }

  /** Public delegate for cloud-retry-handler's CloudRetryHandlerAdapter interface. */
  public loadCloudStates(): Promise<void> {
    return cloudStateLoader.loadCloudStates(this);
  }

  /**
   * Public for OpenAPI-MQTT + App-API pipelines feeding sensor/appliance state.
   *
   * @param device Target device
   * @param caps Cloud-state capabilities
   */
  public applyCloudCapabilities(device: GoveeDevice, caps: CloudStateCapability[]): Promise<void> {
    return cloudStateLoader.applyCloudCapabilities(this, device, caps);
  }

  /**
   * Central entry point for manual-segment updates. Sets the device flags,
   * rebuilds the segment tree (which writes manual_mode + manual_list with
   * ack=true), and persists to cache. Both the user state-change handler
   * and the wizard route their final decisions here.
   *
   * @param device Target device
   * @param mode    Whether manual mode should be active
   * @param indices Physical indices when mode=true, ignored otherwise
   */
  /**
   * Public for handler modules (wizard, state-change-router).
   *
   * @param device Target device
   * @param mode Manual mode flag
   * @param indices Physical segment indices
   */
  public async applyManualSegments(device: GoveeDevice, mode: boolean, indices?: number[]): Promise<void> {
    if (!this.stateManager) {
      return;
    }
    device.manualMode = mode;
    device.manualSegments = mode && Array.isArray(indices) && indices.length > 0 ? indices.slice() : undefined;
    await this.stateManager.createSegmentStates(device);
    this.deviceManager?.persistDeviceToCache(device);
  }

  // ───────── Segment-Detection-Wizard ─────────

  /**
   * Handle incoming sendTo messages (from jsonConfig).
   *
   * @param obj ioBroker message object
   */
  /** Construct host object for MessageRouter. */
  private buildMessageRouterHost(): MessageRouterHost {
    return {
      log: this.log,
      getConfig: () => {
        const config = this.config as unknown as AdapterConfig;
        return {
          goveeEmail: config.goveeEmail,
          goveePassword: config.goveePassword,
          mqttVerificationCode: config.mqttVerificationCode,
        };
      },
      sendResponse: (obj, data) => this.sendMessageResponse(obj, data),
      createMqttProbeClient: () => {
        const config = this.config as unknown as AdapterConfig;
        return new GoveeMqttClient(config.goveeEmail, config.goveePassword, this.log, this);
      },
      getSegmentDeviceList: () => {
        const devices = this.deviceManager?.getDevices() ?? [];
        return devices
          .filter(d => d.sku !== "BaseGroup" && d.state?.online === true && resolveSegmentCount(d) > 0)
          .map(d => ({
            value: wizardHandler.deviceKeyFor(d),
            label: `${d.name} (${d.sku}, bisher ${resolveSegmentCount(d)} Segmente)`,
          }));
      },
      runWizardStep: (action, deviceKey) => wizardHandler.runWizardStep(this, action, deviceKey),
    };
  }

  /**
   * Helper: clear `mqttVerificationCode` in adapter native after a successful
   * login or a 455-fail.
   *
   * Idempotent: liest erst den aktuellen Wert, schreibt nur wenn dirty.
   * Verhindert den Adapter-Restart der durch jeden
   * `extendForeignObjectAsync(system.adapter.X, native:...)`-Call ausgelöst
   * wird (Memory v2.1.3-Bug). Vorher gab es nach jedem 2FA-Login einen
   * unnötigen Restart.
   *
   * @param obj ioBroker message object
   * @param data Response data payload
   */
  private sendMessageResponse(obj: ioBroker.Message, data: unknown): void {
    if (obj.callback && obj.from) {
      this.sendTo(obj.from, obj.command, data as Record<string, unknown>, obj.callback);
    }
  }

  /** Construct host object for SnapshotHandler — adapter dependencies injected. */
  /** Dropdowns whose value is a mode-selection — reset to "---" (0) when the mode stops. */
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new GoveeAdapter(options);
} else {
  (() => new GoveeAdapter())();
}
