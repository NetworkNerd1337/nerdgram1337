# Generate from data

A CSV, JSON, routing table, ARP and MAC tables, or network JSON file can build the diagram.

[Back to the documentation index](README.md)

A CSV, JSON, CDP or LLDP `show` paste, a Cisco `show ip route` paste, ARP and MAC tables, or network JSON file can build the diagram. **From data** on the dashboard opens `/generate`. **Source** starts on **Auto-detect**, which looks for CSV, JSON, network JSON, Cisco CDP, LLDP neighbors, a Cisco routing table, or ARP and MAC tables. A paste that matches none of those says the format was not recognized and lists those inputs. Choosing **Routing table** still rejects a paste that is not IOS, IOS-XE, or NX-OS. Dropping one of those files on the dashboard opens this page with the file already loaded. The page shows the steps as `[ Data >> Options >> Preview ]`, or `Columns` instead of `Options` for a links table or CSV. The current step is accent and bold. A finished step goes back. Upcoming steps are not links. Paste the file or upload it, map columns, choose a flowchart direction and whether groups become subgraphs, preview the Mermaid, then create the diagram. Network JSON skips the column map and asks for a Layer 3 or Layer 2 view instead. The same action is **Generate diagram from data** in the command palette.

Two shapes are accepted. A links table has a local device, a local port, a remote device, and a remote port. A node list has an id and a label, and an optional second file of edges with source, target, and label. JSON can carry both lists in one object (`nodes` and `edges`) or a `links` array. Optional columns are group, type, style class, and a child diagram path. A group becomes a Mermaid `subgraph`. A type or style class becomes a `classDef` and a `class` line. A child diagram path becomes a `click` line such as `click Atlanta "nerdgram:Sites/Atlanta.mmd"`. The path has to be a `.mmd` file inside the workspace. `javascript:` and a path that leaves the workspace are rejected, and the error names the row.

Sample files are [docs/samples/campus-links.csv](samples/campus-links.csv) and [docs/samples/campus.json](samples/campus.json). The CSV is a links table. The JSON is nodes, edges, and a link from Atlanta to `Sites/Atlanta.mmd`. That JSON shape is [docs/schema/graph.schema.json](schema/graph.schema.json), served at `GET /api/v1/schema/graph.json`.

The data file is saved next to the diagram (`Campus.mmd` and `Campus.csv`, `Core.mmd` and `Core.lldp`, or `Campus.mmd` and `Campus.network.json`). GitHub sync copies both. The diagram's front matter records the file, the column mapping, and the direction under `nerdgram.source`. CDP and LLDP also record `groupBy` and, when you typed one, the local device name. Network JSON records `view` (`l3` or `l2`) and the options used to build that view. That path is from the workspace root. Renaming, moving, or duplicating the diagram moves or copies a data file that sits in the same folder and updates that path. Duplicate can instead keep sharing the original file. Delete can move the data file to the trash with the diagram or leave it in place. Generated lines sit between `%% nerdgram:generated` and `%% nerdgram:generated end`. **Refresh from data** in the editor reads that file, shows nodes and edges added, removed, and changed, and writes the generated block only after you apply it. `nerdgram generate` does the same update when that path already exists: the first run creates the diagram, and the next run replaces the generated block and the data file. `--create-only` refuses when the path exists. Notes, the theme, and anything outside the markers stay, including a node you added by hand.

A file can be up to 4 MiB, the same cap for CSV, JSON, CDP, LLDP, a routing table, ARP and MAC tables, and network JSON. That is about 3,000 CDP detail neighbors, or a full BGP or OSPF table plus ARP and MAC output from many devices. A paste over that size is refused with the same message as the other inputs: it is larger than 4 MiB. There is no smaller cap on the routing-table parser, the generate or refresh request, the paste box, or the MCP tool. The HTTP body parser allows 5mb, so the 4 MiB check is the one that answers. A diagram still stops at 2,000 nodes and 5,000 edges. The app sets Mermaid's text limit to 4 MiB and its edge limit to 5,000. A diagram's front matter, or an `%%{init}%%` directive, cannot raise those. A hub with many leaf neighbors can be drawn as a compact grid or as rings. In **Diagram info**, set **Hub layout** to **Compact grid** or **Radial rings**. That writes `nerdgram.hubLayout` in the file. Leave it unset and the diagram keeps the usual rank layout. The preview step says so before you create the file when the diagram has 200 nodes or more, or a hub with 50 or more leaf neighbors. Choose **Default rank**, **Compact hub layout**, or **Radial hub layout**. On a hub that large, the note says Default rank is one long column and that Compact or Radial stays readable. Compact and radial write the same `nerdgram.hubLayout` field. A smaller import does not ask. The editor preview **Fit** shows the whole diagram when that zoom stays at least 25%. A page fit below 25% uses the shorter side and lets you pan. A bad row, or a neighbor block that cannot be parsed, names its row or line and does not create the diagram. Labels are escaped so a cell or a hostname cannot close a Mermaid string or add a directive.

