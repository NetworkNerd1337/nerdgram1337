import type { NetworkDevice, NetworkInterface, NetworkLink } from "../network/types.js";
import {
  blankDevice,
  blankInterface,
  blankLink,
  dedupeLinks,
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
 * Saved PRTG table.json. Devices use the device, host, and group columns.
 * Sensors are checks, not ports, unless a row names an interface or port.
 * Group membership is not a mesh. Nothing in this file calls PRTG.
 */

const DEVICE_USED = new Set(["objid", "probe", "group", "device", "host", "name", "status"]);
const SENSOR_USED = new Set(["objid", "group", "device", "sensor", "status", "lastvalue", "interface", "port"]);
const LINK_USED = new Set(["a", "b", "source", "target", "device", "interface", "label"]);

function rows(warnings: TranslatorWarning[], value: unknown, label: string): unknown[] {
  const section = sectionList(value, [label, "devices", "sensors"]);
  if (!section.present) return [];
  if (section.bad) {
    pushWarning(warnings, `/${label}`, `${label} is not a PRTG table.`);
    return [];
  }
  return section.items;
}

function mapDevices(items: unknown[], warnings: TranslatorWarning[]) {
  const devices: NetworkDevice[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const pointer = `/devices/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, DEVICE_USED, "device");
    const name = textOf(item.device) || textOf(item.name);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    devices.push(
      blankDevice(name, {
        managementIp: hostAddress(item.host),
        site: textOf(item.group),
      }),
    );
  });
  return devices;
}

function mapSensors(items: unknown[], devices: NetworkDevice[], warnings: TranslatorWarning[]): NetworkInterface[] {
  const known = new Set(devices.map((device) => device.name.toLowerCase()));
  const interfaces: NetworkInterface[] = [];
  let ignored = 0;
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    noteUnmapped(warnings, `/sensors/${index}`, item, SENSOR_USED, "sensor");
    const device = textOf(item.device);
    const port = textOf(item.interface) || textOf(item.port);
    if (!port || !device || !known.has(device.toLowerCase())) {
      ignored += 1;
      return;
    }
    interfaces.push(blankInterface(device, port, { description: textOf(item.sensor) }));
  });
  if (ignored > 0) {
    pushWarning(warnings, "/sensors", "Sensors without an interface or port column were not turned into interfaces.");
  }
  return interfaces;
}

function endpoint(value: unknown): { device: string; interface: string } | null {
  if (!isRecord(value)) return null;
  const device = textOf(value.device) || textOf(value.name);
  const iface = textOf(value.interface) || textOf(value.port);
  if (!device || !iface) return null;
  return { device, interface: iface };
}

function mapLinks(items: unknown[], warnings: TranslatorWarning[]): NetworkLink[] {
  const links: NetworkLink[] = [];
  items.forEach((item, index) => {
    const pointer = `/links/${index}`;
    if (!isRecord(item)) return;
    noteUnmapped(warnings, pointer, item, LINK_USED, "link");
    const a = endpoint(item.a) ?? endpoint({ device: item.source ?? item.device, interface: item.interface });
    const b = endpoint(item.b) ?? endpoint(isRecord(item.target) ? item.target : { device: item.target, interface: item.port });
    if (!a || !b) {
      pushWarning(warnings, pointer, "Skipped a link that does not name both devices and ports.");
      return;
    }
    links.push(blankLink(a.device, a.interface, b.device, b.interface, textOf(item.label)));
  });
  return dedupeLinks(links);
}

function convertPrtg(input: unknown): TranslatorResult {
  if (!isRecord(input)) throw translatorFail(400, "A PRTG export must be a JSON object.");
  const warnings: TranslatorWarning[] = [];
  const deviceItems = rows(warnings, input.devices ?? input, "devices");
  const sensorItems = rows(warnings, input.sensors, "sensors");
  const devices = mapDevices(deviceItems, warnings);
  const interfaces = mapSensors(sensorItems, devices, warnings);
  const links = mapLinks(rows(warnings, input.links, "links"), warnings);
  ensureLinkEnds(devices, interfaces, links);
  if (interfaces.length === 0 && devices.length > 0) {
    pushWarning(warnings, "", "This PRTG export is inventory only. No switch ports were created.");
  }
  if (links.length === 0) pushWarning(warnings, "", "No links in this export. No links were created.");
  return {
    document: publishDocument({ devices, interfaces, links, vlans: [] }),
    warnings: sortWarnings(warnings),
  };
}

const prtg: TranslatorModule = {
  id: "prtg",
  name: "PRTG",
  formatHint: "Saved PRTG table.json devices export",
  placeholder: `{
  "prtg-version": "24.0.0",
  "devices": [ { "objid": 1, "group": "HQ", "device": "core-rtr", "host": "192.0.2.1" } ]
}`,
  convert: convertPrtg,
};

export default prtg;
