# Generate from data

A CSV, JSON, or network JSON file can build the diagram.

[Back to the documentation index](README.md)

A CSV, JSON, or network JSON file can build the diagram. **From data** on the dashboard opens `/generate`. Paste the file or upload it, map columns, choose a flowchart direction and whether groups become subgraphs, preview the Mermaid, then create the diagram. Network JSON skips the column map and asks for a Layer 3 or Layer 2 view instead. The same action is **Generate diagram from data** in the command palette.

Two shapes are accepted. A links table has a local device, a local port, a remote device, and a remote port. A node list has an id and a label, and an optional second file of edges with source, target, and label. JSON can carry both lists in one object (`nodes` and `edges`) or a `links` array. Optional columns are group, type, style class, and a child diagram path. A group becomes a Mermaid `subgraph`. A type or style class becomes a `classDef` and a `class` line. A child diagram path becomes a `click` line such as `click Atlanta "nerdgram:Sites/Atlanta.mmd"`. The path has to be a `.mmd` file inside the workspace. `javascript:` and a path that leaves the workspace are rejected, and the error names the row.

Sample files are [docs/samples/campus-links.csv](samples/campus-links.csv) and [docs/samples/campus.json](samples/campus.json). The CSV is a links table. The JSON is nodes, edges, and a link from Atlanta to `Sites/Atlanta.mmd`.

The data file is saved next to the diagram (`Campus.mmd` and `Campus.csv`, `Core.mmd` and `Core.lldp`, or `Campus.mmd` and `Campus.network.json`). GitHub sync copies both. The diagram's front matter records the file, the column mapping, and the direction under `nerdgram.source`. CDP and LLDP also record `groupBy` and, when you typed one, the local device name. Network JSON records `view` (`l3` or `l2`) and the options used to build that view. That path is from the workspace root. Renaming, moving, or duplicating the diagram moves or copies a data file that sits in the same folder and updates that path. Duplicate can instead keep sharing the original file. Delete can move the data file to the trash with the diagram or leave it in place. Generated lines sit between `%% nerdgram:generated` and `%% nerdgram:generated end`. **Refresh from data** in the editor reads that file, shows nodes and edges added, removed, and changed, and writes the generated block only after you apply it. Notes, the theme, and anything outside the markers stay, including a node you added by hand.

A file can be up to 512 KB, with at most 5,000 rows, 2,000 nodes, and 5,000 edges. A bad row, or a neighbor block that cannot be parsed, names its row or line and does not create the diagram. Labels are escaped so a cell or a hostname cannot close a Mermaid string or add a directive.

## Cisco CDP and LLDP

**From data** also accepts pasted or uploaded command output. Choose **Cisco CDP** or **LLDP neighbors**. CDP is Cisco IOS, IOS-XE, and NX-OS. LLDP is vendor-agnostic: the parser reads the standard LLDP fields (local port, chassis ID, port ID, port description, system name, system description, system capabilities, and management address) whatever order or spelling the CLI uses. A link seen from both ends becomes one edge. `Gi1/0/1` and `GigabitEthernet1/0/1` are the same interface. Grouping can follow platform or capability. The raw output is the data file (`.cdp` or `.lldp`), and **Refresh from data** parses it again.

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

## Layer 3 and Layer 2 from network data

CDP and LLDP draw physical neighbors. A Layer 3 or Layer 2 diagram needs addresses, VLANs, and bundles, and those commands are different on every platform. NerdGram does not parse that output and does not guess links. It reads one vendor-neutral JSON document, `format: "network"`, `schemaVersion: 1`, and draws the diagram from that document only. The same file always produces the same generated block. A later refresh replaces that block. It does not invent a link that is not in the file.

