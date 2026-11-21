const DOCS = "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs";

export type SourceNotice = {
  id: string;
  body: string;
  tipsLabel: string;
  href: string;
};

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces become hyphens. */
export function githubHeadingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function docLink(file: string, heading: string): string {
  return `${DOCS}/${file}#${githubHeadingAnchor(heading)}`;
}

const BUILTIN: Record<string, { heading: string; body: string }> = {
  auto: {
    heading: "Auto-detect",
    body: "Auto-detect reads the paste and chooses CSV, JSON, network JSON, CDP, LLDP, a routing table, or ARP and MAC tables. A paste that matches none of those is not drawn. Devices or links that are not in the paste do not appear.",
  },
  csv: {
    heading: "CSV",
    body: "A CSV links table or node list is drawn from the rows you map. A column you leave unmapped, and a device that is not in the file, stays off the diagram.",
  },
  json: {
    heading: "JSON",
    body: "JSON nodes, edges, or links are drawn from that object. Fields this page does not map, and devices that are not in the file, stay off the diagram.",
  },
  network: {
    heading: "Network data (JSON)",
    body: "Network JSON draws the Layer 3 or Layer 2 view you pick from the devices, interfaces, and links in the file. NerdGram does not add a neighbor the file does not list.",
  },
  cdp: {
    heading: "Cisco CDP",
    body: "Cisco CDP draws only the neighbors those devices report. A device that did not answer, or a link CDP did not list, is not on the diagram.",
  },
  lldp: {
    heading: "LLDP neighbors",
    body: "LLDP draws the neighbors in the paste. A device that is not in the output, or a link the command did not report, is not on the diagram.",
  },
  route: {
    heading: "Routing table (L3)",
    body: "A routing table draws layer 3 adjacency from connected subnets and next hops in show ip route. A network that is not in the paste is not on the diagram. ARP and MAC lines in the same paste are still applied, and the preview says so.",
  },
  arpmac: {
    heading: "ARP and MAC tables (L2)",
    body: "ARP and MAC tables place hosts from the MAC address table. A port with many MACs is an uplink stub. ARP alone does not draw a link, and a host that is not in the MAC table is not placed.",
  },
};

const TRANSLATORS: Record<string, { name: string; body: string }> = {
  netbox: {
    name: "NetBox",
    body: "NetBox draws the devices, interfaces, and cables in this export. A connection that is not in the cables list is not invented.",
  },
  librenms: {
    name: "LibreNMS",
    body: "LibreNMS draws the devices and links saved in this export. Poller data that was not in the file is not on the diagram.",
  },
  nautobot: {
    name: "Nautobot",
    body: "NerdGram draws the devices, interfaces, and cables in this Nautobot export. Devices or links that export does not include will not appear.",
  },
  orion: {
    name: "SolarWinds Orion",
    body: "SolarWinds Orion draws the nodes and interfaces in this export. A neighbor Orion did not record is not added.",
  },
  observium: {
    name: "Observium",
    body: "Observium draws the devices and ports in this export. A link that is not in the file is not added.",
  },
  netdisco: {
    name: "Netdisco",
    body: "Netdisco draws the devices and neighbors in this export. A MAC or ARP table in the file is not turned into links.",
  },
  zabbix: {
    name: "Zabbix",
    body: "Zabbix draws the hosts in this export. An item that is not a host or a link is left out.",
  },
  "catalyst-center": {
    name: "Cisco Catalyst Center",
    body: "Cisco Catalyst Center draws the devices and links in this export. A device the export does not list is not added.",
  },
  meraki: {
    name: "Meraki Dashboard",
    body: "Meraki Dashboard draws the networks, devices, and neighbors in this export. A client that is not a neighbor is not drawn as a switch link.",
  },
  pyats: {
    name: "Cisco pyATS",
    body: "Cisco pyATS draws the devices and interfaces learned in this export. A neighbor that was not learned is not added.",
  },
  prtg: {
    name: "PRTG",
    body: "PRTG draws the devices in this export. A sensor that is not a device or a link is not drawn as a neighbor.",
  },
  terraform: {
    name: "Terraform",
    body: "Terraform draws the network resources in this plan or state. A resource the file does not describe is not added.",
  },
  batfish: {
    name: "Batfish",
    body: "Batfish draws the devices and the layer-1 or BGP edges in this snapshot. For a fuller topology, add LLDP or CDP links to the snapshot before you export it.",
  },
};

export function builtinSourceNotice(format: string): SourceNotice {
  const item = BUILTIN[format] ?? BUILTIN.auto;
  const chosen = item ?? BUILTIN.auto;
  return {
    id: BUILTIN[format] ? format : "auto",
    body: chosen.body,
    tipsLabel: "Source tips",
    href: docLink("generate-from-data.md", chosen.heading),
  };
}

export function translatorSourceNotice(id: string, name: string): SourceNotice {
  const known = TRANSLATORS[id];
  const label = known?.name || name;
  return {
    id,
    body: known?.body ?? `NerdGram draws the devices and links in this ${label} export. Anything that export does not include is not on the diagram.`,
    tipsLabel: "Translator tips",
    href: docLink("translators.md", label),
  };
}

/** Every built-in source and every shipped translator, for the anchor check. */
export function documentedSourceNotices(): SourceNotice[] {
  return [
    ...Object.keys(BUILTIN).map((format) => builtinSourceNotice(format)),
    ...Object.entries(TRANSLATORS).map(([id, item]) => translatorSourceNotice(id, item.name)),
  ];
}
