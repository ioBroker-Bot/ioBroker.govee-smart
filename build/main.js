"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_capability_mapper = require("./lib/capability-mapper");
var import_device_registry = require("./lib/device-registry");
var import_device_manager = require("./lib/device-manager");
var import_govee_api_client = require("./lib/govee-api-client");
var import_govee_cloud_client = require("./lib/govee-cloud-client");
var import_govee_lan_client = require("./lib/govee-lan-client");
var import_govee_mqtt_client = require("./lib/govee-mqtt-client");
var import_govee_openapi_mqtt_client = require("./lib/govee-openapi-mqtt-client");
var import_local_snapshots = require("./lib/local-snapshots");
var import_snapshot_handler = require("./lib/snapshot-handler");
var import_group_fanout = require("./lib/group-fanout");
var import_message_router = require("./lib/message-router");
var cloudCreds = __toESM(require("./lib/handlers/cloud-creds-handler"));
var cloudRetryHandler = __toESM(require("./lib/handlers/cloud-retry-handler"));
var groupFanoutHandler = __toESM(require("./lib/handlers/group-fanout-handler"));
var groupStateHelpers = __toESM(require("./lib/handlers/group-state-helpers"));
var snapshotHandlerGlue = __toESM(require("./lib/handlers/snapshot-handler-glue"));
var stateChangeRouter = __toESM(require("./lib/handlers/state-change-router"));
var wizardHandler = __toESM(require("./lib/handlers/wizard-handler"));
var import_rate_limiter = require("./lib/rate-limiter");
var import_segment_wizard = require("./lib/segment-wizard");
var import_sku_cache = require("./lib/sku-cache");
var import_state_manager = require("./lib/state-manager");
var import_types = require("./lib/types");
var import_timing_constants = require("./lib/timing-constants");
var import_govee_constants = require("./lib/govee-constants");
var import_http_client = require("./lib/http-client");
class GoveeAdapter extends utils.Adapter {
  /** Public for handler modules (state-change-router, group-fanout, wizard, snapshot, diagnostics). */
  deviceManager = null;
  /** Public for handler modules. */
  stateManager = null;
  /** Public for handler modules. */
  lanClient = null;
  mqttClient = null;
  openapiMqttClient = null;
  /** Public for handler modules. */
  cloudClient = null;
  rateLimiter = null;
  /** Repeating timer for the App-API poll (sensor-state pull). */
  appApiPollTimer;
  /**
   * One-shot timer for the FIRST app-api poll (5s nach start) — Handle
   *  damit onUnload das wegräumen kann bevor es ins Leere feuert.
   */
  appApiInitialTimer;
  /** One-shot timer for cloud-init 60s safety timeout — gleiches Pattern. */
  /** Public for handler modules. */
  cloudInitTimer;
  /**
   * Letzter info.connection-Wert — Cache damit nicht jeder device-update
   *  einen unnötigen setStateAsync macht (H4).
   */
  lastConnectionState = null;
  // === Lifecycle-Flags (Adapter-Boot-Sequenz) ===
  // checkAllReady() prüft alle 5 Voraussetzungen gleichzeitig — sie laufen
  // parallel ab, kein lineares STATE_MACHINE-Pattern weil Channels
  // unabhängig connecten.
  /** LAN-Scan-Initial-Wait abgeschlossen (3s nach Start). */
  lanScanDone = false;
  /** State-Tree-Erstellung für alle Cached/Cloud-Devices fertig. */
  statesReady = false;
  /** Cloud-Init-Phase abgeschlossen (mit oder ohne Erfolg). */
  cloudInitDone = false;
  /** True nach dem ersten erfolgreichen App-API-Poll (für Sensoren mit Werten). */
  appApiInitialPollDone = false;
  /** Verhindert Mehrfach-Ready-Log innerhalb derselben Adapter-Session. */
  readyLogged = false;
  /** Cloud war mindestens einmal connected — für „restored"-Log nach Down. */
  /** Public for handler modules. */
  cloudWasConnected = false;
  /** Tägliches Interval für App-Version-Drift-Check gegen App-Store. */
  appVersionCheckTimer;
  // === Sub-Komponenten ===
  skuCache = null;
  /** Public for handler modules. */
  localSnapshots = null;
  /** Public for handler modules (state-change-router). */
  snapshotHandler = null;
  /** Public for handler modules (state-change-router). */
  groupFanout = null;
  messageRouter = null;
  stateCreationQueue = [];
  lanScanTimer;
  cleanupTimer;
  readyTimer;
  /** Public for handler modules. Undefined until first ensureCloudRetry() call. */
  cloudRetry;
  /** Public for handlers/wizard-handler — lazily instantiated by `runWizardStep`. */
  segmentWizard = null;
  unhandledRejectionHandler = null;
  uncaughtExceptionHandler = null;
  /** Per-device timestamp of the last diagnostics export — throttle gate */
  /** Public for handler modules (state-change-router, diagnostics). */
  diagnosticsLastRun = /* @__PURE__ */ new Map();
  /** Cached admin language from system.config — used for wizard UI text */
  /** Public for handler modules. */
  adminLanguage = "en";
  /** Last time `requestCode` was triggered via onMessage — guards against double-click email spam. */
  lastVerificationRequestMs = 0;
  /**
   * Set true at the start of onUnload — async paths (onStateChange,
   * applyCloudCapabilities, retrySceneData, …) check this between awaits
   * and bail before further setStateAsync against a torn-down adapter.
   */
  /** Public for handler modules (state-change-router). */
  unloading = false;
  /** Initial app-version-check timer (2 min after start) — kept so onUnload can clear it. */
  appVersionInitialTimer;
  /** @param options Adapter options */
  constructor(options = {}) {
    super({ ...options, name: "govee-smart" });
    this.on(
      "ready",
      () => this.onReady().catch(
        (e) => {
          var _a;
          return this.log.error(`onReady crashed: ${e instanceof Error ? (_a = e.stack) != null ? _a : e.message : String(e)}`);
        }
      )
    );
    this.on(
      "stateChange",
      (id, state) => stateChangeRouter.onStateChange(this, id, state).catch((e) => this.log.warn(`onStateChange crashed for ${id}: ${(0, import_types.errMessage)(e)}`))
    );
    this.on("message", (obj) => {
      var _a;
      return (_a = this.messageRouter) == null ? void 0 : _a.onMessage(obj);
    });
    this.on("unload", (callback) => this.onUnload(callback));
    this.unhandledRejectionHandler = (reason) => {
      var _a;
      this.log.error(
        `Unhandled rejection: ${reason instanceof Error ? (_a = reason.stack) != null ? _a : reason.message : String(reason)}`
      );
    };
    this.uncaughtExceptionHandler = (err) => {
      var _a;
      this.log.error(`Uncaught exception: ${(_a = err.stack) != null ? _a : err.message}`);
    };
    process.on("unhandledRejection", this.unhandledRejectionHandler);
    process.on("uncaughtException", this.uncaughtExceptionHandler);
  }
  /** Adapter started — initialize all channels */
  async onReady() {
    var _a, _b, _c, _d;
    const config = this.config;
    await this.setStateAsync("info.connection", { val: false, ack: true });
    await this.setStateAsync("info.mqttConnected", { val: false, ack: true });
    await this.setStateAsync("info.cloudConnected", { val: false, ack: true });
    await this.setStateAsync("info.openapiMqttConnected", {
      val: false,
      ack: true
    });
    await this.setStateAsync("info.refresh_cloud_data", {
      val: false,
      ack: true
    });
    try {
      const sysConf = await this.getForeignObjectAsync("system.config");
      const lang = (_a = sysConf == null ? void 0 : sysConf.common) == null ? void 0 : _a.language;
      if (typeof lang === "string" && lang.length > 0) {
        this.adminLanguage = lang;
      }
    } catch {
    }
    await this.setStateAsync("info.wizardStatus", {
      val: (0, import_segment_wizard.wizardIdleText)(this.adminLanguage),
      ack: true
    });
    this.stateManager = new import_state_manager.StateManager(this);
    await this.stateManager.createGroupsOnlineState(false);
    this.deviceManager = new import_device_manager.DeviceManager(this.log, this);
    const dataDir = utils.getAbsoluteInstanceDataDir(this);
    (0, import_device_registry.initDeviceRegistry)({
      experimental: config.experimentalQuirks === true,
      log: this.log
    });
    this.skuCache = new import_sku_cache.SkuCache(dataDir, this.log);
    this.localSnapshots = new import_local_snapshots.LocalSnapshotStore(dataDir, this.log);
    this.snapshotHandler = new import_snapshot_handler.SnapshotHandler(snapshotHandlerGlue.buildSnapshotHost(this));
    this.groupFanout = new import_group_fanout.GroupFanoutHandler(groupFanoutHandler.buildGroupFanoutHost(this));
    this.messageRouter = new import_message_router.MessageRouter(this.buildMessageRouterHost());
    this.deviceManager.setSkuCache(this.skuCache);
    const apiClient = new import_govee_api_client.GoveeApiClient();
    apiClient.setEmail(config.goveeEmail);
    this.deviceManager.setApiClient(apiClient);
    this.deviceManager.setCallbacks(
      (device, state) => this.onDeviceStateUpdate(device, state),
      (devices) => this.onDeviceListChanged(devices)
    );
    this.deviceManager.onLanIpChanged = (device, ip) => {
      const prefix = this.stateManager.devicePrefix(device);
      this.setStateAsync(`${prefix}.info.ip`, { val: ip, ack: true }).catch(() => {
      });
    };
    this.deviceManager.onSegmentBatchUpdate = (device, batch) => {
      const prefix = this.stateManager.devicePrefix(device);
      const cap = typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : 0;
      for (const idx of batch.segments) {
        if (cap === 0 || idx >= cap) {
          continue;
        }
        if (batch.color !== void 0) {
          const hex = (0, import_types.rgbIntToHex)(batch.color);
          this.setStateAsync(`${prefix}.segments.${idx}.color`, {
            val: hex,
            ack: true
          }).catch(() => {
          });
        }
        if (batch.brightness !== void 0) {
          this.setStateAsync(`${prefix}.segments.${idx}.brightness`, {
            val: batch.brightness,
            ack: true
          }).catch(() => {
          });
        }
      }
    };
    this.deviceManager.onMqttSegmentUpdate = (device, segments) => {
      const prefix = this.stateManager.devicePrefix(device);
      const cap = typeof device.segmentCount === "number" && device.segmentCount > 0 ? device.segmentCount : 0;
      for (const seg of segments) {
        if (cap === 0 || seg.index >= cap) {
          continue;
        }
        this.setStateAsync(`${prefix}.segments.${seg.index}.color`, {
          val: (0, import_types.rgbToHex)(seg.r, seg.g, seg.b),
          ack: true
        }).catch(() => {
        });
        this.setStateAsync(`${prefix}.segments.${seg.index}.brightness`, {
          val: seg.brightness,
          ack: true
        }).catch(() => {
        });
      }
    };
    this.deviceManager.onSegmentCountGrown = (device) => {
      if (!this.stateManager) {
        return;
      }
      this.stateManager.createSegmentStates(device).catch((e) => {
        this.log.warn(`Failed to rebuild segment tree for ${device.name} after count growth: ${(0, import_types.errMessage)(e)}`);
      });
    };
    const startChannels = ["LAN"];
    if (config.apiKey) {
      startChannels.push("Cloud");
    }
    if (config.goveeEmail && config.goveePassword) {
      startChannels.push("MQTT");
    }
    this.log.info(`Starting (${startChannels.join(", ")})`);
    this.lanClient = new import_govee_lan_client.GoveeLanClient(this.log, this);
    this.deviceManager.setLanClient(this.lanClient);
    this.lanClient.start(
      (lanDevice) => {
        var _a2;
        this.deviceManager.handleLanDiscovery(lanDevice);
        if (!((_a2 = this.mqttClient) == null ? void 0 : _a2.connected)) {
          this.lanClient.requestStatus(lanDevice.ip);
        }
      },
      (sourceIp, status) => {
        this.deviceManager.handleLanStatus(sourceIp, status);
      },
      3e4,
      config.networkInterface || ""
    );
    this.lanScanTimer = this.setTimeout(() => {
      this.lanScanDone = true;
      this.checkAllReady();
    }, 3e3);
    if (config.goveeEmail && config.goveePassword) {
      this.mqttClient = new import_govee_mqtt_client.GoveeMqttClient(config.goveeEmail, config.goveePassword, this.log, this);
      this.mqttClient.setPacketHook((deviceId, topic, hex) => {
        var _a2;
        (_a2 = this.deviceManager) == null ? void 0 : _a2.getDiagnostics().addMqttPacket(deviceId, topic, hex);
      });
      this.mqttClient.setVerificationCode((_b = config.mqttVerificationCode) != null ? _b : "");
      this.mqttClient.setOnVerificationConsumed(() => {
        cloudCreds.clearVerificationCodeSetting(this).catch((e) => {
          this.log.warn(`Could not clear mqttVerificationCode: ${(0, import_types.errMessage)(e)}`);
        });
      });
      this.mqttClient.setOnVerificationFailed((reason) => {
        if (reason === "failed") {
          cloudCreds.clearVerificationCodeSetting(this).catch(() => {
          });
        }
      });
      await cloudCreds.cleanupLegacyMqttNativeOnce(this);
      const cachedCreds = await cloudCreds.loadPersistedCredsFromState(this);
      if (cachedCreds) {
        this.mqttClient.setPersistedCredentials(cachedCreds);
      }
      this.mqttClient.setOnCredentialsRefresh((creds) => {
        cloudCreds.persistCredsToState(this, creds).catch((e) => {
          this.log.warn(`Could not persist MQTT credentials: ${(0, import_types.errMessage)(e)}`);
        });
      });
      await this.mqttClient.connect(
        (update) => this.deviceManager.handleMqttStatus(update),
        (connected) => {
          this.setStateAsync("info.mqttConnected", {
            val: connected,
            ack: true
          }).catch(() => {
          });
          if (connected) {
            this.checkAllReady();
          }
          this.updateConnectionState();
        },
        // Forward every fresh bearer token — fires on initial login and on
        // each reconnect-login, so the API client never runs with a stale one.
        (token) => apiClient.setBearerToken(token)
      );
    }
    const cachedOk = this.deviceManager.loadFromCache();
    if (config.apiKey) {
      this.cloudClient = new import_govee_cloud_client.GoveeCloudClient(config.apiKey, this.log);
      this.cloudClient.setResponseHook((deviceId, endpoint, body) => {
        var _a2;
        (_a2 = this.deviceManager) == null ? void 0 : _a2.getDiagnostics().setApiResponse(deviceId, endpoint, body);
      });
      this.deviceManager.setCloudClient(this.cloudClient);
      this.deviceManager.setOnCloudCapabilities((device, caps) => {
        this.applyCloudCapabilities(device, caps).catch(
          (e) => this.log.warn(`applyCloudCapabilities failed for ${device.sku}: ${(0, import_types.errMessage)(e)}`)
        );
      });
      this.rateLimiter = new import_rate_limiter.RateLimiter(this.log, this, import_timing_constants.CLOUD_FULL_LIMITS.perMinute, import_timing_constants.CLOUD_FULL_LIMITS.perDay);
      this.rateLimiter.start();
      this.deviceManager.setRateLimiter(this.rateLimiter);
      this.openapiMqttClient = new import_govee_openapi_mqtt_client.GoveeOpenapiMqttClient(config.apiKey, this.log, this);
      this.openapiMqttClient.connect(
        (event) => {
          var _a2;
          return (_a2 = this.deviceManager) == null ? void 0 : _a2.handleOpenApiEvent(event);
        },
        (connected) => {
          this.setStateAsync("info.openapiMqttConnected", {
            val: connected,
            ack: true
          }).catch(() => {
          });
        }
      );
      const triggerAppApiPoll = () => {
        var _a2;
        (_a2 = this.deviceManager) == null ? void 0 : _a2.pollAppApi().then(() => {
          if (!this.appApiInitialPollDone) {
            this.appApiInitialPollDone = true;
            this.checkAllReady();
          }
        }).catch((e) => this.log.debug(`pollAppApi failed: ${(0, import_types.errMessage)(e)}`));
      };
      this.appApiPollTimer = this.setInterval(triggerAppApiPoll, import_timing_constants.APP_API_POLL_INTERVAL_MS);
      this.appApiInitialTimer = this.setTimeout(triggerAppApiPoll, import_timing_constants.APP_API_INITIAL_DELAY_MS);
      if (!cachedOk) {
        const result = await cloudRetryHandler.cloudInitWithTimeout(this);
        this.cloudWasConnected = result.ok;
        cloudRetryHandler.ensureCloudRetry(this).setConnected(result.ok);
        this.setStateAsync("info.cloudConnected", {
          val: result.ok,
          ack: true
        }).catch(() => {
        });
        (_c = this.stateManager) == null ? void 0 : _c.updateGroupsOnline(result.ok).catch(() => {
        });
        if (result.ok) {
          await this.loadCloudStates();
        } else {
          cloudRetryHandler.handleCloudFailure(this, result);
        }
      } else {
        this.log.info(`Using cached device data \u2014 no Cloud calls needed`);
        this.cloudWasConnected = true;
        cloudRetryHandler.ensureCloudRetry(this).setConnected(true);
        this.setStateAsync("info.cloudConnected", {
          val: true,
          ack: true
        }).catch(() => {
        });
        (_d = this.stateManager) == null ? void 0 : _d.updateGroupsOnline(true).catch(() => {
        });
      }
      await this.deviceManager.loadGroupMembers();
      this.cloudInitDone = true;
    }
    while (this.stateCreationQueue.length > 0) {
      const pending = this.stateCreationQueue;
      this.stateCreationQueue = [];
      await Promise.all(pending);
    }
    this.statesReady = true;
    await this.subscribeStatesAsync("devices.*");
    await this.subscribeStatesAsync("groups.*");
    await this.subscribeStatesAsync("info.refresh_cloud_data");
    this.cleanupTimer = this.setTimeout(() => {
      this.reapStaleDevices().catch((e) => this.log.debug(`Device cleanup failed: ${(0, import_types.errMessage)(e)}`));
    }, 3e4);
    this.appVersionCheckTimer = this.setInterval(
      () => {
        this.checkAppVersionDrift().catch((e) => this.log.debug(`App version check error: ${(0, import_types.errMessage)(e)}`));
      },
      24 * 60 * 60 * 1e3
    );
    this.appVersionInitialTimer = this.setTimeout(
      () => {
        this.appVersionInitialTimer = void 0;
        if (this.unloading) {
          return;
        }
        this.checkAppVersionDrift().catch((e) => this.log.debug(`App version check error: ${(0, import_types.errMessage)(e)}`));
      },
      2 * 60 * 1e3
    );
    this.updateConnectionState();
    this.checkAllReady();
    this.readyTimer = this.setTimeout(() => {
      if (!this.readyLogged) {
        this.readyLogged = true;
        this.logDeviceSummary();
      }
    }, 6e4);
  }
  /**
   * Adapter stopping — MUST be synchronous.
   *
   * @param callback Completion callback
   */
  onUnload(callback) {
    var _a, _b, _c, _d, _e, _f;
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
        this.appApiPollTimer = void 0;
      }
      if (this.appApiInitialTimer) {
        this.clearTimeout(this.appApiInitialTimer);
        this.appApiInitialTimer = void 0;
      }
      if (this.cloudInitTimer) {
        this.clearTimeout(this.cloudInitTimer);
        this.cloudInitTimer = void 0;
      }
      if (this.appVersionCheckTimer) {
        this.clearInterval(this.appVersionCheckTimer);
        this.appVersionCheckTimer = void 0;
      }
      if (this.appVersionInitialTimer) {
        this.clearTimeout(this.appVersionInitialTimer);
        this.appVersionInitialTimer = void 0;
      }
      (_a = this.cloudRetry) == null ? void 0 : _a.dispose();
      (_b = this.segmentWizard) == null ? void 0 : _b.dispose();
      (_c = this.lanClient) == null ? void 0 : _c.stop();
      (_d = this.mqttClient) == null ? void 0 : _d.disconnect();
      (_e = this.openapiMqttClient) == null ? void 0 : _e.disconnect();
      (_f = this.rateLimiter) == null ? void 0 : _f.stop();
      if (this.unhandledRejectionHandler) {
        process.off("unhandledRejection", this.unhandledRejectionHandler);
        this.unhandledRejectionHandler = null;
      }
      if (this.uncaughtExceptionHandler) {
        process.off("uncaughtException", this.uncaughtExceptionHandler);
        this.uncaughtExceptionHandler = null;
      }
      this.setState("info.connection", { val: false, ack: true }).catch(() => {
      });
      this.setState("info.mqttConnected", { val: false, ack: true }).catch(() => {
      });
      this.setState("info.openapiMqttConnected", {
        val: false,
        ack: true
      }).catch(() => {
      });
      this.setState("info.cloudConnected", { val: false, ack: true }).catch(() => {
      });
    } catch {
    }
    callback();
  }
  /**
   * Public delegate to stateChangeRouter — required by GroupFanoutHandlerAdapter interface.
   *
   * @param device
   * @param prefix
   * @param changedSuffix
   * @param newValue
   */
  async sendMusicCommand(device, prefix, changedSuffix, newValue) {
    return stateChangeRouter.sendMusicCommand(this, device, prefix, changedSuffix, newValue);
  }
  /**
   * Called by device-manager when a device state changes
   *
   * @param device Updated device
   * @param state Changed state values
   */
  onDeviceStateUpdate(device, state) {
    if (this.stateManager) {
      this.stateManager.updateDeviceState(device, state).catch(() => {
      });
    }
    this.updateConnectionState();
    if (state.online !== void 0) {
      groupFanoutHandler.updateGroupReachability(this);
    }
    const powerOff = state.power === false || state.power === 0;
    if (powerOff && this.stateManager) {
      const prefix = this.stateManager.devicePrefix(device);
      groupStateHelpers.resetModeDropdowns(this, prefix, "").catch(() => void 0);
    }
  }
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
   * Public for handler modules (snapshot-glue, group-fanout, state-change-router).
   *
   * @param device
   * @param allDevices
   */
  refreshDeviceStates(device, allDevices) {
    var _a;
    if (!this.stateManager) {
      return;
    }
    const localSnaps = (_a = this.localSnapshots) == null ? void 0 : _a.getSnapshots(device.sku, device.deviceId);
    let memberDevices;
    if (device.sku === "BaseGroup" && device.groupMembers) {
      memberDevices = groupFanoutHandler.resolveGroupMembers(device, allDevices);
    }
    const stateDefs = (0, import_capability_mapper.buildDeviceStateDefs)(device, localSnaps, memberDevices);
    const p = this.stateManager.createDeviceStates(device, stateDefs).then(async () => {
      var _a2, _b;
      await ((_a2 = this.stateManager) == null ? void 0 : _a2.migrateLegacyDiagnostics(device));
      await ((_b = this.stateManager) == null ? void 0 : _b.updateDeviceTier(device, (0, import_device_registry.getDeviceTier)(device.sku)));
    }).catch((e) => {
      this.log.error(`createDeviceStates failed for ${device.name}: ${(0, import_types.errMessage)(e)}`);
    });
    if (!this.statesReady) {
      this.stateCreationQueue.push(p);
    } else {
      void p;
    }
  }
  /**
   * Called by device-manager when the device list changes
   *
   * @param devices Current list of all devices
   */
  onDeviceListChanged(devices) {
    if (!this.stateManager) {
      return;
    }
    for (const device of devices) {
      this.refreshDeviceStates(device, devices);
    }
    this.updateConnectionState();
    if (this.statesReady) {
      this.reapStaleDevices().catch(() => void 0);
    }
  }
  /**
   * Update global `info.connection` — der ioBroker-IDC-Indikator.
   *
   * Semantik:
   * - Mit Devices: `connected = true` wenn MIND. ein Device online ist.
   *   Wenn alle offline → false (User sieht: kein Device antwortet).
   * - Ohne Devices: `connected = true` wenn der LAN-Stack läuft. Sonst
   *   false (z.B. EADDRINUSE oder bind-Fehler).
   *
   * H4 (geplant für Phase H): nur bei tatsächlichem Wechsel schreiben
   * (cache lastConnectedValue). Aktuell läuft updateConnectionState bei
   * jedem device-state-update — fire-and-forget setStateAsync, nur leichter
   * Overhead.
   */
  updateConnectionState() {
    var _a, _b;
    const devices = (_b = (_a = this.deviceManager) == null ? void 0 : _a.getDevices()) != null ? _b : [];
    const hasDevices = devices.length > 0;
    const anyOnline = devices.some((d) => d.state.online);
    const lanRunning = this.lanClient !== null;
    const connected = hasDevices ? anyOnline : lanRunning;
    if (connected !== this.lastConnectionState) {
      this.lastConnectionState = connected;
      this.setStateAsync("info.connection", { val: connected, ack: true }).catch(() => {
      });
    }
  }
  /**
   * Delete ioBroker objects for devices no longer present and drop the same
   * devices from adapter-level maps. Called after the initial-discovery
   * window and every time the device list changes.
   *
   * Scope of "stale" today: cleanupDevices compares the ioBroker object tree
   * against the live device-manager registry — it deletes objects that
   * outlive their entry in `DeviceManager.devices`. In v2.0 that registry is
   * monotonically growing within a single adapter lifetime (entries only
   * leave via cache pruning across restarts), so this primarily catches
   * tree leftovers from a previous adapter version after upgrade. The
   * adapter-level `diagnosticsLastRun` map is also reaped so it can't outlive
   * its devices either.
   *
   * A future stale-pruning step that explicitly retires devices from the
   * device-manager registry should also drop the device from
   * `deviceManager.devices` and call `getDiagnostics().forget(deviceId)` for
   * each retired device — those reaping APIs come in with the pruning patch,
   * not before (Memory `feedback_kein_phantom_schema`).
   */
  /**
   * App-Version-Drift-Check gegen iTunes-Lookup.
   *
   * Govee's app2.govee.com-Endpoints rejecten manchmal sehr alte
   * User-Agent-Strings. Daily-Check fragt iTunes nach der aktuellen
   * iOS-App-Version + vergleicht mit `GOVEE_APP_VERSION`. Bei Drift > 2
   * minor versions: warn-Log + state `info.appVersionDrift` schreiben.
   *
   * Failures (5xx, network) werden silent debug-geloggt — kein User-Impact.
   */
  async checkAppVersionDrift() {
    var _a, _b, _c, _d, _e, _f;
    try {
      const resp = await (0, import_http_client.httpsRequest)({
        method: "GET",
        url: "https://itunes.apple.com/lookup?bundleId=com.ihoment.GoVeeSensor",
        headers: { "User-Agent": "ioBroker.govee-smart" },
        timeout: 1e4
      });
      const liveVersion = (_b = (_a = resp.results) == null ? void 0 : _a[0]) == null ? void 0 : _b.version;
      if (typeof liveVersion !== "string" || liveVersion.length === 0) {
        return;
      }
      const localParts = import_govee_constants.GOVEE_APP_VERSION.split(".").map(Number);
      const liveParts = liveVersion.split(".").map(Number);
      const localMajor = (_c = localParts[0]) != null ? _c : 0;
      const localMinor = (_d = localParts[1]) != null ? _d : 0;
      const liveMajor = (_e = liveParts[0]) != null ? _e : 0;
      const liveMinor = (_f = liveParts[1]) != null ? _f : 0;
      const liveTotal = liveMajor * 100 + liveMinor;
      const localTotal = localMajor * 100 + localMinor;
      const driftMinor = liveTotal - localTotal;
      const driftMessage = driftMinor === 0 ? `current (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION})` : driftMinor <= 2 ? `minor drift (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION})` : `STALE (live=${liveVersion}, local=${import_govee_constants.GOVEE_APP_VERSION}) \u2014 bump GOVEE_APP_VERSION`;
      await this.setStateAsync("info.appVersionDrift", { val: driftMessage, ack: true }).catch(() => void 0);
      if (driftMinor > 2) {
        this.log.warn(
          `Govee app version drift: live ${liveVersion} vs local ${import_govee_constants.GOVEE_APP_VERSION} \u2014 undocumented endpoints may start failing. Run sync-govee-app-version.py + release a new adapter version.`
        );
      } else {
        this.log.debug(`App version: ${driftMessage}`);
      }
    } catch (e) {
      this.log.debug(`App version check failed: ${(0, import_types.errMessage)(e)}`);
    }
  }
  async reapStaleDevices() {
    if (!this.stateManager || !this.deviceManager) {
      return;
    }
    const currentDevices = this.deviceManager.getDevices();
    await this.stateManager.cleanupDevices(currentDevices);
    const liveDeviceIds = new Set(currentDevices.map((d) => d.deviceId));
    this.deviceManager.getDiagnostics().pruneOrphans(liveDeviceIds);
    const liveKeys = new Set(currentDevices.map((d) => `${d.sku}:${d.deviceId}`));
    for (const key of this.diagnosticsLastRun.keys()) {
      if (!liveKeys.has(key)) {
        this.diagnosticsLastRun.delete(key);
      }
    }
  }
  /**
   * Check if all configured channels are initialized and log ready message.
   * Called from MQTT onConnection callback and end of onReady.
   */
  checkAllReady() {
    var _a, _b;
    if (this.readyLogged) {
      return;
    }
    if (!this.lanScanDone) {
      return;
    }
    if (!this.statesReady) {
      return;
    }
    if (this.cloudClient && !this.cloudInitDone) {
      return;
    }
    if (this.mqttClient && !this.mqttClient.connected) {
      return;
    }
    if (this.openapiMqttClient && !this.openapiMqttClient.connected) {
      return;
    }
    if (((_a = this.deviceManager) == null ? void 0 : _a.hasDeviceNeedingAppApi()) && !this.appApiInitialPollDone) {
      return;
    }
    this.readyLogged = true;
    this.logDeviceSummary();
    (_b = this.deviceManager) == null ? void 0 : _b.saveDevicesToCache();
  }
  /**
   * Log final ready message with device/group/channel summary.
   */
  logDeviceSummary() {
    var _a, _b;
    if (!this.deviceManager) {
      return;
    }
    const all = this.deviceManager.getDevices();
    const devices = all.filter((d) => d.sku !== "BaseGroup");
    const groups = all.filter((d) => d.sku === "BaseGroup");
    const channels = ["LAN"];
    if (this.cloudWasConnected) {
      channels.push("Cloud");
    }
    if ((_a = this.mqttClient) == null ? void 0 : _a.connected) {
      channels.push("MQTT");
    }
    if ((_b = this.openapiMqttClient) == null ? void 0 : _b.connected) {
      channels.push("Cloud-events");
    }
    const lightDevices = devices.filter((d) => d.type === "devices.types.light");
    const onlineDevices = devices.filter((d) => d.state.online === true);
    const parts = [];
    if (devices.length > 0) {
      const onlineLights = lightDevices.filter((d) => d.state.online === true).length;
      const totalLights = lightDevices.length;
      if (totalLights > 0) {
        parts.push(
          totalLights === onlineLights ? `${totalLights} light${totalLights > 1 ? "s" : ""} online` : `${totalLights} light${totalLights > 1 ? "s" : ""} (${onlineLights} online, ${totalLights - onlineLights} offline)`
        );
      }
      const sensors = devices.length - lightDevices.length;
      if (sensors > 0) {
        const onlineSensors = onlineDevices.filter((d) => d.type !== "devices.types.light").length;
        parts.push(`${sensors} sensor${sensors > 1 ? "s" : ""} (${onlineSensors} with data)`);
      }
    }
    if (groups.length > 0) {
      parts.push(`${groups.length} group${groups.length > 1 ? "s" : ""}`);
    }
    const summary = parts.length > 0 ? parts.join(", ") : "no devices found";
    this.log.info(`Govee adapter ready \u2014 ${summary} \u2014 channels: ${channels.join("+")}`);
    if (this.cloudClient && !this.cloudWasConnected) {
      const reason = this.cloudClient.getFailureReason();
      this.log.warn(reason ? `Cloud not connected \u2014 ${reason}` : `Cloud not connected \u2014 see earlier errors`);
    }
    if (this.mqttClient && !this.mqttClient.connected) {
      const reason = this.mqttClient.getFailureReason();
      this.log.warn(reason ? `MQTT not connected \u2014 ${reason}` : `MQTT not connected \u2014 see earlier errors`);
    }
  }
  /**
   * Load current state for all Cloud devices and populate state values.
   * Called once after initial Cloud device list load.
   */
  /** Public for handler modules (cloud-retry). */
  async loadCloudStates() {
    if (!this.cloudClient || !this.deviceManager || !this.stateManager) {
      return;
    }
    const devices = this.deviceManager.getDevices();
    const lanStateIds = new Set((0, import_capability_mapper.getDefaultLanStates)().map((s) => s.id));
    let loaded = 0;
    for (const device of devices) {
      if (!device.channels.cloud || device.capabilities.length === 0) {
        continue;
      }
      try {
        const caps = await this.cloudClient.getDeviceState(device.sku, device.deviceId);
        const prefix = this.stateManager.devicePrefix(device);
        const writes = [];
        for (const cap of caps) {
          const mapped = (0, import_capability_mapper.mapCloudStateValue)(cap);
          if (!mapped) {
            continue;
          }
          if (device.lanIp && lanStateIds.has(mapped.stateId)) {
            continue;
          }
          const statePath = this.stateManager.resolveStatePath(prefix, mapped.stateId);
          writes.push(
            this.setStateAsync(statePath, {
              val: mapped.value,
              ack: true
            }).catch(() => void 0)
          );
        }
        await Promise.all(writes);
        loaded++;
      } catch {
        this.log.debug(`Could not load Cloud state for ${device.name} (${device.sku})`);
      }
    }
    if (loaded > 0) {
      this.log.debug(`Cloud states loaded for ${loaded} devices`);
    }
  }
  /**
   * Apply a list of synthesized Cloud-state capabilities to a single
   * device — the App-API poll and OpenAPI-MQTT events both use this path
   * so their values flow through the same `mapCloudStateValue` pipeline
   * that polled Cloud states use.
   *
   * @param device Target Govee device
   * @param caps Capabilities to apply
   */
  async applyCloudCapabilities(device, caps) {
    if (!this.stateManager) {
      return;
    }
    const lanStateIds = new Set((0, import_capability_mapper.getDefaultLanStates)().map((s) => s.id));
    const prefix = this.stateManager.devicePrefix(device);
    const planned = (0, import_capability_mapper.planCloudCapabilityWrites)(caps, Boolean(device.lanIp), lanStateIds);
    for (const mapped of planned) {
      await this.stateManager.ensureSyntheticStateObject(prefix, mapped.stateId);
    }
    const writes = planned.map((mapped) => {
      const statePath = this.stateManager.resolveStatePath(prefix, mapped.stateId);
      return this.setStateAsync(statePath, {
        val: mapped.value,
        ack: true
      }).catch(() => void 0);
    });
    await Promise.all(writes);
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
   * @param suffix
   */
  stateToCommand(suffix) {
    return groupStateHelpers.stateToCommand(suffix);
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
   * @param device
   * @param mode
   * @param indices
   */
  async applyManualSegments(device, mode, indices) {
    var _a;
    if (!this.stateManager) {
      return;
    }
    device.manualMode = mode;
    device.manualSegments = mode && Array.isArray(indices) && indices.length > 0 ? indices.slice() : void 0;
    await this.stateManager.createSegmentStates(device);
    (_a = this.deviceManager) == null ? void 0 : _a.persistDeviceToCache(device);
  }
  // ───────── Segment-Detection-Wizard ─────────
  /**
   * Handle incoming sendTo messages (from jsonConfig).
   *
   * @param obj ioBroker message object
   */
  /** Construct host object for MessageRouter. */
  buildMessageRouterHost() {
    return {
      log: this.log,
      getConfig: () => {
        const config = this.config;
        return {
          goveeEmail: config.goveeEmail,
          goveePassword: config.goveePassword,
          mqttVerificationCode: config.mqttVerificationCode
        };
      },
      sendResponse: (obj, data) => this.sendMessageResponse(obj, data),
      createMqttProbeClient: () => {
        const config = this.config;
        return new import_govee_mqtt_client.GoveeMqttClient(config.goveeEmail, config.goveePassword, this.log, this);
      },
      getSegmentDeviceList: () => {
        var _a, _b;
        const devices = (_b = (_a = this.deviceManager) == null ? void 0 : _a.getDevices()) != null ? _b : [];
        return devices.filter((d) => {
          var _a2;
          return d.sku !== "BaseGroup" && ((_a2 = d.state) == null ? void 0 : _a2.online) === true && (0, import_device_manager.resolveSegmentCount)(d) > 0;
        }).map((d) => ({
          value: wizardHandler.deviceKeyFor(d),
          label: `${d.name} (${d.sku}, bisher ${(0, import_device_manager.resolveSegmentCount)(d)} Segmente)`
        }));
      },
      runWizardStep: (action, deviceKey) => wizardHandler.runWizardStep(this, action, deviceKey)
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
   * @param obj
   * @param data
   */
  sendMessageResponse(obj, data) {
    if (obj.callback && obj.from) {
      this.sendTo(obj.from, obj.command, data, obj.callback);
    }
  }
  /** Construct host object for SnapshotHandler — adapter dependencies injected. */
  /** Dropdowns whose value is a mode-selection — reset to "---" (0) when the mode stops. */
}
if (require.main !== module) {
  module.exports = (options) => new GoveeAdapter(options);
} else {
  (() => new GoveeAdapter())();
}
//# sourceMappingURL=main.js.map