You produce the JSON. NerdGram does not ship TextFSM, Genie, NAPALM, Batfish, Nautobot, or NetBox. The schema is [docs/schema/network.schema.json](schema/network.schema.json). The compatibility rule is [Schema compatibility](#schema-compatibility). A file is stored as `.network.json`.

| Field | Required | What it is |
| --- | --- | --- |
| `devices` | yes | `name`, plus optional `platform`, `role`, `site`, and `managementIp`. |
| `interfaces` | yes | `device` and `name`. Optional description, `adminStatus` and `operStatus` (`up` or `down`), `ipv4` and `ipv6` as `{ "address", "prefix" }`, `vrf`, `switchportMode` (`access` or `trunk`), `accessVlan`, `trunkVlans`, `nativeVlan`, and `lag`. |
| `links` | no | Undirected pairs `{ "a": { "device", "interface" }, "b": { "device", "interface" } }`, usually from CDP, LLDP, or a source of truth. |
| `vlans` | no | `id` and optional `name`. An access VLAN and a native VLAN other than 1 are labeled with the name when one is set (`access 20 servers`, `native 99 native`). |
| `neighbors` | no | Optional `cdp` or `lldp` text. The existing CDP and LLDP parsers add those pairs to the Layer 2 view. `localDevice` is the hostname when the paste has no prompt. |

`Gi1/0/1` and `GigabitEthernet1/0/1` are the same interface, and `Po1` and `Port-channel1` are the same bundle. An omitted VRF and a VRF named `default` are the same VRF. Any other VRF name is its own. A validation error names the field, for example `/interfaces/1/ipv4/0/prefix: prefix must be an integer from 0 to 32.`

**Layer 3** (`"view": "l3"`). Each address and prefix becomes a subnet. Two interfaces in the same `/30`, `/31`, or `/127` are one edge, labeled with the subnet and both interface names and addresses. Any other subnet with two or more attached devices is a segment node, such as `10.1.20.0/24`, with an edge to each device. A `/32` or `/128` is written on the device, not drawn as a link. A subnet with only one attached interface is written on the device the same way. The management IP is written on the device when that address is not already on the label. The same numbers in two VRFs stay two subnets. **Group by** can be VRF. A device that belongs to one VRF is drawn in that VRF. A device that belongs to more than one VRF is drawn once, in a subgraph named with those VRFs in alphabetical order, such as `default, GUEST`. The same address and prefix in one VRF on more than one device is a warning, and a `/30`, `/31`, or `/127` is not drawn as a link when both ends use that same address. Shutdown or `down` interfaces are left out unless **Include shutdown or down interfaces** is checked (`includeDown: true`).

**Layer 2** (`"view": "l2"`). Links come from `links`, plus CDP or LLDP text under `neighbors` when that text is in the file. A trunk is labeled with the allowed VLANs compressed into ranges (`10,20,30-40`). The native VLAN is added when it is not 1, including its name when `vlans` has one. When both ends list allowed VLANs, the label is the VLANs they share. Members of the same LAG between the same two devices become one edge, labeled with the port-channel name, the member count, and the member interfaces. The VLAN configuration on the port-channel interface is used when that interface is in the file. **VLAN filter** (`vlan`) keeps only the links that carry that VLAN. **Group by** can be site or role. An access VLAN is labeled `access 20`, or `access 20 servers` when VLAN 20 has that name. A shutdown or down interface is left off the link unless `includeDown` is set. The management IP is written on the device.

**From data** has a **Network data (JSON)** choice. Pick Layer 3 or Layer 2, set the options, preview, then create. The preview is the Mermaid that will be saved. `nerdgram.source` stores the file, the view, and the options. **Refresh from data** reads that file and rewrites only the generated block. Rename, move, duplicate, and delete treat `.network.json` the same way they treat `.csv`, `.json`, `.cdp`, and `.lldp`. A description that is still `Generated from <path>` is updated to the new data path. A description you wrote is left alone.

The sample [docs/samples/network/campus.network.json](samples/network/campus.network.json) is a small campus: a core router, a distribution switch, two access switches, and a WAN router. The same file produces both views. Layer 3 draws the routed links. Layer 2 draws the trunks and access ports, including the uplink from the distribution switch to the core router and the link from the core router to the WAN router, so every device is connected. These commands need the server and a token, and they are run from the repository root.

```bash
nerdgram generate --path Campus-L3.mmd --data docs/samples/network/campus.network.json --format network --view l3
nerdgram generate --path Campus-L2.mmd --data docs/samples/network/campus.network.json --format network --view l2 --group-by site --vlan 20
nerdgram refresh Campus-L3.mmd
```

`--include-down` draws shutdown and down interfaces. `--group-by vrf` is the Layer 3 grouping. `--group-by site` and `--group-by role` are the Layer 2 grouping. Refresh does not take `--view`. The view and the options are already in the diagram.

**Producing the file.** Map whatever you already collect into the fields above. Nothing below is bundled, and NerdGram does not run it.

NAPALM `get_facts`, `get_interfaces`, and `get_interfaces_ip` cover the device and the addresses. `get_facts()["hostname"]` is `devices[].name`. `get_interfaces()[name]["is_enabled"]` is `adminStatus` (`false` is `down`) and `is_up` is `operStatus`. `get_interfaces_ip()[name]["ipv4"]` is a dict of address to `{ "prefix_length": N }`. Each entry becomes `{ "address", "prefix": prefix_length }`. IPv6 is the `ipv6` dict, with a prefix from 0 to 128. NAPALM has no single switchport getter on every driver. Map the switchport, the trunk list, the native VLAN, and the port-channel from the getter or the source of truth you already use.

Cisco Genie `device.learn("interface")` returns structured JSON, not CLI text. For each interface, `info[name]["ipv4"][address]["prefix_length"]` is the prefix, and `info[name]["switchport"]["mode"]` becomes `access` or `trunk`. Expand a Genie VLAN range into the `trunkVlans` array of integers. NerdGram compresses ranges again when it draws the label.

TextFSM, including ntc-templates, parses one command into rows. A `show ip interface` template that emits `INTERFACE`, `IPADDR`, and `PREFIX` becomes one `interfaces` entry per row. `show interfaces switchport` rows fill `switchportMode`, `accessVlan`, `trunkVlans`, and `nativeVlan`. Split `10,20,30-40` into the integers 10, 20, and 30 through 40 before you write the file. The same pattern works for `show etherchannel summary`: the port-channel name goes in `lag` on each member. Put the rows from every device in one JSON document. One generate call builds the whole diagram.

CDP and LLDP links can be copied from a diagram you already imported, or from the parser you trust, into `links`. You can also paste the raw `show cdp neighbors detail` or `show lldp neighbors detail` into `neighbors.cdp` or `neighbors.lldp`. That text is parsed by the existing CDP and LLDP parsers. NerdGram does not add a parser for any other command.

## Schema compatibility

`schemaVersion` is 1. An additive optional field stays on 1. A change to a field's meaning bumps `schemaVersion` to 2. The schema stays closed, so an unexpected property is still an error. A file that uses a key added in NerdGram 1.5 needs NerdGram 1.5 or later. A file that omits that key keeps working. The same rule is in [Schema compatibility](schema/README.md) and in the description of [network.schema.json](schema/network.schema.json).

| Change | What happens |
| --- | --- |
| Add an optional field. A file that omits it still validates, and every field it already uses keeps the same meaning. | Stay on `schemaVersion` 1. |
| Add an allowed value older files do not use, while every value they already use means the same thing. | Stay on `schemaVersion` 1. |
| Change the type, the name, or the requiredness of a field, change what a value it already accepts means, or remove a field. | Bump `schemaVersion` to 2. |
| Send a property the schema does not list. | The file is invalid. List the property in the schema as an optional field to stay on 1. |

`additionalProperties` is false on the document and on every object in `$defs`. `validateNetwork()` reports `unexpected property "<name>".` at that path. A `schemaVersion` other than 1 fails with `schemaVersion must be 1.` Version 2 is the number for a later meaning change. This tree still accepts only 1.

A key added in NerdGram 1.5 is rejected by an earlier release, because that release's schema is closed. Leaving the key out keeps the file on version 1, and the generated diagram stays the one that file already produced. An optional device model, or an optional speed on an interface, stays on 1 once the schema lists that field. Renaming `platform`, or making `managementIp` required, is a bump to 2.

## See also

- [Schema compatibility](schema/README.md)
- [Features](features.md)
- [Automation API](api.md)
- [nerdgram command](cli.md)
