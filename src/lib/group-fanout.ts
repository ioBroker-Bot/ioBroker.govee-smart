import { errMessage, type GoveeDevice } from "./types";
import { sessionKey } from "./device-key";

/**
 * Resolve a group's member references to the actual device objects. Builds a
 * once-per-call lookup index (sessionKey → device) instead of N×Array.find —
 * the canonical resolver shared by the GroupFanoutHandler class and the
 * group-fanout-handler glue (which re-exports it).
 *
 * @param group BaseGroup device with groupMembers
 * @param devices Full device list to search
 */
export function resolveGroupMembers(group: GoveeDevice, devices: GoveeDevice[]): GoveeDevice[] {
  if (!group.groupMembers) {
    return [];
  }
  const byKey = new Map<string, GoveeDevice>();
  for (const d of devices) {
    byKey.set(sessionKey(d.sku, d.deviceId), d);
  }
  const out: GoveeDevice[] = [];
  for (const m of group.groupMembers) {
    const d = byKey.get(sessionKey(m.sku, m.deviceId));
    if (d) {
      out.push(d);
    }
  }
  return out;
}

/**
 * Host interface for GroupFanoutHandler — the adapter functions the handler
 * needs without depending directly on the adapter class.
 *
 * Same pattern as `WizardHost` and `SnapshotHandlerHost`. main.ts stays slim
 * and the group fan-out path is isolated and testable.
 */
export interface GroupFanoutHost {
  /** Adapter logger. */
  log: ioBroker.Logger;
  /** Adapter namespace prefix (e.g. "govee-smart.0"). */
  namespace: string;
  /** Device list — typically DeviceManager.getDevices(). */
  getDevices: () => GoveeDevice[];
  /** Send-command via LAN→Cloud-Routing (DeviceManager.sendCommand). */
  sendCommand: (device: GoveeDevice, command: string, value: unknown) => Promise<void>;
  /** Resolved object prefix for a device. */
  devicePrefix: (device: GoveeDevice) => string;
  /** State-suffix → command-name lookup (main.ts STATE_TO_COMMAND map). */
  stateToCommand: (stateSuffix: string) => string | undefined;
  /** Get-object — for the common.states lookup during scene/music mapping. */
  getObject: (id: string) => Promise<ioBroker.Object | null | undefined>;
  /** Music command sender (wraps the music_mode/sensitivity/auto_color STRUCT). */
  sendMusicCommand: (
    device: GoveeDevice,
    devicePrefix: string,
    stateSuffix: string,
    value: ioBroker.StateValue,
  ) => Promise<void>;
}

/**
 * Group fan-out handler — dispatches group commands to the individual members
 * with a capability match. Previously 4 private methods (~100 lines) in main.ts.
 *
 * The scene/music special paths match the group dropdown name against the
 * member dropdown name — not 1:1 indices, because the members can have
 * different scene lists.
 */
export class GroupFanoutHandler {
  /**
   * @param host Adapter dependencies via the host interface
   */
  constructor(private readonly host: GroupFanoutHost) {}

  /**
   * Fan out a group command to all online member devices.
   * Basic controls (power/brightness/color) pass straight through.
   * Scenes/music are mapped by name.
   *
   * @param group BaseGroup device
   * @param stateSuffix State suffix (e.g. "control.power" or "scenes.light_scene")
   * @param value Command value
   */
  async fanOut(group: GoveeDevice, stateSuffix: string, value: ioBroker.StateValue): Promise<void> {
    if (!group.groupMembers) {
      return;
    }
    const devices = this.host.getDevices();
    const members = this.resolveMembers(group, devices).filter(d => d.state.online);
    if (members.length === 0) {
      this.host.log.debug(`Group "${group.name}": no reachable members for fan-out`);
      return;
    }
    const command = this.host.stateToCommand(stateSuffix);
    if (!command) {
      return;
    }
    // Dropdown reset — no command needed
    if ((command === "lightScene" || command === "music") && (value === "0" || value === 0)) {
      return;
    }
    for (const member of members) {
      try {
        if (command === "lightScene") {
          await this.fanOutScene(group, member, value);
        } else if (command === "music") {
          await this.fanOutMusic(group, member, stateSuffix, value);
        } else {
          await this.host.sendCommand(member, command, value);
        }
      } catch (err) {
        this.host.log.debug(`Group fan-out to ${member.name}: ${errMessage(err)}`);
      }
    }
  }

  /**
   * Resolve group member references to actual device objects.
   *
   * @param group BaseGroup device with groupMembers
   * @param devices Full device list to search
   */
  resolveMembers(group: GoveeDevice, devices: GoveeDevice[]): GoveeDevice[] {
    return resolveGroupMembers(group, devices);
  }

  /**
   * Fan out a scene command: match group scene name → member scene index.
   *
   * @param group BaseGroup device
   * @param member Target member device
   * @param value Dropdown index value
   */
  private async fanOutScene(group: GoveeDevice, member: GoveeDevice, value: ioBroker.StateValue): Promise<void> {
    const groupPrefix = this.host.devicePrefix(group);
    const obj = await this.host.getObject(`${this.host.namespace}.${groupPrefix}.scenes.light_scene`);
    const groupStates = obj?.common?.states as Record<string, string> | undefined;
    const sceneName = groupStates?.[String(value)];
    if (!sceneName) {
      return;
    }
    const memberIdx = member.scenes.findIndex(s => s.name === sceneName);
    if (memberIdx >= 0) {
      await this.host.sendCommand(member, "lightScene", memberIdx + 1);
    }
  }

  /**
   * Fan out a music command: match group music name → member music index.
   *
   * @param group BaseGroup device
   * @param member Target member device
   * @param stateSuffix Music-state-suffix
   * @param value Command value
   */
  private async fanOutMusic(
    group: GoveeDevice,
    member: GoveeDevice,
    stateSuffix: string,
    value: ioBroker.StateValue,
  ): Promise<void> {
    // Sensitivity/auto_color are forwarded directly
    if (stateSuffix !== "music.music_mode") {
      await this.host.sendMusicCommand(member, this.host.devicePrefix(member), stateSuffix, value);
      return;
    }
    const groupPrefix = this.host.devicePrefix(group);
    const obj = await this.host.getObject(`${this.host.namespace}.${groupPrefix}.music.music_mode`);
    const groupStates = obj?.common?.states as Record<string, string> | undefined;
    const musicName = groupStates?.[String(value)];
    if (!musicName) {
      return;
    }
    const memberIdx = member.musicLibrary.findIndex(m => m.name === musicName);
    if (memberIdx >= 0) {
      await this.host.sendMusicCommand(member, this.host.devicePrefix(member), "music.music_mode", memberIdx + 1);
    }
  }
}
