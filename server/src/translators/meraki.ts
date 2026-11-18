import type { NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
  ensureDevice,
  ensureLinkEnds,
  hostAddress,
  isRecord,
  noteUnmapped,
  publishDocument,
  pushWarning,
  sectionList,
  sortWarnings,
  textOf,
} from "./helpers.js";
import { translatorFail } from "./limits.js";
import type { TranslatorModule, TranslatorResult, TranslatorWarning } from "./types.js";

/**
 * Saved Meraki Dashboard API JSON. getDeviceLldpCdp returns sourceMac and a
 * ports object. The published example's sourcePort does not match the ports
 * key, so the key is the local port. Nothing in this file calls Meraki.
 */

const DEVICE_USED = new Set(["serial", "name", "model", "networkId", "lanIp", "firmware", "mac", "address", "notes", "tags"]);
const NETWORK_USED = new Set(["id", "name", "organizationId"]);
const PORT_USED = new Set(["lldp", "cdp", "deviceMac", "device"]);
const LLDP_USED = new Set(["systemName", "portId", "sourcePort", "systemDescription", "chassisId", "managementAddress", "portDescription"]);
const CDP_USED = new Set(["deviceId", "portId", "sourcePort", "platform", "address", "model"]);

type Neighbor = { name: string; port: string; platform: string };

function deviceRows(value: unknown): unknown[] {
  const section = sectionList(value, ["devices", "results"]);
  return section.bad ? [] : section.items;
}

function mapDevices(items: unknown[], networks: Map<string, string>, warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const bySerial = new Map<string, string>();
  const byName = new Map<string, string>();
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/devices/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, DEVICE_USED, "device");
    const serial = textOf(item.serial);
    const name = textOf(item.name) || serial;
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const networkId = textOf(item.networkId);
    devices.push(
      blankDevice(name, {
        model: textOf(item.model),
        managementIp: hostAddress(item.lanIp),
        site: networks.get(networkId) ?? "",
      }),
    );
    if (serial) bySerial.set(serial, name);
    byName.set(name.toLowerCase(), name);
  });
  return { devices, bySerial, byName };
}

function neighborOf(lldp: unknown, cdp: unknown, warnings: TranslatorWarning[], pointer: string): Neighbor | null {
  const lldpRow = isRecord(lldp) ? lldp : null;
  const cdpRow = isRecord(cdp) ? cdp : null;
  if (lldpRow) noteUnmapped(warnings, `${pointer}/lldp`, lldpRow, LLDP_USED, "LLDP");
  if (cdpRow) noteUnmapped(warnings, `${pointer}/cdp`, cdpRow, CDP_USED, "CDP");
  const name = (lldpRow && textOf(lldpRow.systemName)) || (cdpRow && textOf(cdpRow.deviceId)) || "";
  const port = (lldpRow && textOf(lldpRow.portId)) || (cdpRow && textOf(cdpRow.portId)) || "";
  const platform = (cdpRow && (textOf(cdpRow.platform) || textOf(cdpRow.model))) || "";
  if (!name || !port) return null;
  return { name, port, platform };
}

function mapLldp(
  value: unknown,
  devices: NetworkDevice[],
  bySerial: Map<string, string>,
  byName: Map<string, string>,
  warnings: TranslatorWarning[],
) {
  const interfaces: NetworkInterface[] = [];
  const links: NetworkLink[] = [];
  if (value == null) return { interfaces, links };
  const entries: { serial: string; body: Record<string, unknown> }[] = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isRecord(item)) return;
      const serial = textOf(item.serial);
      if (serial) entries.push({ serial, body: item });
    });
  } else if (isRecord(value)) {
    if (isRecord(value.ports) && textOf(value.serial)) entries.push({ serial: textOf(value.serial), body: value });
    else {
      for (const [serial, body] of Object.entries(value)) {
        if (isRecord(body)) entries.push({ serial, body });
      }
    }
  }
  entries.forEach(({ serial, body }) => {
    const device = bySerial.get(serial) || ensureDevice(devices, textOf(body.name) || serial);
    const ports = isRecord(body.ports) ? body.ports : {};
    for (const [port, raw] of Object.entries(ports)) {
      if (!isRecord(raw)) continue;
      noteUnmapped(warnings, `/lldpCdp/${serial}/${port}`, raw, PORT_USED, "port");
      interfaces.push(blankInterface(device, port));
      const neighbor = neighborOf(raw.lldp, raw.cdp, warnings, `/lldpCdp/${serial}/${port}`);
      if (!neighbor) continue;
      const known = byName.get(neighbor.name.toLowerCase());
      const remote = known || ensureDevice(devices, neighbor.name, { platform: neighbor.platform });
      links.push(blankLink(device, port, remote, neighbor.port));
    }
  });
  return { interfaces, links: dedupeLinks(links) };
}

function convertMeraki(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A Meraki export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const networks = new Map<string, string>();
  const networkItems = sectionList(input.networks, ["networks"]).items;
  networkItems.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/networks/${index}`, item, NETWORK_USED, "network");
    const id = textOf(item.id);
    const name = textOf(item.name);
    if (id && name) networks.set(id, name);
  });
  const deviceItems = deviceRows(input.devices ?? input);
  const mapped = mapDevices(deviceItems, networks, warnings);
  const lldp = mapLldp(input.lldpCdp ?? input.lldp_cdp, mapped.devices, mapped.bySerial, mapped.byName, warnings);
  const interfaces = [...lldp.interfaces];
  ensureLinkEnds(mapped.devices, interfaces, lldp.links);
  if (lldp.links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices: mapped.devices, interfaces, links: lldp.links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const meraki: TranslatorModule = {
  id: "meraki",
  name: "Meraki Dashboard",
  formatHint: "Saved Meraki devices and lldpCdp JSON",
  placeholder: `{
  "devices": [ { "serial": "Q2XX-AAAA-BBBB", "name": "core-sw", "model": "MS250-24" } ],
  "lldpCdp": {}
}`,
  convert: convertMeraki,
};

export default meraki;