## Auto-detect

**Source** starts on **Auto-detect**. It looks at the paste and chooses CSV, JSON, network JSON, Cisco CDP, LLDP neighbors, a routing table, or ARP and MAC tables. A routing table wins when the paste also contains ARP or MAC output. A paste that matches none of those says the format was not recognized and lists the supported inputs.

## CSV

Choose **CSV** for a links table or a node list. Map the columns, then preview. A column you do not map is ignored. The stored file is `.csv`.

## JSON

Choose **JSON** for an object with `nodes` and `edges`, or a `links` array. Network JSON is a different source. The stored file is `.json`.

## Cisco CDP

**From data** accepts pasted or uploaded `show cdp neighbors detail`. Choose **Cisco CDP**. CDP is Cisco IOS, IOS-XE, and NX-OS. The diagram shows the neighbors those devices report. A link seen from both ends becomes one edge. `Gi1/0/1` and `GigabitEthernet1/0/1` are the same interface. Grouping can follow platform or capability. The raw output is a `.cdp` file, and **Refresh from data** parses it again.

## LLDP neighbors

Choose **LLDP neighbors**. LLDP is vendor-agnostic: the parser reads the standard LLDP fields (local port, chassis ID, port ID, port description, system name, system description, system capabilities, and management address) whatever order or spelling the CLI uses. A neighbor the command did not report is not drawn. The raw output is a `.lldp` file, and **Refresh from data** parses it again.

The hostname comes from the CLI prompt. If the paste has no prompt, type the local device name. You can paste several devices one after another.

| Platform | Command |
| --- | --- |
| Cisco IOS | `show cdp neighbors detail` and `show lldp neighbors detail` |
| Cisco IOS-XE | `show cdp neighbors detail` and `show lldp neighbors detail` |
| Cisco NX-OS | `show cdp neighbors detail` and `show lldp neighbors detail` |
| Arista EOS | `show lldp neighbors detail` |
| Juniper Junos | `show lldp neighbors interface <interface>` |
| ArubaOS-CX | `show lldp neighbor-info detail` |
| Aruba ProVision / AOS-Switch | `show lldp info remote-device detail` |
| HPE Comware | `display lldp neighbor-information verbose` |
| Dell OS10 | `show lldp neighbors detail` |
| Extreme EXOS | `show lldp neighbors detailed` |
| MikroTik RouterOS | `/ip neighbor print detail` |
| Linux lldpd | `lldpctl`, `lldpctl -f keyvalue`, or `lldpctl -f json` |

`lldpctl -f json` has no hostname in the file, so type the local device name. On Junos, paste one `show lldp neighbors interface <interface>` block per interface, in the same file. Sample output for each of these is under [docs/samples/neighbors](samples/neighbors).

