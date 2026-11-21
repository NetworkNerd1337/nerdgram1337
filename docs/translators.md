# Translators

A translator turns a saved export into canonical network JSON.

[Back to the documentation index](README.md)

## Contents

- [Convert](#convert)
- [API](#api)
- [Limits and warnings](#limits-and-warnings)
- [NetBox](#netbox)
- [LibreNMS](#librenms)
- [Nautobot](#nautobot)
- [SolarWinds Orion](#solarwinds-orion)
- [Observium](#observium)
- [Netdisco](#netdisco)
- [Zabbix](#zabbix)
- [Cisco Catalyst Center](#cisco-catalyst-center)
- [Meraki Dashboard](#meraki-dashboard)
- [Cisco pyATS](#cisco-pyats)
- [PRTG](#prtg)
- [Terraform](#terraform)
- [Batfish](#batfish)
- [Picker](#picker)
- [Add a translator](#add-a-translator)

A translator reads a file someone else already saved. It writes a `schemaVersion` 1 network document. NerdGram then draws that document with one upsert. The translator does not log in, store a token, poll, or call the source tool. It does not parse a vendor device config. NerdGram still has no accounts and still binds to `127.0.0.1` and `::1` unless Host is opened.

Each translator is one file in `server/src/translators/`. The registry loads every file there except the shared files (`types`, `limits`, `helpers`, `infra`, `bundled`, `registry`, `request`, `run`, `index`). Adding a source is adding that file. Removing a source is deleting it. `nerdgram`, `/api/v1`, and the OpenAPI document do not grow a branch for the new id.

The document validates against [network.schema.json](schema/network.schema.json). Required keys are `schemaVersion`, `devices`, and `interfaces`. `links` and `vlans` are included. Empty optional fields are omitted. A link is written only when the export has that link.

## Convert

`nerdgram convert <source> [file] [-o out.network.json]` runs in this process. The server can be down. `<source>` is the translator id. With no source, the command prints the installed ids.

```bash
nerdgram convert netbox docs/samples/translators/netbox/campus.json -o campus.network.json
nerdgram convert librenms docs/samples/translators/librenms/campus.json -o campus.network.json
nerdgram generate --path Campus-L3.mmd --data campus.network.json --format network --view l3
nerdgram generate --path Campus-L2.mmd --data campus.network.json --format network --view l2
```

Omit the file, or pass `-`, to read stdin. Without `-o`, stdout is the document and nothing else. Warnings go to stderr. `-o` writes the document and prints the path. `--json` prints one object. With no `-o` that object has `source`, `document`, and `warnings`. With `-o` it has `source`, `output`, `warnings`, and `bytes`, and the file is still only the document. An unknown id, a file that is not JSON or YAML, and a file larger than 4 MiB exit 1. Warnings do not. The API body stays JSON. YAML is for a file passed to `nerdgram convert`, such as a pyATS testbed.

The samples are under [docs/samples/translators](samples/translators). `campus.json` is the full export. `devices-only.json` has no links. Both still convert.

## API

`GET /api/v1/translators` needs a read token. The body is `{ "translators": [ { "id", "name", "formatHint", "placeholder" } ] }`. `id` is the path segment. `name` is the label a picker shows. `formatHint` is the short description of the file. `placeholder` is example text for an empty input. `GET /api/translators` is the same list with no token.

`POST /api/v1/convert/<source>` needs a read token. The body is the export. The response is `{ "source", "document", "warnings" }`.

To upsert in the same call, send the export as `input` and set `path` and `view`:

```bash
curl -fsS -X POST "http://127.0.0.1:8787/api/v1/convert/netbox" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d @docs/samples/translators/netbox/campus.json

curl -fsS -X POST "http://127.0.0.1:8787/api/v1/convert/librenms?path=Campus-L3.mmd&view=l3" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d @docs/samples/translators/librenms/campus.json
```

`view` is `l3` or `l2`. A read token that sends `path` or `view` gets **403**. A read-write token gets **201** when the diagram is created and **200** when it is updated. The upsert is the existing generate upsert. It stores the network JSON beside the diagram. It does not store a token for NetBox or LibreNMS. An unknown id is **404**.

`path`, `view`, `input`, and `text` are reserved on a convert body that asks for an upsert. A source whose own export uses those names at the top level should be posted as `input`.

## Limits and warnings

A convert body or file can be at most 4 MiB (4,194,304 bytes). A larger one is **413** with `too_large`. The JSON parser stops at 5 MB, so the convert cap is the one a normal body hits. Generate refuses a network file over 4 MiB, and a diagram still stops at 2,000 nodes and 5,000 edges. A converted document that is larger than that can be written to a file. Upsert refuses it until it is smaller.

A field the mapper does not copy produces one warning for that field name. The value is dropped. It is not turned into a device or a link. A file with no links still converts. The warning says no links were created, and `links` is `[]`. A `next` URL in a saved page is not fetched. The warning says so.

## NetBox

Id `netbox`. Display name NetBox. The input is a saved REST export, not a live call. List responses use `count`, `next`, `previous`, and `results`. A wrapper may use the keys `devices`, `interfaces`, `cables`, `vlans`, and `ip-addresses` or `ip_addresses`. Each value is that envelope or a raw array. A file that is only one envelope is accepted. A devices-only envelope is valid. `next` is not followed.

Interface `speed` is kilobits per second. The interface model labels it kbps. 10000000 becomes `10G`, 1000000 becomes `1G`, 100000 becomes `100M`, and 10000 becomes `10M`. The unit is the largest one that divides evenly.

Current device payloads use `role`. Older exports use `device_role`. Both are accepted when the value is an object with `name`. Cables use `a_terminations` and `b_terminations`, each an array of `{object_type, object_id}` and often a nested `object`. Older cables use `termination_a` and `termination_b`. A cable becomes one link when each side is exactly one `dcim.interface`. Console, power, and circuit ends are ignored. A cable with more than one interface on a side is ignored, so a breakout is not drawn as a mesh. `primary_ip4.address`, or `primary_ip.address` when the first is empty, is a CIDR such as `192.0.2.1/32`. The host half is `managementIp`.

| Canonical field | NetBox source |
| --- | --- |
| `device.name` | `name` |
| `device.model` | `device_type.model` |
| `device.platform` | `platform.name` |
| `device.role` | `role.name`, or `device_role.name` |
| `device.site` | `site.name` |
| `device.managementIp` | host half of `primary_ip4.address`, then `primary_ip.address` |
| `interface.device` | `device.name` |
| `interface.name` | `name` |
| `interface.description` | `description` |
| `interface.adminStatus` | `enabled`: `true` is `up`, `false` is `down` |
| `interface.speed` | `speed` in kbps, as short text |
| `interface.switchportMode` | `access` stays `access`. `tagged` and `tagged-all` become `trunk` |
| `interface.accessVlan` | `untagged_vlan.vid` when mode is access |
| `interface.nativeVlan` | `untagged_vlan.vid` when mode is tagged or tagged-all |
| `interface.trunkVlans` | `tagged_vlans[].vid` |
| `interface.lag` | `lag.name` |
| `interface.vrf` | `vrf.name`, or the VRF on an assigned address |
| `interface.ipv4` / `ipv6` | `ip-addresses` whose `assigned_object_type` is `dcim.interface`. The CIDR splits into `address` and `prefix` |
| `links[]` | one link per cable with one interface on each side. `label` is `cable.label` |
| `vlans[]` | `vid` becomes `id`, `name` becomes `name` |

`q-in-q` is not mapped. The mode is left empty and a warning is written. `tagged-all` with no VLAN ids becomes a trunk with an empty `trunkVlans` and a warning. A nested id that was not expanded, such as `device_type: 4`, leaves that field empty and warns.

Samples: [campus.json](samples/translators/netbox/campus.json) and [devices-only.json](samples/translators/netbox/devices-only.json).

## LibreNMS

Id `librenms`. Display name LibreNMS. The input is a saved `/api/v0/` export. Devices are `{ "status", "count", "devices": [] }`. Ports are `{ "status", "ports": [] }`. Links are `{ "status", "links": [] }`. A wrapper may use those keys, and each value may be the envelope or a raw array. Addresses are an `ips` or `addresses` section, or an `addresses` array on a port. A devices-only file is valid.

The device name is `hostname`. `sysName` is used only when `hostname` is empty, and that choice is a warning. `display` is used only when both are empty. The official device list example truncates the object with `...`. The add-device display template documents `$ip` as the device address. When the saved device includes `ip` and that value is an IPv4 or IPv6 address, it becomes `managementIp`. A hostname in `ip` is left off, with a warning. `GET /api/v0/devices/:hostname/ip` is a list of port addresses. Put that list in `ips` if those addresses belong on interfaces. It is not copied into `managementIp`.

`ifSpeed` is bits per second. The ports example uses `"10000000000"` for 10G and `"1000000000"` for 1G, next to `ifHighSpeed` in megabits per second. `ifHighSpeed` is used only when `ifSpeed` is missing or 0. `ifAdminStatus` and `ifOperStatus` are the strings `up` and `down` in that example. Numeric `1` is `up` and `2` is `down`, for an older row. Any other value is left empty and warned.

| Canonical field | LibreNMS source |
| --- | --- |
| `device.name` | `hostname`, then `sysName`, then `display` |
| `device.model` | `hardware` |
| `device.platform` | `os` |
| `device.site` | `location` |
| `device.managementIp` | `ip`, when it is an address |
| `interface.device` | `device_id` looked up in the devices list |
| `interface.name` | `ifName` |
| `interface.description` | `ifAlias`, or `ifDescr` when `ifAlias` is empty |
| `interface.speed` | `ifSpeed` in bits per second, as short text |
| `interface.adminStatus` | `ifAdminStatus` |
| `interface.operStatus` | `ifOperStatus` |
| `interface.switchportMode` | from `vlans`: one untagged VLAN and no tagged VLANs is `access`. Any tagged VLAN is `trunk` |
| `interface.accessVlan` | the untagged VLAN when the mode is access |
| `interface.nativeVlan` | the untagged VLAN when the mode is trunk |
| `interface.trunkVlans` | VLAN rows with `untagged` 0 |
| `interface.ipv4` / `ipv6` | `ipv4_address` and `ipv4_prefixlen`, or `ipv6_address` and `ipv6_prefixlen`. A CIDR in `address` is split the same way |
| `links[]` | `local_device_id` and `local_port_id` on one side. The remote side uses the devices list when `remote_device_id` is in it, and `remote_port` or the resolved `remote_port_id` |

A remote that is not in the devices list, but has `remote_hostname` and `remote_port`, becomes a device and an interface with those names. `remote_platform` is that device's `platform`. A row with no usable remote is skipped and warned. A row with `active` `0`, `"0"`, `false`, or `"false"` is skipped. A pair that appears from both ends becomes one link. `ifVrf` of `0` is the default VRF and is omitted. A numeric `ifVrf` is an id, not a name, so `vrf` is left empty and warned. `protocol` and `remote_version` are ignored, with a warning.

Samples: [campus.json](samples/translators/librenms/campus.json) and [devices-only.json](samples/translators/librenms/devices-only.json).

## Nautobot

Id `nautobot`. Display name Nautobot. This is its own module. It is not a flag on NetBox. The input is a saved REST export of devices, interfaces, cables, and optional address and VLAN lists. Each section is a `results` envelope or a raw array. `next` is not fetched. Object ids are UUIDs.

`device.site` is `location.name`. An older export that still has `site` and no `location` uses `site.name` and warns. `device.model` is `device_type.model`. `device.platform` is `platform.name`. `device.role` is `role.name`. `device.managementIp` is the host half of `primary_ip4.address`, then `primary_ip.address`.

Interface `speed` is treated as kilobits per second, the same unit NetBox documents. The Nautobot interface pages checked for this mapper did not restate that unit. 10000000 becomes `10G`. `enabled` true is `adminStatus` `up`. Mode `access`, `tagged`, and `tagged-all` follow the NetBox mapping. `q-in-q` is left empty and warned.

Addresses come from `ip-address-to-interface` (or `ip-addresses`) when the address string is present on `ip_address.address` or `address`. A bare id is skipped and warned. The current IPAddressToInterface record nests `ip_address` and `interface`. A legacy `assigned_object` is accepted when the address is expanded.

A cable becomes one link when each side is exactly one `dcim.interface`. The mapper accepts `terminations.a` / `terminations.b` (connector slots, including the Nautobot 3.2 shape), `termination_a` / `termination_b`, and `a_terminations` / `b_terminations`. Console, power, and circuit ends are ignored. A side with more than one interface is ignored.

Samples: [campus.json](samples/translators/nautobot/campus.json) and [devices-only.json](samples/translators/nautobot/devices-only.json).

## SolarWinds Orion

Id `orion`. Display name SolarWinds Orion. The input is saved SWIS Query JSON. The response envelope is `{ "results": [ ... ] }`, which is what the [SWIS REST query](https://solarwinds.github.io/OrionSDK/docs/rest/) returns. A raw array is also accepted. Keys are `nodes`, `interfaces`, and `topology` (or `topologyConnections`).

Run these in SWQL Studio, or `GET /SolarWinds/InformationService/v3/Json/Query`, and save the three result sets:

```sql
SELECT NodeID, Caption, DisplayName, IPAddress, MachineType, Vendor, Location
FROM Orion.Nodes

SELECT NodeID, InterfaceID, IfName, InterfaceName, Caption, Name, InterfaceCaption,
       Alias, InterfaceAlias, Speed, InterfaceSpeed, AdminStatus, OperStatus
FROM Orion.NPM.Interfaces

SELECT SrcNodeID, SrcInterfaceID, DestNodeID, DestInterfaceID, SrcType, DestType, LayerType
FROM Orion.TopologyConnections
```

`device.name` is `Caption`, or `DisplayName` when Caption is empty. `device.managementIp` is `IPAddress` (`IP_Address` and `IP` are the documented aliases). `device.model` is `MachineType`. `device.platform` is `Vendor`. `device.site` is `Location`. Those names are on the Orion.Nodes schema for 2024.4.

Interface name prefers `IfName`, then `InterfaceName`, then `Caption`, `InterfaceCaption`, or `Name`. Description is `Alias` or `InterfaceAlias`. `Speed` and `InterfaceSpeed` are bits per second on the 2024.4 interface schema. `AdminStatus` 1 is Up and 2 is Down. `OperStatus` uses the same 1 and 2. Other documented values (Testing, Dormant, and the rest) are left empty and warned.

A topology row becomes a link when both interface ids resolve. A row whose `SrcType` or `DestType` is `Orion.ShadowNodes` is skipped. NerdGram does not draw a mesh.

Samples: [campus.json](samples/translators/orion/campus.json) and [devices-only.json](samples/translators/orion/devices-only.json).

## Observium

Id `observium`. Display name Observium. This is its own module. It is not a flag on LibreNMS. The official API is a Subscription Edition feature at `/api/v0/`. NerdGram only reads a file you already saved.

The device example on the API page is an object keyed by id under `devices`, not only an array. Both shapes are accepted, and the same for `ports` and `neighbours`. `address` or `addresses` is optional.

`device.name` is `hostname`, then `sysName`. `device.model` is `hardware`. `device.platform` is `os`. `device.site` is `location` or `location_text`. The device example truncates the object, so a management address is taken from `ip`, `ipv4_address`, or `address` only when that value is an IP. Those keys are not spelled out on the truncated example.

Interface name prefers `ifName`, then `port_short_label`, then `ifDescr` or `port_label`. Description is `ifAlias`. `ifSpeed` is bits per second. `ifVlan` fills `accessVlan` when it is a VLAN id. Trunk sets are not guessed.

Neighbour filters on the API page are `device_id`, `port_id`, `device_b`, `port_b`, `remote_port_id`, `protocol`, `platform`, `version`, and `active`. The page does not publish every row key, so `remote_hostname` and `remote_port` are also accepted. An inactive row is skipped. A remote name that is not in the device list becomes a placeholder. A pair seen from both ends is one link.

Samples: [campus.json](samples/translators/observium/campus.json) and [devices-only.json](samples/translators/observium/devices-only.json).

## Netdisco

Id `netdisco`. Display name Netdisco. The input is a saved JSON bundle of devices, ports, and neighbors from `/api/v1/`. The wiki documents `GET /api/v1/object/device/{ip}` and `GET /api/v1/object/device/{ip}/nodes`. Neighbors are `GET /api/v1/object/device/{ip}/neighbors`, and ports are `GET /api/v1/object/device/{ip}/ports`. The public demo swagger did not load while this mapper was written, so the field names are the device and device_port columns the neighbor worker stores: `ip`, `dns`, `model`, `vendor`, `os`, `location`, `port`, `descr`, `speed`, `vlan`, `remote_ip`, `remote_port`, `remote_name`. A `nodes` section is a MAC or ARP table and is not turned into links.

`device.name` is `dns`, then `name`, then the device IP. `device.managementIp` is `ip`. A neighbor that names a remote device that is not in the device list becomes a placeholder. A pair seen from both ends is one link. NerdGram does not call Netdisco.

Samples: [campus.json](samples/translators/netdisco/campus.json) and [devices-only.json](samples/translators/netdisco/devices-only.json).

## Zabbix

Id `zabbix`. Display name Zabbix. The input is a saved `host.get` result, with `selectInterfaces` and `selectInventory`, or a wrapper with `hosts` and optional `maps`. The JSON-RPC envelope (`jsonrpc`, `result`, `id`) or the bare `result` is accepted.

`device.name` is the visible `name` when it is set, otherwise the technical `host`. `device.managementIp` is the `ip` of the main interface, preferring SNMP (type 2) over the agent (type 1). Inventory `os`, `model`, `type`, and `location` (or `site_city`) map to platform, model, role, and site. Those names are on the host inventory field list.

A Zabbix host interface is an agent, SNMP, IPMI, or JMX endpoint, not a switch port. The interface name is the type plus `ip` and `port`, for example `snmp 192.0.2.1:161`.

Links come only from a bundled `map.get` document: `selements` whose `elementtype` is 0 (host), joined by `links` `selementid1` and `selementid2`. Host groups are not a mesh. If the file has no map, there are no links. The core host API is inventory, not CDP or LLDP.

Samples: [campus.json](samples/translators/zabbix/campus.json) and [devices-only.json](samples/translators/zabbix/devices-only.json).

## Cisco Catalyst Center

Id `catalyst-center`. Display name Cisco Catalyst Center. The input is a saved topology export. `GET /dna/intent/api/v1/topology/physical-topology` returns `{ "response": { "nodes": [], "links": [] } }`. The inner `response`, or a `{ "nodes", "links" }` object, is accepted. The published guide shows `node.id`, `node.label`, `link.source`, `link.target`, `link.startPortName`, `link.endPortName`, and `link.linkStatus`. Links are one direction in the file, so the reverse edge is not invented.

`device.name` is `label`. Interfaces are the port names on the links. `linkStatus` is the link `label` when it is set.

A bundled `sites` list (`name`, and `id` when present) fills `device.site` when a node has `siteId`. The topology guide sample does not show `siteId`. It is used only when the saved node has it. A bundled `network-device` list can fill `managementIpAddress`, `platformId` (model), `softwareType` (platform), and `role`, joined on `id` or `hostname`. Those inventory names are the network-device fields operators export beside the topology. The topology guide itself does not define them. A node property that is not in this list is warned and dropped.

Samples: [campus.json](samples/translators/catalyst-center/campus.json) and [nodes-only.json](samples/translators/catalyst-center/nodes-only.json).

## Meraki Dashboard

Id `meraki`. Display name Meraki Dashboard. The input is a saved `GET /organizations/{organizationId}/devices` list plus `GET /devices/{serial}/lldpCdp` payloads under `lldpCdp`, keyed by serial. NerdGram does not hold an API key and does not call `api.meraki.com`.

`device.name` is `name`, or `serial` when the name is empty. `device.model` is `model`. `device.managementIp` is `lanIp`. `device.site` is a network `name` when a `networks` list is bundled and matches `networkId`. `networkId` alone is not used as a site name.

`lldpCdp.ports` is an object keyed by local port. The published example's `sourcePort` does not match that key, so the key is the local interface. A port with `lldp` or `cdp` becomes one link. LLDP `systemName` and `portId` are preferred. CDP `deviceId` and `portId` are used when LLDP is absent. Both on the same port stay one link. A `systemName` that is not in the device list becomes a placeholder. A port with no neighbor object is not a link.

Samples: [campus.json](samples/translators/meraki/campus.json) and [devices-only.json](samples/translators/meraki/devices-only.json).

## Cisco pyATS

Id `pyats`. Display name Cisco pyATS. The input is a saved testbed or Genie learn document. NerdGram does not run pyATS and does not connect to a device. The CLI accepts JSON or YAML. The page and `POST /api/v1/convert/pyats` take JSON.

A testbed has `devices` keyed by hostname, with `os`, `type`, and `connections` (for example `connections.cli.ip`). That IP is `managementIp`. `os` is `platform`. `credentials` on the testbed or the device are ignored. They are not copied into the document, the warnings, or a log line. A testbed has no cables, so there are no links.

Interface learn output is an `info` object keyed by interface name, under `learn.<device>.interface` or a top-level `info` with a `device` name. `enabled` true is `adminStatus` `up`. `oper_status` `up` or `down` is `operStatus`. `bandwidth` is treated as kilobits per second, which is the IOS bandwidth value Genie copies. The Genie docs checked for this mapper describe the field and not a second unit. `ipv4` is a map of CIDR to `{ ip, prefix_length }`. `vrf` `default` is omitted.

LLDP and CDP learn output use `interfaces.<local>.port_id.<remote port>.neighbors.<remote device>`. A remote device that is not in the learn set becomes a placeholder. A testbed-only file does not invent those links.

Samples: [testbed.json](samples/translators/pyats/testbed.json) and [learn.json](samples/translators/pyats/learn.json).

## PRTG

Id `prtg`. Display name PRTG. The input is a saved `/api/table.json` export. `content=devices` returns a `devices` array. Columns used here are `objid`, `group`, `device`, and `host`, which the table API lists. `device` is the name. `host` is `managementIp` when it is an address. `group` is `site`.

PRTG does not publish a device-adjacency or cable export. Sensors are checks. A sensor becomes an interface only when the row has an `interface` or `port` column. A ping sensor does not become a switch port. Group membership is not a link. `links` are written only when the file already names both devices and ports. A devices-only file warns and draws no edges.

Samples: [campus.json](samples/translators/prtg/campus.json) and [devices-only.json](samples/translators/prtg/devices-only.json).

## Terraform

Id `terraform`. Display name Terraform. The input is a saved `terraform show -json` document. NerdGram does not run Terraform and does not call a provider. It does not read HCL.

A state uses `values.root_module`. A plan uses `planned_values` when that object is present, and `prior_state.values` only when `planned_values` is missing. `format_version` with a major version other than 1 is not mapped. The walker visits `root_module.resources` and every `child_modules` entry. `mode` `data` is skipped. `depends_on` is not a cable. An attribute marked in `sensitive_values` is dropped and is not written into the document or the warning text.

Provider attribute names were not frozen to one vendor schema. The module maps these type names, and that table in `server/src/translators/terraform.ts` is how you add another type after you have checked that provider's docs:

| Type | What it becomes |
| --- | --- |
| `network_device` | `name` or `hostname`, `management_ip`, `model`, `platform` or `os`, `role`, `site` or `location` |
| `network_interface` | `device`, `name`, `description`, `enabled` or `shutdown`, `speed` in bits per second, `ipv4` |
| `network_link` | `a_device`, `a_interface`, `b_device`, `b_interface`, optional `label` |
| `network_vlan` | `vid` or `id`, `name` |

Any other `type` is skipped and warned. A state that only has compute resources becomes an empty device list.

Samples: [state.json](samples/translators/terraform/state.json), [plan.json](samples/translators/terraform/plan.json), and [empty.json](samples/translators/terraform/empty.json).

## Batfish

Id `batfish`. Display name Batfish. The input is saved question JSON. NerdGram does not run Batfish, does not parse a device config, and does not build a snapshot.

Accepted shapes for a question are a records array (pandas `to_json(orient="records")`), a column-oriented object (`orient="columns"` or `"index"`), a split object (`columns` and `data`), or `answerElements[].rows`. Interface cells are `{ "hostname", "interface" }` or the string `hostname[interface]`.

`interfaceProperties` fills interfaces. `Admin_Up` and `Active` are status. `All_Prefixes` and `Primary_Address` are addresses. `Bandwidth` is formatted as bits per second when the number is at least 1000000, and as kilobits per second otherwise. The notebooks show the column and not a single unit, and one saved row uses `100000` on a tunnel, which matches the IOS kilobit bandwidth. `layer3Edges` become links. `switchedVlanProperties` fills `vlans` from `VLAN_ID` and `Name` when that column is present.

`layer1_topology` is the official `layer1_topology.json` object: `{ "edges": [ { "node1": { "hostname", "interfaceName" }, "node2": { "hostname", "interfaceName" } } ] }`. Put that file in the snapshot at `<snapshot>/batfish/layer1_topology.json` before you export the questions. NerdGram does not create it. A layer 3 edge with no matching layer 1 edge is `inferred: true`. The generator draws that as a dashed edge. A neighbor named on an edge and missing from the interface inventory is a placeholder device. A link that is not in the file is not created.

To build `layer1_topology.json` upstream, export CDP or LLDP neighbors, write one edge per neighbor with `hostname` and `interfaceName` on `node1` and `node2`, and save that object under the name and folder above. Then init the snapshot and export `interfaceProperties`, `layer3Edges`, and `switchedVlanProperties`.

Samples: [config-only.json](samples/translators/batfish/config-only.json) and [layer1.json](samples/translators/batfish/layer1.json).

## Picker

**From data** (`/generate`) lists the installed translators from `GET /api/translators`. That route needs no token. Adding or deleting a module file changes the list. The page does not keep its own copy of the ids. Paste and upload call `POST /api/convert/<source>`, the tokenless twin of `POST /api/v1/convert/<source>`, then the existing preview. Mapper warnings are on that preview before the diagram is saved. CSV, JSON, network JSON, CDP, and LLDP stay on the same screen. There is no new sidebar entry.

Every **Source** choice, including each translator, shows a note above the input that says the diagram reflects that data. **Don't show again** stores that choice for that source in this browser and nothing else. **Translator tips** opens this page at that translator's section. Built-in sources use **Source tips** and open [Generate from data](generate-from-data.md). The note follows Light, Dark, and Match system.

## Add a translator

Add `server/src/translators/<id>.ts`. The id is lowercase letters, digits, and hyphens, and it matches the file name. Export the descriptor as the default. Do not edit `cli.ts`, `v1.ts`, the OpenAPI route table, or another translator.

```ts
import { publishDocument, pushWarning } from "./helpers.js";
import type { TranslatorModule } from "./types.js";

const example: TranslatorModule = {
  id: "example",
  name: "Example",
  formatHint: "Example export JSON",
  placeholder: "{\n  \"devices\": []\n}",
  convert(input) {
    const warnings = [];
    pushWarning(warnings, "", "No links in this export. No links were created.");
    return { document: publishDocument({ devices: [], interfaces: [], links: [], vlans: [] }), warnings };
  },
};

export default example;
```

`name`, `formatHint`, and `placeholder` are what a picker shows. The client does not learn the export shape. Put a fixture in `docs/samples/translators/<id>/` and a test next to `server/test/translators/`. `server/test/translatorHarness.ts` checks the document against the published schema and builds the Layer 3 and Layer 2 views. Shared helpers cover warnings, CIDR splits, speed text, and link dedupe. The module must not call the network and must not read a credential. The published `nerdgram` package picks up the file the next time the CLI bundle is built. That bundle scans the directory. It does not keep a hand-written import list.

Deleting the file removes the id from `nerdgram convert`, from `POST /api/v1/convert/<id>`, and from both translator lists.

## See also

- [Generate from data](generate-from-data.md)
- [Automation API](api.md)
- [nerdgram command](cli.md)
- [Schema compatibility](schema/README.md)
