// Augments the global `ioBroker.AdapterConfig` interface so `this.config`
// in the adapter class is automatically typed without `as unknown as ...`
// casts. The shape mirrors `io-package.json:native`.
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      /** Govee Cloud API key (optional — enables scenes, segments, device names) */
      apiKey: string;
      /** Govee account email (optional — enables MQTT real-time status) */
      goveeEmail: string;
      /** Govee account password (optional — enables MQTT real-time status) */
      goveePassword: string;
      /** Network interface IP for LAN multicast (empty = all interfaces) */
      networkInterface: string;
      /**
       * Activate device entries with status `seed` from `devices.json`. Off by
       * default — these devices are prepared in code but unconfirmed by any
       * tester. The Wiki lists every device and its status.
       */
      experimentalQuirks: boolean;
      /**
       * Govee 2FA verification code. Empty unless Govee has demanded 2FA on the
       * account (status 454). User pastes the code from the Govee email here,
       * adapter consumes it on the next login and clears the field automatically
       * on success. Cleared automatically on 454/455 fail too.
       */
      mqttVerificationCode: string;
    }
  }
}

// This file needs to be a module — see https://www.typescriptlang.org/docs/handbook/declaration-files/templates/global-modifying-module-d-ts.html
export {};