These commands need the [command-line tool](cli.md#nerdgram-command), a running server, and `NERDGRAM_TOKEN`, and they are run from the repository root so the `docs/samples` paths resolve.

```bash
nerdgram generate --path Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp --format cdp
nerdgram generate --path Edge.mmd --data docs/samples/neighbors/lldpd.json --format lldp --local-device edge
```

## Routing tables

Layer 3 and layer 2 are separate sources. A paste that contains both still works under **Routing table (L3)**, and the preview says so.

### Routing table (L3)

**From data** accepts pasted `show ip route` from Cisco IOS, IOS-XE, and NX-OS. Choose **Routing table (L3)**, or leave **Source** on **Auto-detect** when the paste contains that command. Several devices can sit in one paste. A prompt such as `core-rtr#show ip route` or `nx-core# show ip route` starts a device and supplies the hostname. One file per device also works. Output with no prompt is one unnamed device, and the notice says so. You can type a local device name for that case.

Connected (`C`) and local (`L`) routes, and NX-OS `direct` and `local` lines, give each device's interface addresses and subnets. A subnet shared by two or more devices is a segment those devices attach to. A `/30` or `/31` with exactly two devices is a direct link. A next hop that belongs to another pasted device, because that device has the address as a local route, is a router adjacency. The edge is labeled with the destination prefix and the protocol, such as OSPF, BGP, or static. Thousands of prefixes behind the same next hop and protocol become one edge labeled with the prefix count, not one edge per prefix. A next hop that no pasted device owns, such as an ISP or a firewall that was not included, is an **unknown next hop** stub. The notice says how many next hops did not match.

One device still draws. The notice says this is only that device's view, and that pasting neighbors' routing tables builds the adjacency map.

A paste that also includes `show ip arp` and `show mac address-table` still places hosts, and the preview notes that. Host counts are chosen on **ARP and MAC tables (L2)**. A diagram of about 200 nodes, or a hub of 50 or more leaf neighbors, still offers **Default rank**, **Compact hub layout**, or **Radial hub layout** before the file is created.

Other routing-table formats are rejected with a message that names IOS, IOS-XE, and NX-OS. Nothing is logged in, polled, or fetched. The paste is the whole input. The stored file is `.route`, and `nerdgram.source.format` is `route`. Refresh parses that file again. An existing `.route` file that already mixes routes with ARP and MAC refreshes the same way. CDP and LLDP behavior is unchanged.

### ARP and MAC tables (L2)

Choose **ARP and MAC tables (L2)** for `show ip arp` or `show arp`, plus `show mac address-table`, from one or more switches. This source does not need a routing table. The MAC table places hosts on switchports. **Hosts** can be **On switchports**, **Counts per port**, or **Counts per VLAN**. A port with 8 or more MAC addresses is an uplink and is drawn as an uplink stub, not as host ports. ARP alone does not draw links. The notice says a MAC address table is needed. When ARP is present, a host is labeled with its IP. A MAC with no ARP entry is labeled with the MAC. The stored file is `.arpmac`, and `nerdgram.source.format` is `arpmac`.

Samples are under [docs/samples/routes](samples/routes): [cisco-ios-routes.route](samples/routes/cisco-ios-routes.route), [cisco-iosxe-routes.route](samples/routes/cisco-iosxe-routes.route), [cisco-nxos-routes.route](samples/routes/cisco-nxos-routes.route), [campus-arp-mac.route](samples/routes/campus-arp-mac.route) (routes plus ARP and MAC), and [campus-arp-mac.arpmac](samples/routes/campus-arp-mac.arpmac) (layer 2 only).

```bash
nerdgram generate --path Routes.mmd --data docs/samples/routes/cisco-ios-routes.route --format route
nerdgram generate --path Hosts.mmd --data docs/samples/routes/campus-arp-mac.arpmac --format arpmac --hosts port-counts
```

## Network data (JSON)

CDP and LLDP draw physical neighbors. `show ip route` draws the adjacencies in a pasted Cisco routing table, as described above. A Layer 2 design, or a Layer 3 design that is not a routing-table paste, still needs addresses, VLANs, and bundles, and those commands differ by platform. NerdGram does not log in and does not parse other vendor configuration. It reads one vendor-neutral JSON document, `format: "network"`, `schemaVersion: 1`, and draws the diagram from that document only. The same file always produces the same generated block. A later refresh replaces that block. It does not invent a link that is not in the file.

You produce the JSON. NerdGram does not ship TextFSM, Genie, NAPALM, Batfish, Nautobot, or NetBox. The schema file is [docs/schema/network.schema.json](schema/network.schema.json). The running server serves that document at `GET /api/v1/schema/network.json`, and the generic nodes, edges, and links schema at `GET /api/v1/schema/graph.json`. The served `$id` uses the host and port of the request. The file in this repository keeps the default port 8787. Neither route needs a token. The OpenAPI document is `GET /api/v1/openapi.json`. On the default port those URLs are `http://127.0.0.1:8787/api/v1/schema/network.json`, `http://127.0.0.1:8787/api/v1/schema/graph.json`, and `http://127.0.0.1:8787/api/v1/openapi.json`. The compatibility rule is [Schema compatibility](#schema-compatibility). A file is stored as `.network.json`.

| Field | Required | What it is |
| --- | --- | --- |
| `devices` | yes | `name`, plus optional `platform`, `model`, `role`, `site`, `managementIp`, and `diagram`. `platform` and `model` are written under the device name when they are set. `model` is the hardware model, separate from `platform` and `role`. `diagram` is a workspace `.mmd` path and becomes a `click` line. |
| `interfaces` | yes | `device` and `name`. Optional description (written on the Layer 2 link when it is set), `speed` (text such as `10G`, written on the link when it is set), `adminStatus` and `operStatus` (`up` or `down`), `ipv4` and `ipv6` as `{ "address", "prefix" }`, `vrf`, `switchportMode` (`access` or `trunk`), `accessVlan`, `trunkVlans`, `nativeVlan`, and `lag`. |
| `links` | no | Undirected pairs `{ "a": { "device", "interface" }, "b": { "device", "interface" } }`, usually from CDP, LLDP, or a source of truth. Optional `label`, written on the Layer 2 edge when it is set. Optional `inferred`. Omitted and false draw a solid edge. `true` draws a dashed edge (`-.->`) on the Layer 2 view, and on a Layer 3 point-to-point edge between those two devices when every link between them is inferred. |
| `vlans` | no | `id` and optional `name`. An access VLAN and a native VLAN other than 1 are labeled with the name when one is set (`access 20 servers`, `native 99 native`). |
| `neighbors` | no | Optional `cdp` or `lldp` text. The existing CDP and LLDP parsers add those pairs to the Layer 2 view. `localDevice` is the hostname when the paste has no prompt. |

`Gi1/0/1` and `GigabitEthernet1/0/1` are the same interface, and `Po1` and `Port-channel1` are the same bundle. An omitted VRF and a VRF named `default` are the same VRF. Any other VRF name is its own. A validation error names the field, for example `/interfaces/1/ipv4/0/prefix: prefix must be an integer from 0 to 32.` The message asks you to fix the fields listed, and the path is the JSON pointer, such as `/devices/0/serial`, not a row number. A CSV or other row-based file still names the row.

**Layer 3** (`"view": "l3"`). Each address and prefix becomes a subnet. Two interfaces in the same `/30`, `/31`, or `/127` are one edge, labeled with the subnet and both interface names and addresses. Any other subnet with two or more attached devices is a segment node, such as `10.1.20.0/24`, with an edge to each device. A `/32` or `/128` is written on the device, not drawn as a link. A subnet with only one attached interface is written on the device the same way. The platform is written under the device name when it is set. The model is written under the platform, or under the name when platform is omitted. An interface speed is written on that end of a routed link when it is set (`Gi0/0/0 10.1.0.1 10G`). The management IP is written on the device when that address is not already on the label. The same numbers in two VRFs stay two subnets. **Group by** can be VRF. A device that belongs to one VRF is drawn in that VRF. A device that belongs to more than one VRF is drawn once, in a subgraph named with those VRFs in alphabetical order, such as `default, GUEST`. The same address and prefix in one VRF on more than one device is a warning, and a `/30`, `/31`, or `/127` is not drawn as a link when both ends use that same address. Shutdown or `down` interfaces are left out unless **Include shutdown or down interfaces** is checked (`includeDown: true`).

**Layer 2** (`"view": "l2"`). Links come from `links`, plus CDP or LLDP text under `neighbors` when that text is in the file. A trunk is labeled with the allowed VLANs compressed into ranges (`10,20,30-40`). The native VLAN is added when it is not 1, including its name when `vlans` has one. When both ends list allowed VLANs, the label is the VLANs they share. An interface description is written on that link when it is set. A link `label` is written on the edge when it is set. An interface speed is written on that edge when it is set, and the same speed on both ends is written once. `diagram` on a device becomes a `click` line to that workspace `.mmd` path. `javascript:` and a path that leaves the workspace are rejected. The two ends are joined the same way as the interface names (`L2 uplink to dist-sw – L2 uplink to core-rtr`). The same text on both ends is written once. A member of a LAG with no description of its own uses the port-channel description. Members of the same LAG between the same two devices become one edge, labeled with the port-channel name, the member count, and the member interfaces. The VLAN configuration on the port-channel interface is used when that interface is in the file. **VLAN filter** (`vlan`) keeps only the links that carry that VLAN. **Group by** can be site, role, or platform. An access VLAN is labeled `access 20`, or `access 20 servers` when VLAN 20 has that name. A shutdown or down interface is left off the link unless `includeDown` is set. The platform is written under the device name when it is set, and the model is written under the platform. The management IP is written on the device.

**From data** has a **Network data (JSON)** choice. Pick Layer 3 or Layer 2, set the options, preview, then create. The preview is the Mermaid that will be saved. `nerdgram.source` stores the file, the view, and the options. **Refresh from data** reads that file and rewrites only the generated block. Rename, move, duplicate, and delete treat `.network.json` the same way they treat `.csv`, `.json`, `.cdp`, `.lldp`, and `.route`. A description that is still `Generated from <path>` is updated to the new data path. A description you wrote is left alone.

The sample [docs/samples/network/campus.network.json](samples/network/campus.network.json) is a small campus: a core router, a distribution switch, two access switches, and a WAN router. The same file produces both views. Layer 3 draws the routed links. Layer 2 draws the trunks and access ports, including the uplink from the distribution switch to the core router and the link from the core router to the WAN router, so every device is connected. It omits `model`, `diagram`, `speed`, and link `label`, and those views stay the same. [docs/samples/network/details.network.json](samples/network/details.network.json) is a smaller file that sets those fields: the model under the device name, a click through to `Sites/Core.mmd`, `10G` on the routed link, and an `uplink` label with `10G – 1G` on the Layer 2 edge. These commands need the server and a token, and they are run from the repository root.

```bash
nerdgram generate --path Campus-L3.mmd --data docs/samples/network/campus.network.json --format network --view l3
nerdgram generate --path Campus-L2.mmd --data docs/samples/network/campus.network.json --format network --view l2 --group-by site --vlan 20
nerdgram refresh Campus-L3.mmd
```

`--include-down` draws shutdown and down interfaces. `--group-by vrf` is the Layer 3 grouping. `--group-by site`, `--group-by role`, and `--group-by platform` are the Layer 2 grouping. Refresh does not take `--view`. The view and the options are already in the diagram.

A cron job can preview and upsert the campus sample in one script. [docs/samples/push-campus.sh](samples/push-campus.sh) posts `POST /api/v1/generate/preview`, then `POST /api/v1/generate/upsert`. The first run creates `Campus-L3.mmd`. The next run updates that diagram. It does not call create-only generate, and it does not fall back to refresh. It reads the served OpenAPI document and both JSON Schemas before the post. The copy-paste curl lines are in the script header. The crontab line is [docs/samples/push-campus.cron](samples/push-campus.cron).

```bash
NERDGRAM_TOKEN=ng_your_token sh docs/samples/push-campus.sh
```

Set `NERDGRAM_URL` when the server is not `http://127.0.0.1:8787`. Set `NERDGRAM_VIEW=l2` and `NERDGRAM_GROUP_BY=platform` to draw the Layer 2 view grouped by platform. `NERDGRAM_PATH` is the diagram path. The default is `Campus-L3.mmd`.

**Producing the file.** Map whatever you already collect into the fields above. Nothing below is bundled, and NerdGram does not run it. A saved NetBox or LibreNMS export can be rewritten into this document with `nerdgram convert`. That command reads a file on this computer. It does not log in to those tools. The same mapping is `POST /api/v1/convert/<source>`. See [Translators](translators.md). The other direction, a testbed or a lab file from this document, is [Design exports](exports.md).

NAPALM `get_facts`, `get_interfaces`, and `get_interfaces_ip` cover the device and the addresses. `get_facts()["hostname"]` is `devices[].name`. `get_interfaces()[name]["is_enabled"]` is `adminStatus` (`false` is `down`) and `is_up` is `operStatus`. `get_interfaces_ip()[name]["ipv4"]` is a dict of address to `{ "prefix_length": N }`. Each entry becomes `{ "address", "prefix": prefix_length }`. IPv6 is the `ipv6` dict, with a prefix from 0 to 128. NAPALM has no single switchport getter on every driver. Map the switchport, the trunk list, the native VLAN, and the port-channel from the getter or the source of truth you already use.

Cisco Genie `device.learn("interface")` returns structured JSON, not CLI text. For each interface, `info[name]["ipv4"][address]["prefix_length"]` is the prefix, and `info[name]["switchport"]["mode"]` becomes `access` or `trunk`. Expand a Genie VLAN range into the `trunkVlans` array of integers. NerdGram compresses ranges again when it draws the label.

TextFSM, including ntc-templates, parses one command into rows. A `show ip interface` template that emits `INTERFACE`, `IPADDR`, and `PREFIX` becomes one `interfaces` entry per row. `show interfaces switchport` rows fill `switchportMode`, `accessVlan`, `trunkVlans`, and `nativeVlan`. Split `10,20,30-40` into the integers 10, 20, and 30 through 40 before you write the file. The same pattern works for `show etherchannel summary`: the port-channel name goes in `lag` on each member. Put the rows from every device in one JSON document. One generate call builds the whole diagram.

CDP and LLDP links can be copied from a diagram you already imported, or from the parser you trust, into `links`. You can also paste the raw `show cdp neighbors detail` or `show lldp neighbors detail` into `neighbors.cdp` or `neighbors.lldp`. That text is parsed by the existing CDP and LLDP parsers. NerdGram does not add a parser for any other command.

## Translators on this page

The source list on **From data** includes the installed translators. The list comes from `GET /api/translators`, which needs no token. Paste or upload calls `POST /api/convert/<source>` and then the same preview you use for network JSON. You still pick Layer 3 or Layer 2. Warnings from the mapper are on the preview before the diagram is saved. CSV, JSON, network JSON, CDP, and LLDP stay in the same list. There is no new item in the sidebar.

When a translator is selected, a note above the input is titled **Your diagram reflects your data**. The body names that translator. **Don't show again** remembers that translator in this browser. **Translator tips** opens the section on [Translators](translators.md). The note uses the Light, Dark, and Match system themes.

## Schema compatibility

`schemaVersion` is 1. An additive optional field stays on 1. A change to a field's meaning bumps `schemaVersion` to 2. The schema stays closed, so an unexpected property is still an error. A file that uses a key added in NerdGram 1.5 needs NerdGram 1.5 or later. A file that omits that key keeps working. The same rule is in [Schema compatibility](schema/README.md) and in the description of [network.schema.json](schema/network.schema.json).

| Change | What happens |
| --- | --- |
| Add an optional field. A file that omits it still validates, and every field it already uses keeps the same meaning. | Stay on `schemaVersion` 1. |
| Add an allowed value older files do not use, while every value they already use means the same thing. | Stay on `schemaVersion` 1. |
| Change the type, the name, or the requiredness of a field, change what a value it already accepts means, or remove a field. | Bump `schemaVersion` to 2. |
| Send a property the schema does not list. | The file is invalid. List the property in the schema as an optional field to stay on 1. |

`additionalProperties` is false on the document and on every object in `$defs`. `validateNetwork()` reports `unexpected property "<name>".` at that path. A `schemaVersion` other than 1 fails with `schemaVersion must be 1.` Version 2 is the number for a later meaning change. This tree still accepts only 1.

A key added in NerdGram 1.5 is rejected by an earlier release, because that release's schema is closed. Leaving the key out keeps the file on version 1, and the generated diagram stays the one that file already produced. `device.model`, `device.diagram`, `interface.speed`, a link `label`, and a link `inferred` flag stay on 1. A file that omits them stays valid. `inferred` true draws a dashed edge. Omitted and false keep the solid edge. Renaming `platform`, or making `managementIp` required, is a bump to 2.

## See also

- [Schema compatibility](schema/README.md)
- [Features](features.md)
- [Automation API](api.md)
- [nerdgram command](cli.md)
