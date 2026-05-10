import type { DeviceManager } from "../device-manager";
import type { GroupFanoutHost } from "../group-fanout";
import type { StateManager } from "../state-manager";
import type { GoveeDevice } from "../types";

/**
 * Adapter surface required by the group-fanout glue. Loose
 * `getObjectAsync` shape for utils.Adapter structural matching.
 */
export interface GroupFanoutHandlerAdapter {
  readonly log: ioBroker.Logger;
  readonly namespace: string;
  readonly deviceManager: DeviceManager | null;
  readonly stateManager: StateManager | null;
  getObjectAsync(id: string): Promise<unknown>;
  /** State-suffix → command lookup — owned by main.ts because it lives next to STATE_TO_COMMAND. */
  stateToCommand(suffix: string): string | null;
  /** Music command builder — owned by main.ts because it pulls sibling state values. */
  sendMusicCommand(device: GoveeDevice, devicePrefix: string, stateSuffix: string, value: unknown): Promise<void>;
}

/**
 * Resolve group member references to actual device objects. Pure helper —
 * builds a once-per-call lookup index instead of N×Array.find, since the
 * call fan-out (every state-update touches updateGroupReachability → all
 * groups → resolveGroupMembers) made the linear scan dominate the hot path
 * on accounts with many devices and many groups.
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
    byKey.set(`${d.sku}:${d.deviceId}`, d);
  }
  const out: GoveeDevice[] = [];
  for (const m of group.groupMembers) {
    const d = byKey.get(`${m.sku}:${m.deviceId}`);
    if (d) {
      out.push(d);
    }
  }
  return out;
}

/**
 * Recalculate `info.membersUnreachable` for all groups. Called when any
 * device's online status changes — race-condition-safe because the state
 * is kept existent and just gets an empty string when no member is
 * unreachable (see device-manager-pattern #46).
 *
 * @param adapter
 */
export function updateGroupReachability(adapter: GroupFanoutHandlerAdapter): void {
  if (!adapter.deviceManager || !adapter.stateManager) {
    return;
  }
  const devices = adapter.deviceManager.getDevices();
  for (const group of devices) {
    if (group.sku !== "BaseGroup" || !group.groupMembers) {
      continue;
    }
    const memberDevices = resolveGroupMembers(group, devices);
    adapter.stateManager.updateGroupMembersUnreachable(group, memberDevices).catch(() => {});
  }
}

/**
 * Construct host object for {@link GroupFanoutHandler}. Closures capture
 * adapter state.
 *
 * @param adapter
 */
export function buildGroupFanoutHost(adapter: GroupFanoutHandlerAdapter): GroupFanoutHost {
  return {
    log: adapter.log,
    namespace: adapter.namespace,
    getDevices: () => adapter.deviceManager?.getDevices() ?? [],
    sendCommand: async (device, command, value) => {
      await adapter.deviceManager?.sendCommand(device, command, value);
    },
    devicePrefix: device => adapter.stateManager?.devicePrefix(device) ?? "",
    stateToCommand: suffix => adapter.stateToCommand(suffix) ?? undefined,
    getObject: id => adapter.getObjectAsync(id) as Promise<ioBroker.Object | null | undefined>,
    sendMusicCommand: (device, devicePrefix, stateSuffix, value) =>
      adapter.sendMusicCommand(device, devicePrefix, stateSuffix, value),
  };
}
