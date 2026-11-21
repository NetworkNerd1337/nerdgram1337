# Design exports

A diagram and its network JSON can be written out as a file another tool can open. NerdGram does not connect to a device, a controller, or an emulator, and it does not store credentials. Password, token, image, and template fields are the placeholder `CHANGE_ME`.

[Back to the documentation index](README.md)

## Contents

- [Commands and routes](#commands-and-routes)
- [What the file is allowed to know](#what-the-file-is-allowed-to-know)
- [Mapping file](#mapping-file)
- [pyATS](#pyats)
- [containerlab](#containerlab)
- [Cisco Modeling Labs](#cisco-modeling-labs)
- [Ansible](#ansible)
- [Nornir](#nornir)
- [GNS3](#gns3)
- [EVE-NG](#eve-ng)
- [Adding a target](#adding-a-target)

## Commands and routes

`nerdgram export <target> <diagram.mmd|file.network.json> [-o file]` runs in this process. The server can be down. Omit the file, or pass `-`, to read network JSON on stdin. `-o` writes the file. A target that returns several files needs `-o` to be a directory, or a path ending in `.zip`. Without `-o`, a single file is the only thing on stdout. Warnings go to stderr. `--json` prints `target`, `output` or `text`, `warnings`, and `bytes`. `--map file.yml` replaces rows in the built-in mapping table. A file named `nerdgram-export-map.yml` beside the input, or in the current directory, is used when `--map` is omitted.

`nerdgram export` with no arguments prints both forms and the installed ids.

`nerdgram export <folder> -o dir/` is unchanged. It still needs the server and a token, and it still calls `GET /api/v1/export?path=`.

A `*.network.json` file is validated against the published schema. A `*.mmd` file uses the `nerdgram.source` path when that path ends in `.network.json`, otherwise a same-stem `.network.json` beside the diagram. CSV, generic JSON, CDP, and LLDP are not enough. The input is at most 4 MiB, 2,000 devices, and 5,000 links.

`GET /api/v1/exporters` (read token) and `GET /api/exporters` (no token, this machine) list `{ "exporters": [ { "id", "name", "extension", "mimeType", "description" } ] }`. `POST /api/v1/export/<target>` is the same mapping with a read token. `POST /api/export/<target>` is the tokenless twin the editor uses. The body is the network document, `{ "input": <document> }`, or `{ "path": "Campus-L3.mmd" }`. A diagram path is resolved to the sibling `.network.json` on the server. That read stays inside the workspace and accepts only `.network.json`. `GET /api/file` still accepts only `.mmd`. **404** when the id is not installed. **400** when the diagram has no network JSON or the document fails the schema. **413** when the document is over the cap. The response is `{ "target", "filename", "text", "files", "warnings", "mimeType", "bytes" }`. Several files also include `archive`, a zip of those files.

The editor **Export as** menu lists image and PDF formats, then **Lab and automation**. The group is filled from `GET /api/exporters`. The menu does not fetch the network file. When `GET /api/export/available?path=` reports a sibling network JSON, those entries are enabled and choosing one downloads the file. When it does not, the entries stay in the menu and are disabled. A disabled option and a line under the menu say **Needs network data. Generate the diagram from data to enable.** The link opens **From data** (`/generate`) and does not discard unsaved edits. Choosing a disabled entry does nothing. The client does not build the file. When the response includes warnings, the editor shows a dismissible note, for example **Exported containerlab topology, 6 things to review**, and lists each warning. A response with no warnings adds no note. This is the same for containerlab, CML, Nornir, GNS3, EVE-NG, pyATS, and Ansible.

## What the file is allowed to know

The export contains only facts from the network document. A missing management IP is omitted, not invented. An unmapped platform becomes `CHANGE_ME` or the field is omitted, and a warning says so. An inferred link (`inferred: true`) is kept and named in a comment or a warning. It is not presented as a proven cable. Interface names on links may be short (`Gi1/0/1`) while the interface list uses `GigabitEthernet1/0/1`. A documented abbreviation table resolves that. An end that still does not match is kept or skipped, with a warning, and no peer is invented.

YAML and XML files start with a comment that says the file was generated, that credentials and images are placeholders, and that missing facts were omitted. JSON (GNS3) has no comment syntax the schema allows, so the same statement is a warning.

## Mapping file

A YAML or JSON file can override a target's table. The top-level key is the exporter id. A row matches a device when every `platform`, `role`, and `model` it sets equals that device, ignoring case. A more specific row wins. An operator row wins over a built-in row of the same specificity.

```yaml
containerlab:
  - platform: Cisco IOS-XE
    role: access
    kind: cisco_iol
    image: CHANGE_ME
pyats:
  - platform: Cisco IOS-XE
    os: iosxe
  - interfacePrefix: Vlan
    type: vlan
```

## pyATS

Id `pyats`. Extension `yml`.

Checked against the published [topology schema](https://pubhub.devnetcloud.com/media/pyats/docs/topology/schema.html) (the DevNet mirror of that page, read while this was written). `testbed.tacacs` and `testbed.passwords` are still marked required in that schema. Both are written, with `CHANGE_ME`, plus `credentials.default`. The schema's own default password is `lab` when a password is omitted. This file does not use that default. `os` is optional (the example value is `iosxe`), so an unmapped platform omits `os` and warns. `type` is required and uses `device.role`, or `device` when role is missing. `platform` is a hardware id. `device.model` is copied there only when it already looks like an id such as `cat9300`, not when it is an OS name. `connections.cli` uses `protocol: ssh` and `ip` from `managementIp` when that field is set.

Interface `type` is a mandatory string. The published schema does not list an enum. The example only shows `ethernet`. This exporter uses `loopback`, `vlan`, `port-channel`, and `ethernet`. Those three extra words are a documented choice, not a confirmed enum. Override them with `interfacePrefix` rows.

`pyats validate testbed` is not run here. The tests parse the YAML and check the blocks. Do not pass `--connect`.

Sample: [docs/samples/exports/pyats/campus.yml](samples/exports/pyats/campus.yml).

## containerlab

Id `containerlab`. Extension `clab.yml`.

Checked against [clab.schema.json](https://raw.githubusercontent.com/srl-labs/containerlab/main/schemas/clab.schema.json) on the containerlab main branch. `name` and `topology` are required. `topology.nodes` is required. A link's `endpoints` are two `node:interface` strings. `kind` is an enum. These rows are in that enum:

| Platform | Role | kind |
| --- | --- | --- |
| Cisco IOS-XE | access, distribution | `cisco_iol` |
| Cisco IOS-XE | core, wan | `cisco_csr1000v` |
| Arista EOS | any | `arista_ceos` |

Cisco IOS-XE with no role, or any other role, is `CHANGE_ME`. Juniper has `juniper_crpd`, `juniper_vjunosrouter`, and `juniper_vjunosswitch` in the same enum. There is no single safe default, so Junos is `CHANGE_ME` until a mapping row picks one. Image tags are not in the schema. Every `image` is `CHANGE_ME`. `group` is `device.site` when set, otherwise `device.role`. `mgmt-ipv4` is `managementIp` when it is IPv4. It is not rewritten into `172.20.20.0/24`. A v6 management address is `mgmt-ipv6`.

`containerlab validate` is not installed in CI. Tests check the YAML shape. The campus file uses kinds from the schema enum, so it satisfies that enum. A `CHANGE_ME` kind will not, until you replace it.

Sample: [docs/samples/exports/containerlab/campus.clab.yml](samples/exports/containerlab/campus.clab.yml).

## Cisco Modeling Labs

Id `cml`. Extension `yaml`.

Checked against [basic-forwarding-behavior.yaml](https://github.com/CiscoDevNet/cml-community/blob/master/lab-topologies/basic-forwarding-behavior.yaml), a lab CML itself distributes. That file has `lab.title`, `lab.version` `0.1.0`, `nodes[]` with `id`, `label`, `node_definition`, `x`, `y`, and `interfaces`, and `links[]` with `id`, `n1`, `n2`, `i1`, `i2`. Loopbacks have `type: loopback` and no `slot`. Physical interfaces have `type: physical` and a 0-based `slot`. The official import page confirms a `.yaml` lab. It does not publish a field schema. This was not checked against a YAML file from the CML 2.10 **Lab → Export** menu.

`node_definition` in the community file is `iosv`, which is IOS, not IOS-XE. `cat8000v`, `csr1000v`, `iosvl2`, and the IOL-L2 id were not confirmed, so the built-in table does not pick one. Unmapped devices are `node_definition: CHANGE_ME` and a warning names those candidates. Set them in the mapping file. Coordinates are a generated grid. There is no running-config. NerdGram does not log in to CML. Import the YAML and attach images that are already on the server.

Sample: [docs/samples/exports/cml/campus.yaml](samples/exports/cml/campus.yaml).

## Ansible

Id `ansible`. Extension `yml`. One static YAML inventory. `all` is the first key.

Checked against the current Ansible platform index and the cisco.ios collection README. That collection covers IOS and IOS-XE and shows `ansible_network_os: cisco.ios.ios` with `ansible_connection: ansible.netcommon.network_cli`. The same index lists `cisco.nxos.nxos`, `cisco.iosxr.iosxr`, `arista.eos.eos`, and `junipernetworks.junos.junos` (not `juniper.junos.junos`). An unmapped platform omits `ansible_network_os` and warns. It does not invent one.

Hosts are `device.name`. `ansible_host` is `managementIp` when set. Site and role become groups. Group names are letters, digits, and underscores, with no leading digit (`19th floor` becomes `g_19th_floor`). `ansible_user`, `ansible_password`, and `ansible_become_password` are `CHANGE_ME` under `all.vars`. Use Vault or `--ask-pass`. A diagram cannot supply become secrets, jump hosts, or a verified network OS when the platform is missing.

`ansible-inventory` is not installed in CI. Tests parse the YAML.

Sample: [docs/samples/exports/ansible/campus.yml](samples/exports/ansible/campus.yml).

## Nornir

Id `nornir`. Four files: `hosts.yaml`, `groups.yaml`, `defaults.yaml`, and `config.yaml`. `config.yaml` points SimpleInventory at the other three. It is not required to load the inventory. `-o` is a directory, or a `.zip`. The API returns `files` and a zip in `archive`.

`platform` is the NAPALM driver name used in the Nornir inventory tutorial: `ios`, `nxos`, `iosxr`, `eos`, `junos`. NAPALM has no separate IOS-XE driver, so IOS-XE is `ios`. Netmiko device types differ (`cisco_ios`, `cisco_xe`, `cisco_nxos`, `cisco_xr`, `arista_eos`, `juniper_junos`). Those strings were not re-read from the current Netmiko driver list. They are written at `connection_options.netmiko.platform`, and every mapped device warns so the choice is not silent. Override `platform` and `netmiko` in the mapping file. An unmapped platform omits `platform`. `hostname` is `managementIp`. Missing management IPs omit it and warn. `defaults.yaml` uses `username` and `password` `CHANGE_ME`. Every group named on a host exists in `groups.yaml`.

Sample: [docs/samples/exports/nornir/](samples/exports/nornir/).

## GNS3

Id `gns3`. Extension `gns3`. MIME type `application/json`.

Checked against the schema on [The GNS3 files](http://api.gns3.net/en/stable/file_format.html) (the latest page still describes the same 2.2 list). Required keys are `project_id` (UUID), `type` `topology`, `revision`, `version`, `name`, and `topology` with `nodes`, `links`, `drawings`, and `computes`. This file uses revision **9** and version `2.2.0`. GNS3 3.x has been reported to use revision 10. That was not confirmed, so the file stays on revision 9, which 2.2 can open. `compute_id` is `local`. `node_type` is `qemu` unless a mapping row sets another value from the published enum. `dynamips` and `iou` are not chosen. The warning says to attach an appliance. Link ends use `node_id`, `adapter_number` 0, and `port_number` in interface order. The closed schema has no comment field, so the disclaimer is a warning. No images are bundled.

Sample: [docs/samples/exports/gns3/campus.gns3](samples/exports/gns3/campus.gns3).

## EVE-NG

Id `eve-ng`. Extension `unl`. MIME type `application/xml`.

The [EVE-NG API page](https://www.eve-ng.net/index.php/how-to-eve-ng-api/) documents lab, node, network, and interface fields. It does not publish a `.unl` XML schema. The element names here follow that API and a starting shape: `lab`, `node` (`type`, `template`, `image`, `ethernet`, `left`, `top`), `interface` (`id`, `name`, `type`, `network_id`), and `network` (`type` `bridge`). `visibility="0"` on networks was **not** checked against a `.unl` saved from a current Community or Pro install. Node types in the published API list are `iol`, `dynamips`, and `qemu`. The fallback type is `qemu`. `template` and `image` are `CHANGE_ME`. Copy the file into EVE-NG and point templates at images you already have. Unconnected interfaces use `network_id` 0. Each link is its own bridge. Inferred links have an XML comment. `config` is `Unconfigured`. There is no startup-config. NerdGram does not log in.

Sample: [docs/samples/exports/eve-ng/campus.unl](samples/exports/eve-ng/campus.unl).

## Adding a target

A target is one file in `server/src/exporters/` that default-exports `{ id, name, extension, mimeType, description, export }`. `export` receives a validated network document and `{ label, mapping }` and returns `{ files, warnings }`. `files` is one or more `{ name, text }` entries. The text can be YAML, JSON, XML, or anything else. Infrastructure files (`registry`, `types`, `helpers`, `run`, and the rest of `EXPORTER_INFRA`) are not targets. The CLI, the routes, and the editor do not name ids. Deleting the file removes the target, including from **Export as**.

## See also

- [Generate from data](generate-from-data.md)
- [Translators](translators.md)
- [Automation API](api.md)
- [Command-line tool](cli.md)
- [Features](features.md)
