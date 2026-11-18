# Translators

A translator turns a saved export into canonical network JSON.

[Back to the documentation index](README.md)

## Contents

- [Convert](#convert)
- [API](#api)
- [Limits and warnings](#limits-and-warnings)
- [NetBox](#netbox)
- [LibreNMS](#librenms)
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

Omit the file, or pass `-`, to read stdin. Without `-o`, stdout is the document and nothing else. Warnings go to stderr. `-o` writes the document and prints the path. `--json` prints one object. With no `-o` that object has `source`, `document`, and `warnings`. With `-o` it has `source`, `output`, `warnings`, and `bytes`, and the file is still only the document. An unknown id, a file that is not JSON, and a file larger than 4 MiB exit 1. Warnings do not.

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

A convert body or file can be at most 4 MiB (4,194,304 bytes). A larger one is **413** with `too_large`. The JSON parser stops at 5 MB, so the convert cap is the one a normal body hits. Generate still refuses a network file over 512 KB, and a diagram still stops at 2,000 nodes and 5,000 edges. A converted document that is larger than that can be written to a file. Upsert refuses it until it is smaller.

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
