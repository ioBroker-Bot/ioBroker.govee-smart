# ioBroker.govee-smart

[![npm version](https://img.shields.io/npm/v/iobroker.govee-smart)](https://www.npmjs.com/package/iobroker.govee-smart)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.govee-smart)](https://www.npmjs.com/package/iobroker.govee-smart)
![Installations](https://iobroker.live/badges/govee-smart-installed.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="admin/govee-smart.svg" width="100" alt="govee-smart" />

Control all [Govee](https://www.govee.com/) WiFi products from ioBroker — lights, sensors and appliances. Bluetooth-only devices are not supported.

The adapter uses every available Govee channel (LAN, Cloud REST, AWS IoT MQTT, OpenAPI MQTT, App API) and picks whichever delivers the fastest answer for each device. Details in the **[Wiki](https://github.com/krobipd/ioBroker.govee-smart/wiki)**.

---

## Documentation

Full user documentation lives in the **[Wiki](https://github.com/krobipd/ioBroker.govee-smart/wiki)**.

| Topic                                                                       | English                                                                                               | Deutsch                                                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Landing page                                                                | [Home](https://github.com/krobipd/ioBroker.govee-smart/wiki/Home)                                     | [Startseite](https://github.com/krobipd/ioBroker.govee-smart/wiki/Startseite)                           |
| Channels, credentials, API key, experimental devices                        | [Setup](https://github.com/krobipd/ioBroker.govee-smart/wiki/Setup)                                   | [Einrichtung](https://github.com/krobipd/ioBroker.govee-smart/wiki/Einrichtung)                         |
| Supported models, status meanings, contributing yours                       | [Devices](https://github.com/krobipd/ioBroker.govee-smart/wiki/Devices)                               | [Geräte](https://github.com/krobipd/ioBroker.govee-smart/wiki/Geraete)                                  |
| Every datapoint, where it lands, what it does                               | [State tree](https://github.com/krobipd/ioBroker.govee-smart/wiki/State-Tree)                         | [Datenpunkte](https://github.com/krobipd/ioBroker.govee-smart/wiki/Datenpunkte)                         |
| Thermometers, heaters, kettles, etc. — state tree, updates, troubleshooting | [Sensors and Appliances](https://github.com/krobipd/ioBroker.govee-smart/wiki/Sensors-and-Appliances) | [Sensoren und Appliances](https://github.com/krobipd/ioBroker.govee-smart/wiki/Sensoren-und-Appliances) |
| Lights — segment count, wizard, cut strips, batch commands                  | [Segments](https://github.com/krobipd/ioBroker.govee-smart/wiki/Segments)                             | [Segmente](https://github.com/krobipd/ioBroker.govee-smart/wiki/Segmente)                               |
| Lights — scene library, speed slider, Cloud vs local snapshots              | [Scenes and Snapshots](https://github.com/krobipd/ioBroker.govee-smart/wiki/Scenes-and-Snapshots)     | [Szenen und Snapshots](https://github.com/krobipd/ioBroker.govee-smart/wiki/Szenen-und-Snapshots)       |
| Lights — group fan-out, capability intersection                             | [Groups](https://github.com/krobipd/ioBroker.govee-smart/wiki/Groups)                                 | [Gruppen](https://github.com/krobipd/ioBroker.govee-smart/wiki/Gruppen)                                 |
| Folder naming, startup, diagnostics, troubleshooting                        | [Behavior](https://github.com/krobipd/ioBroker.govee-smart/wiki/Behavior)                             | [Verhalten](https://github.com/krobipd/ioBroker.govee-smart/wiki/Verhalten)                             |

---

## Features

- **Capability-driven** — states are generated from what the Govee API reports for each device. No SKU hardcoding, no hand-maintained device list to fall behind.
- **LAN-first for lights** — UDP multicast discovery, sub-50 ms commands, status updates via AWS IoT MQTT
- **Cloud + MQTT push for sensors and appliances** — readings via the App API, events via the OpenAPI MQTT broker
- **Per-segment color and brightness** for LED strips with the right capability, including batch commands and an interactive segment detection wizard for cut strips
- **Scenes, DIY scenes, music mode, gradient toggle** — activated locally via BLE-over-LAN where possible, Cloud fallback otherwise
- **Cloud and local snapshots** — Govee-app snapshots and ioBroker-side snapshots side by side
- **Groups** — bridge Govee groups into ioBroker with capability intersection across members
- **Diagnostics export button per device** — one-click JSON dump for bug reports
- **Graceful degradation** — works LAN-only without any credentials; each tier unlocks more
- **Rate-limited Cloud usage** — daily and per-minute budgets aligned to Govee's quota

---

## Requirements

- Node.js >= 22
- ioBroker js-controller >= 7.0.7
- ioBroker Admin >= 7.8.23
- A Govee account and at least one Govee WiFi device. LAN control needs a light with LAN mode enabled in the Govee Home app — see Govee's [LAN-supported device list](https://app-h5.govee.com/user-manual/wlan-guide).

---

## Getting started

The adapter works LAN-only without any credentials. Adding an API key unlocks scenes, segments, sensors and appliances. Adding your Govee email and password adds real-time status push and full group control. See the [Setup page](https://github.com/krobipd/ioBroker.govee-smart/wiki/Setup) for credential levels, how to get an API key, and network requirements.

---

## Device support

Each device shows its test status under `diag.tier`. The [Devices page](https://github.com/krobipd/ioBroker.govee-smart/wiki/Devices) lists every supported model and what the status means.

---

## Troubleshooting

Common issues (no devices discovered, empty scenes dropdown, segment colors not changing, limited group commands, delayed status updates) are covered on the Wiki [Behavior](https://github.com/krobipd/ioBroker.govee-smart/wiki/Behavior) / [Verhalten](https://github.com/krobipd/ioBroker.govee-smart/wiki/Verhalten) page.

For anything else, press **`diag.export`** on the affected device, copy the JSON from `diag.result`, and open a [GitHub Issue](https://github.com/krobipd/ioBroker.govee-smart/issues).

---

## Acknowledgments

This adapter's MQTT authentication and BLE-over-LAN (ptReal) protocol implementation was informed by research from [govee2mqtt](https://github.com/wez/govee2mqtt) by Wez Furlong. Their reverse-engineering of the Govee AWS IoT MQTT protocol and undocumented API endpoints was invaluable.

---

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### 2.13.0 (2026-05-21)

- Honest LAN status at startup — shows "LAN ✗" when no lights are reachable locally, with instructions to enable the local API
- Lights without local API now fall back to cloud control instead of failing silently

### 2.12.2 (2026-05-20)

- Verified against Node.js 24. Internal cleanup for stricter ioBroker repochecker compliance.

### 2.12.1 (2026-05-19)

- Code quality enforced with standard formatting.

### 2.12.0 (2026-05-17)

- Removed unused `info.legacyMqttCleaned` datapoint (internal migration marker, no user value)
- All info datapoint names now show in 11 languages instead of English-only

### 2.11.1 (2026-05-16)

- Internal cleanup. No user-facing changes.

Older entries are in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## Support

- [Wiki](https://github.com/krobipd/ioBroker.govee-smart/wiki) — user documentation (EN / DE)
- [GitHub Issues](https://github.com/krobipd/ioBroker.govee-smart/issues) — bug reports, feature requests
- [ioBroker Forum](https://forum.iobroker.net/) — general questions

### Support Development

This adapter is free and open source. If you find it useful, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge)](https://paypal.me/krobipd)

---

## License

MIT License

Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

*Developed with assistance from Claude.ai*
