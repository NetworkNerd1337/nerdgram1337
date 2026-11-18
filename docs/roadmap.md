# Roadmap

The planned work after 1.4.8. 1.5.x is Compass. Later milestones use the code name written on each section.

[Back to the documentation index](README.md)

## Contents

- [Where we are](#where-we-are)
- [Guardrails](#guardrails)
- [How data lands today](#how-data-lands-today)
- [Out of scope](#out-of-scope)
- [Why this order](#why-this-order)
- [1.5.0 Canonical JSON and one upsert](#150-canonical-json-and-one-upsert)
- [1.6.0 Published schemas and push scripts](#160-published-schemas-and-push-scripts)
- [1.7.0 Stateless translators](#170-stateless-translators)
- [1.7.5 Additional translators](#175-additional-translators)
- [1.8.0 Design exports](#180-design-exports)
- [1.8.5 Additional exports](#185-additional-exports)
- [Later ideas](#later-ideas)
- [Future ideas (not committed)](#future-ideas-not-committed)

Progress is tracked in [GitHub milestones](https://github.com/NetworkNerd1337/NerdGram1337/milestones).

This roadmap is a plan, not a commitment. The work starts from the 1.4.8 Atlas tree. 1.5.x is Compass. 1.6.x is Galileo. 1.7.0 through 1.7.5, and the other 1.7.y patches, are Navigator. 1.8.0 through 1.8.5, and the other 1.8.y patches, are Meridian. 2.0 is not named yet. The code-name rule is in [Versioning and releases](releases.md#version-numbers-and-code-names).

## Where we are

1.4.0 through 1.4.8 put NerdGram in a mature, stable place. The app is local and on-demand, it installs from npm, Docker, or source, and the docs are split into pages people can actually find. This is a good time to plan the next useful work without changing what the app is.

| Fact | Value |
| --- | --- |
| Current release | 1.5.1 Compass |
| Canonical network schema | `schemaVersion` 1, in [docs/schema/network.schema.json](schema/network.schema.json) |
| Automation API | `GET /api/v1/openapi.json` already exists (OpenAPI 3.0.3, no token) |
| Generate behavior | `POST /api/v1/generate` returns **409** if the path exists; refresh updates an existing diagram |

## Guardrails

**The line.** NerdGram is where data lands, not what goes out and fetches it. Discovery, monitoring, always-on polling, and stored SNMP, SSH, or API credentials are out. The app stays light, free, local (`127.0.0.1` by default, no user auth or roles), on-demand, and code-driven. No new heavy subsystems. Reuse the generate and refresh path that already exists.

That line is already written into the 1.4.8 docs. [Generate from data](generate-from-data.md) says you produce the vendor-neutral JSON, and that NerdGram does not ship TextFSM, Genie, NAPALM, Batfish, Nautobot, or NetBox. The schema file itself says turning vendor output into this document is the caller's job. The work below is about making that job easier, not about turning NerdGram into a collector.

**Stays in scope.**

- A versioned, published schema people can generate against.
- One upsert so a cron job is a single call.
- Richer canonical JSON, translators that feed it, and text exports that leave it.
- New sources and export targets are one mapping module each, with no credentials stored.

**Turns into a different app.**

- Discovery or monitoring inside NerdGram.
- Stored SNMP, SSH, or inventory-tool tokens.
- A first-class NetBox or LibreNMS integration that pulls.
- A built-in simulator, or parsing vendor configs inside NerdGram.
- User auth, or a drag-and-drop editor as the focus.

## How data lands today

There are two JSON shapes, and that distinction matters. A generic CSV or JSON file is a table of nodes and edges for a flowchart. A network JSON file (`format: "network"`, `schemaVersion` 1) is the richer, vendor-neutral document for Layer 3 and Layer 2 views. CDP and LLDP are a third path: pasted CLI output that becomes a links table. All three go through the same generate and refresh routes. Facts below are from the 1.4.8 tree.

| Format | What it is | Code and docs |
| --- | --- | --- |
| CSV | A links table or a node list, with an optional second edges file. | `server/src/diagramData.ts`, [Generate from data](generate-from-data.md), [docs/samples/campus-links.csv](samples/campus-links.csv) |
| Generic JSON | The same tables, as an array of row objects, a `links` array, or a `nodes` plus `edges` object. | `tableFromJson()` in `diagramData.ts`, [docs/samples/campus.json](samples/campus.json) |
| CDP | Cisco IOS, IOS-XE, and NX-OS `show cdp neighbors detail`. The short neighbor table is rejected. | `server/src/neighbors/cdp.ts`, [docs/samples/neighbors](samples/neighbors) |
| LLDP | One vendor-agnostic parser for detail output, plus `lldpctl` text, keyvalue, and JSON. | `server/src/neighbors/lldp.ts`, [docs/samples/neighbors](samples/neighbors) |
| Network JSON | Closed schema, `schemaVersion` 1. Used for Layer 3 (subnets) and Layer 2 (VLANs, trunks, and LAGs). | [docs/schema/network.schema.json](schema/network.schema.json), `server/src/network/`, [docs/samples/network/campus.network.json](samples/network/campus.network.json) |

Shared limits, from `DATA_LIMITS` in `diagramData.ts` and [Generate from data](generate-from-data.md): 512 KB per file, 5,000 rows, 2,000 nodes, 5,000 edges, 40 columns. A data file is stored beside the diagram (`.csv`, `.json`, `.cdp`, `.lldp`, or `.network.json`). Refresh rewrites only the block between `%% nerdgram:generated` markers. Notes and hand-edited nodes outside those markers stay.

API and CLI entry points that accept this data:

| API | CLI | What it does |
| --- | --- | --- |
| `POST /api/v1/generate/preview` (read token) | none | Builds Mermaid from the payload and writes nothing. |
| `POST /api/v1/generate` (read-write) | `nerdgram generate --path … --data …` | Creates the diagram and stores the data file. **409** if the path already exists. |
| `POST /api/v1/generate/refresh` (read-write) | `nerdgram refresh <path> [--data …]` | Replaces the generated block of an existing diagram. View options come from front matter, not the body. `save: true` writes the file; `writeData: true` updates the sibling data file. |

There is no `nerdgram convert` command today, and no `/api/v1/convert` route. `PUT /api/v1/diagrams` (`nerdgram put`) can create or overwrite raw Mermaid with `force: true`. That is not a data-import upsert. A script that wants to push data on a schedule today has to call generate, and on **409** fall back to refresh with `save: true` and `writeData: true`. That two-step pattern is the gap an upsert would close. Each call still sends the complete document. Generate and refresh never append one device at a time. That complete-document model should stay.

### CSV and generic JSON fields

Recognized fields are `SHAPE_FIELDS` and `ALIASES` in `diagramData.ts`.

| Shape | Required | Optional | Ignored or rejected |
| --- | --- | --- | --- |
| Links table | `localDevice`, `remoteDevice` | `localPort`, `remotePort`, local and remote group, type, style class, and child diagram path | Unmapped columns are ignored. Nested JSON objects become empty cells. `javascript:` and paths that leave the workspace are rejected on diagram fields. |
| Node list | `id` | `label`, `group`, `type`, `styleClass`, `diagram` | A node list without an edges file or embedded edges is rejected. Extra keys that do not alias to a known field are ignored. |
| Edges | `source`, `target` | `label` | Same as above: only mapped fields are used. |

The generic graph shape has a JSON Schema at [docs/schema/graph.schema.json](schema/graph.schema.json), served at `GET /api/v1/schema/graph.json`. Column names are matched through aliases (for example `neighbor`, `hostname`, `site`, `role`, `href`). Groups become subgraphs, types become `classDef`, and a child diagram path becomes a `click` line.

### CDP and LLDP

The parsers normalize to local and remote device, local and remote port, platform, and capability. Grouping is by platform (the default) or capability. A link seen from both ends becomes one edge. Interface short names such as `Gi1/0/1` match the long form. The hostname comes from the CLI prompt, or from `localDevice` when there is no prompt. Several devices can be pasted one after another in one file.

- CDP (`cdp.ts`) actually reads Device ID, Platform, Capabilities, Interface, Port ID (outgoing port), and Version. Version is only used to help infer platform. The short `show cdp neighbors` table is rejected with an error that asks for the detail command.
- LLDP (`lldp.ts`) actually keeps local port, chassis ID, port ID, port description, system name, system description, capabilities, and an optional platform. Remote device falls back from system name to chassis ID. A MAC port ID falls back to the port description.
- Not stored or drawn, even when the paste contains them: CDP management address, duplex, holdtime, and native VLAN; LLDP management address (the file comment lists it as a standard TLV, but the bag and `RawNeighbor` types have no field for it).

### Network JSON

Network JSON is a closed object. `additionalProperties` is false in the schema, and `validateNetwork()` rejects any unexpected property by path. `schemaVersion` must be 1. `format`, if present, must be `"network"`. Auto-detect treats a JSON object as network data when `format` is `"network"`, or when `schemaVersion` is 1 and both `devices` and `interfaces` are arrays.

| Key | Required? | Fields | What generate actually uses |
| --- | --- | --- | --- |
| `devices` | yes | `name` (required); optional `platform`, `role`, `site`, `managementIp` | `name` is the node. `managementIp` is written as `mgmt …` when that address is not already on the label. `role` is the style class, and a Layer 2 group-by option. `site` is a Layer 2 group-by option. `platform` is accepted and stored, but `server/src/network/generate.ts` never draws it and network group-by cannot be platform. |
| `interfaces` | yes | `device` and `name` (required); optional `description`, `adminStatus`, `operStatus` (`up` or `down`), `ipv4` / `ipv6` as `{address, prefix}`, `vrf`, `switchportMode` (`access` or `trunk`), `accessVlan`, `trunkVlans`, `nativeVlan`, and `lag` | Addresses drive the Layer 3 view. Switchport, VLAN, and lag fields drive Layer 2 labels, LAG bundling, and the VLAN filter. Down or shutdown interfaces are omitted unless `includeDown` is true. `description` is accepted and stored, but `generate.ts` never writes it on the diagram. |
| `links` | no | Undirected `{ a: {device, interface}, b: {device, interface} }` only | The Layer 2 view. Validation checks that both devices exist, not that the named interfaces exist in the `interfaces` array. No bandwidth, cable id, status, or label field is accepted. |
| `vlans` | no | `id` (1–4094), optional `name` | Names are used in Layer 2 labels (`access 20 servers`, `native 99 native`). No site or role on a VLAN. |
| `neighbors` | no | Optional `cdp` and `lldp` text, plus `localDevice` | The existing CDP and LLDP parsers add those pairs to the Layer 2 view only. |

So the network format is not a thin subset. It already has devices, interfaces, IPv4 and IPv6, VRFs, VLANs, trunks, LAGs, sites, roles, and management IPs. The real gaps are: a few accepted fields are not drawn; the schema is closed, so any extra metadata is an error; there are no first-class objects for locations or racks, device models or types beyond a free-text platform and role, interface speed or MTU, link labels, tags, tenants, or child-diagram click paths (those last exist only on the generic CSV and JSON path); and OpenAPI does not yet publish this schema cleanly.

**What is already published, and what is thin.**

- [docs/schema/network.schema.json](schema/network.schema.json) is a real JSON Schema (draft 2020-12). The `$id` is `http://127.0.0.1:8787/api/v1/schema/network.json`, and `GET /api/v1/schema/network.json` serves that file with no token.
- `GET /api/v1/openapi.json` is public and is built in `server/src/openapi.ts`. It includes response schemas, request examples, the upsert call, every group-by value including platform, and the network document as the `NetworkDocument` component.
- [Automation API](api.md) and [the command-line tool](cli.md) already document the routes, the 409-on-create behavior, and curl examples for CDP and a small network JSON body. There is no checked-in cron script, and no example that maps NetBox or LibreNMS output.

## Out of scope

These stay off the roadmap. They would split the product into a second, always-on application and break the current security model.

- Discovery or network crawling inside NerdGram.
- Monitoring, polling, or any always-on collector.
- Storing SNMP, SSH, or third-party API credentials or tokens for NetBox, LibreNMS, or anything else.
- NerdGram calling out to NetBox, LibreNMS, or a device to pull data.
- User accounts, logins, or role-based access. Automation tokens for the local API stay; they are not user auth.
- A visual drag-and-drop editor as the focus. NerdGram stays code-first.
- Bundling TextFSM, Genie, NAPALM, Batfish, or a NetBox or LibreNMS client as a supported collector. NerdGram still does not ship or run Batfish. Reading Batfish's exported question JSON through the 1.7.5 translator is in scope.
- A built-in simulator or emulator. That would be a product fork, not a diagramming tool.
- Parsing vendor device configs inside NerdGram. That is high-maintenance churn. Point instead to Batfish, pyATS/Genie, and ntc-templates/TextFSM, with an optional docs recipe for converting their output to NerdGram JSON. NerdGram still never parses those configs. The 1.7.5 Batfish translator reads structured output Batfish has already written.
- Storing credentials for test tools such as pyATS or lab platforms. Exported files may include placeholders only, and NerdGram never connects to devices.

## Why this order

The releases are ordered by architectural dependency, so later work does not have to reopen earlier work. If we published a polished OpenAPI document, a served JSON Schema, and example scripts first, then changed the JSON shape, those published contracts and scripts would have to be rewritten. If we wrote NetBox and LibreNMS translators first, then added fields or changed `schemaVersion`, the mappers would have to be reopened. So the canonical JSON is settled first, the schema is published against that settled shape, and the translators are built next, against a stable, documented target. Design exports come after that, reading the same canonical JSON and reusing the one-file modular pattern 1.7.0 has to prove.

The create-or-update upsert lives in 1.5.0 even though it does not depend on which fields exist. Later push scripts and translators should have one call to aim at. If that call shipped after the 1.6.0 examples, those scripts would be written first as generate-then-refresh, then written again for upsert. Schema versioning and compatibility policy also live in 1.5.0, before any optional fields are added, so the JSON changes follow a written rule instead of inventing one mid-flight.

**1.7.5 is gated on 1.7.0.** NetBox and LibreNMS are enough to prove that two very different sources can be added as separate modules against a shared contract. If that architecture holds, 1.7.5 adds more mapping modules the same way. If 1.7.0 shows the translator system will not work, 1.7.5 is simply dropped from the roadmap, and the earlier releases stay as they are.

**1.8.0 follows the same logic on the way out.** It exports the settled document to text files, and it should reuse the modular pattern 1.7.0 proves. **1.8.5 is gated on 1.8.0** the same way 1.7.5 is gated on 1.7.0. If the export system does not hold, 1.8.5 is simply dropped.

## [1.5.0 Canonical JSON and one upsert](https://github.com/NetworkNerd1337/NerdGram1337/milestone/1)

Settle the document shape, write the compatibility rule those changes need, and add the one create-or-update call. Four complete one-PR issues, in this order. Code name Compass. Old documents without new optional fields must still validate and draw the same diagram.

### 1.5.0-a Schema versioning and compatibility policy

Write the rule before the JSON changes land. Additive optional fields stay on `schemaVersion` 1. A change to a field's meaning bumps `schemaVersion` to 2. The schema stays closed: unexpected properties are still errors. Files that use new keys need NerdGram 1.5 or later; files that omit them keep working. Put this in `docs/schema`, [Generate from data](generate-from-data.md), and the schema description itself.

**Success.** A reviewer can tell when to stay on 1 versus bump to 2, and the policy is in the repo before the field-adding PR.

### 1.5.0-b Draw the fields we already accept

`device.platform` and `interface.description` are already in the schema and in `validateNetwork()`, but `generate.ts` never writes them on the diagram. Use them. Platform belongs on the device label, and should be a Layer 2 group-by option alongside site and role (a small, justified extension of today's `vrf` / `site` / `role` list). Description belongs on Layer 2 link or interface labels when it is present. Update [Generate from data](generate-from-data.md) and, in the same PR, the existing OpenAPI `groupBy` enum so the living spec is not stale. Leave the broader OpenAPI polish to 1.6.0.

**Success.** The campus sample or a new fixture shows platform and descriptions in the Mermaid; `--group-by platform` works for a Layer 2 network view; existing diagrams that omit these fields look unchanged.

### 1.5.0-c Additive optional fields, still a closed schema

Follow the 1.5.0-a policy. Add only optional fields that help a diagram and that a later NetBox or LibreNMS translator can fill. Suggested fields, marked as suggestions to react to: `device.model` (distinct from free-text platform and role), a child diagram path on a device (the generic CSV and JSON path already has this), `interface.speed`, and an optional label on a link. Racks, tenants, cable IDs, and a tags database stay out unless there is a clear drawing use. Update the in-repo schema, validator, generator, sample, and docs in this same PR.

**Success.** Those sources all agree; an old `campus.network.json` still builds the same views; a new fixture using the added fields draws them; unexpected properties are still errors.

### 1.5.0-d One idempotent upsert for generated diagrams

Add a single call that creates the diagram on first push and refreshes the generated block on later pushes of the same path. This call does not depend on the JSON shape, but it should ship in 1.5.0 so 1.6.0 scripts and 1.7.0 translators can use it once. Leave the complete-document model alone: the body is still the whole file, never a delta. Preserve hand edits outside the generated markers, and keep the current **409** behavior available for callers that want create-only. CLI `nerdgram generate` should use the upsert path by default, or grow an explicit flag, so a cron job is one command. Point the API and CLI docs at the new call; leave polished curl and cron examples to 1.6.0.

**Success.** Posting the same path twice does not 409; the second call updates the generated block and the sibling data file; notes outside the markers survive; tests cover create, refresh, conflict-on-create-only, and the CLI.

## [1.6.0 Published schemas and push scripts](https://github.com/NetworkNerd1337/NerdGram1337/milestone/2)

Publish the contract against the shape 1.5.0 already settled. Do not add fields here. Two complete one-PR issues. Code name Galileo.

### 1.6.0-a Publish and polish the schemas

Expand `GET /api/v1/openapi.json` with real response schemas, request examples, and the 1.5.0 network document as a named component, including upsert and any new group-by values. Serve the same network JSON Schema at a public route such as `GET /api/v1/schema/network.json` (no token, same Host checks as OpenAPI), with a reachable `$id`. Add a JSON Schema for the generic nodes, edges, and links shape, which does not have one today. Keep [Automation API](api.md) and [Generate from data](generate-from-data.md) in sync with the served files.

**Success.** The served OpenAPI validates; the served network schema matches [docs/schema/network.schema.json](schema/network.schema.json) from 1.5.0; a reviewer can generate a client from the OpenAPI document without guessing response shapes.

### 1.6.0-b Example push scripts

Add copy-paste curl and cron examples under `docs/samples` that preview and upsert a diagram from the campus network sample, using the 1.5.0 upsert call and the 1.6.0-a schema URLs.

**Success.** A script in the repo creates a diagram on the first run and updates it on the second, without a generate-then-refresh fallback, and the docs point at the served OpenAPI and JSON Schema.

## [1.7.0 Stateless translators](https://github.com/NetworkNerd1337/NerdGram1337/milestone/3)

Code name Navigator. 1.7.5 stays on Navigator.

Do not add a NetBox pipeline or a LibreNMS pipeline as first-class NerdGram features. Add small, stateless translators that take a file or a JSON payload from those tools and write NerdGram's canonical network JSON. These mappers target the JSON shape settled in 1.5.0 and the schema and upsert published in 1.6.0, so they do not have to be rewritten when the contract changes. Translators hold no credentials and make no outbound calls. The always-on piece, and any tokens, stay in NetBox, LibreNMS, or a cron job the operator already runs.

1.7.0 keeps the sources to just NetBox and LibreNMS on purpose. Its job is to prove a modular translator architecture: each translator is defined in its own single file or module, is registered and discovered in a modular way, and can be added or removed without touching core code. Two very different sources are enough to test that. A later 1.7.5 milestone expands the set only if this architecture holds.

The intended flow:

1. Someone else collects the data. NetBox, LibreNMS, NAPALM, or a human export. NerdGram does not log in or poll.
2. A translator rewrites it. `nerdgram convert`, or `POST /api/v1/convert/<source>`, produces canonical network JSON.
3. NerdGram draws it. One upsert call creates or refreshes the diagram from that document.

### Delivery options

| Option | What it is | Fit |
| --- | --- | --- |
| CLI: `nerdgram convert <source>` | Read a file or stdin, write canonical JSON to stdout or a file. Should work without a running server, the way local lint and render already can. | Best default for cron and for people who already collect exports. Stays on-demand. |
| API: `POST /api/v1/convert/<source>` | Same mapping modules, payload or file in, canonical JSON out. Optional follow-on upsert onto a diagram path. No stored tokens. | Useful when a local script or a webhook already talks to the API. Not a pull client. |
| A separate package | Translators live outside `nerdgram1337`. | Keeps the core smaller, but the schema and the mappers will drift. That is not the starting point. |

**Recommendation.** Ship both the CLI and the API endpoint, sharing one mapping module per source inside this repo. Do not start a second package. Adding a source should mean adding one module file that is registered and discovered automatically, plus a fixture and a short docs note. Removing a source should mean deleting that file, with no edits to core convert, generate, or CLI wiring. The first two sources are NetBox (REST export JSON, for example dcim devices, cables, and interfaces) and LibreNMS (API JSON, for example devices and links). They are different enough that both fitting the same contract is the proof. Map what those exports actually contain onto the canonical fields; drop or warn on the rest. Do not invent links that are not in the file.

A NetBox webhook that POSTs an export or event payload into `POST /api/v1/convert/netbox`, and optionally into the upsert, is a reasonable option once the endpoint exists. It is still a push. It still stores no NetBox token. It is not the default path, because NerdGram binds to `127.0.0.1` and `::1` unless Host is opened. A remote NetBox cannot reach a default install. The usual pattern is a local hook, cron, or relay that already has the export and pushes it to loopback.

### 1.7.0-a Translator framework plus NetBox mapper

One PR, complete on its own: the convert CLI (offline), `POST /api/v1/convert/netbox`, a shared translator contract and test harness, and a NetBox mapping module in its own file, with fixtures from realistic dcim device, interface, and cable JSON, docs, and tests. Unknown or unmapped fields are ignored with a warning, never silently turned into fake links.

**Success.** A saved NetBox export file converts to a document that validates against the published 1.6.0 schema and builds both L3 and L2 views through the 1.5.0 upsert; `nerdgram convert netbox` works with the server down; the API holds no credentials and makes no outbound calls; later sources can be discovered from a module file without a hard-coded core switch that each new source would have to edit.

### 1.7.0-b LibreNMS mapper

One PR that adds a second mapping module, CLI source, and `/api/v1/convert/librenms`, plus fixtures for devices and links. This is the architecture proof: LibreNMS is a very different source from NetBox, and it must still fit the same contract and test harness.

**Success.** Adding or removing the LibreNMS translator is done by adding or deleting its module file, with no core edits and no changes to the NetBox module; docs show one command per source; tests cover both happy-path fixtures and a payload that is missing links.

## [1.7.5 Additional translators](https://github.com/NetworkNerd1337/NerdGram1337/milestone/4)

Code name Navigator.

**Gated on 1.7.0.** This milestone exists only if 1.7.0 proves the modular translator system works. If 1.7.0 shows that system will not work, 1.7.5 is simply dropped from the roadmap. Nothing in 1.5.0 or 1.6.0 depends on it.

Each translator is one mapping module, added the same way LibreNMS was: one file, discovered automatically, no core edits. Every translator stays stateless, stores no credentials or tokens, and is fed only by exported payloads or files. NerdGram still does not log in, poll, or call out to these tools. 1.7.5-l is the paste-screen picker for those modules. It is not a new source.

The source notes below are a starting point. When each source issue is written, verify them against that tool's current documentation.

### 1.7.5-a Nautobot

A NetBox fork with a near-identical model. Likely a thin module, but treat it as its own source and confirm where the APIs still match.

**Success.** One module file converts a Nautobot export to canonical JSON that validates and upserts, with no core edits.

### 1.7.5-b SolarWinds Orion

Export nodes, interfaces, and topology connections via its query API (SWQL). Orion has its own Intelligent Maps / Network Atlas; the value here is still a text diagram in a repo, not a replacement for those maps.

**Success.** A saved SWQL or API export converts through one module, with no credentials stored.

### 1.7.5-c Observium

LibreNMS forked from Observium, but the APIs diverged, so Observium needs its own module rather than a flag on the LibreNMS mapper.

**Success.** One Observium module, with no changes to the LibreNMS file.

### 1.7.5-d Netdisco

CDP and LLDP topology from a Netdisco export.

**Success.** One module turns that topology into canonical links and devices, without inventing neighbors that are not in the file.

### 1.7.5-e Zabbix

Hosts, interfaces, and inventory via its API, from an exported payload or file.

**Success.** One module maps what the export actually contains; missing topology is a warning, not a guessed mesh.

### 1.7.5-f Cisco Catalyst Center

Formerly DNA Center. Topology API export, as a file or payload pushed into convert.

**Success.** One module, no stored Catalyst Center token, and no outbound call from NerdGram.

### 1.7.5-g Meraki Dashboard

Devices and LLDP/CDP topology from a Dashboard export.

**Success.** One module converts that export; NerdGram does not hold a Meraki API key.

### 1.7.5-h Cisco pyATS

Convert pyATS learn or testbed output into the canonical network JSON. This is just another data pipeline: a file or payload in, JSON out, stateless, with no credentials and no call out to devices. When the issue is written, verify the learn and testbed shapes against current pyATS docs.

**Success.** One module file converts a saved pyATS output to a document that validates and upserts, with no core edits.

### 1.7.5-i PRTG

Lower priority. Topology data is thinner, so this module may map a smaller subset and should say so in its docs.

**Success.** One module, honest about what PRTG can and cannot supply, still with no stored credentials.

### 1.7.5-j Terraform

Read Terraform state or plan JSON, the output of `terraform show -json`, and write canonical network JSON so NerdGram can draw a Mermaid diagram of what that Terraform describes. One mapping module in its own file. It is stateless, stores no credentials, makes no outbound calls, and makes no provider calls. NerdGram never runs Terraform. When the issue is written, verify the state and plan JSON shape against current Terraform docs.

**Success.** One module file converts a saved `terraform show -json` document to canonical JSON that validates and upserts, with no core edits and no call to Terraform or a provider.

### 1.7.5-k Batfish

Batfish parses the device configs. NerdGram never does. This translator reads exported Batfish or pybatfish question output as JSON and maps it to canonical network JSON. Examples are interface properties, IP ownership, VLAN and switched-VLAN properties, and layer-3 edges. One mapping module in its own file. It is stateless, stores no credentials, and makes no outbound calls. NerdGram does not run Batfish and does not bundle it.

Config-only output draws the routed (Layer 3) view well. Layer 1 and Layer 2 links are inferred or missing unless the user adds a `layer1_topology.json` to the Batfish snapshot, for example one generated from CDP or LLDP neighbor output upstream. The translator never invents a link. An inferred link is marked as inferred, for example drawn dashed. An unresolved neighbor is a placeholder node.

The translator docs include a recipe for building `layer1_topology.json` upstream and adding it to the snapshot before the questions are exported. NerdGram does not build that snapshot. When the issue is written, verify the question JSON shapes, and the `layer1_topology.json` name and location, against current Batfish and pybatfish docs.

**Success.** One module file converts a saved Batfish question export to canonical JSON that validates and upserts, with no core edits and no call out to Batfish. Tests cover a config-only export that draws the Layer 3 view, an export that includes layer-1 edges from `layer1_topology.json`, an inferred link that stays marked inferred, an unresolved neighbor drawn as a placeholder node, and a fixture that gains no link the file does not contain.

### 1.7.5-l Translator picker

`nerdgram convert` and `POST /api/v1/convert/<source>` stay the API and CLI path. This item puts that same path on the existing paste screen: `/generate`, opened from **From data** on the dashboard and from **Generate diagram from data** in the command palette. That screen already pastes or uploads a file. Reuse it. Do not add a top-level page, and do not add a nav entry. The current CSV, JSON, network JSON, CDP, and LLDP choices stay.

A translator picker lists the installed translator modules. The list is auto-discovered from the registry, so adding or removing a module updates the list with no UI edits. Picking a translator sets the input box's format hint and placeholder for that tool's data. Paste and file upload both call `POST /api/v1/convert/<source>`. The client has no translator logic. The preview shows mapper warnings before the diagram is saved. The screen stays stateless: no stored credentials, no outbound calls, still bound to `127.0.0.1` and `::1` unless Host is opened, and no auth.

#### Data-completeness notice

When a translator is selected on that paste screen, a soft info callout sits above the input. It has an info icon and a short title, and the body substitutes the translator's display name. It follows the Light and Dark Appearance themes, including when Appearance is **Match system**. **Don't show again** dismisses it for that translator and remembers the choice in `localStorage`. That dismissal is the only value the callout stores. **Translator tips** links to that translator's docs. The copy is fixed. `{Source}` is the translator's display name.

**Title.** Your diagram reflects your data

**Body.** NerdGram draws exactly what this {Source} export describes. Devices or links the source doesn't know about won't appear. For a fuller topology, enrich the data in {Source} first, for example by adding LLDP or CDP links to a Batfish snapshot.

**Actions.** Translator tips (links to the translator docs) · Don't show again

**Success.** The picker on `/generate` lists registry modules, and adding or deleting a module file changes that list with no client edit; paste and upload both call `POST /api/v1/convert/<source>`, and the preview shows mapper warnings before save; the callout uses the copy above, substitutes the display name, and stays dismissed for that translator after **Don't show again**, in both Light and Dark. Tests cover an added module, a removed module, paste, upload, a warning before save, the callout copy with the display name filled in, a per-translator `localStorage` dismissal, and both Appearance themes. The client stores no credentials and makes no outbound call.

## [1.8.0 Design exports](https://github.com/NetworkNerd1337/NerdGram1337/milestone/5)

Code name Meridian. 1.8.5 stays on Meridian.

Export a diagram, Mermaid plus its network JSON, to text files that outside test and lab tools can open. NerdGram never connects to devices, and it never stores credentials. Any password or token field in an exported file is a placeholder for the tool, or the operator, to fill in. The workflow assumption, especially for pyATS, is that the user makes sure the node names and IPs in the diagram match the real environment they test with.

Exporters should use the same one-file-per-target modular pattern that 1.7.0 proves for translators: one module, registered and discovered automatically, added or removed without core edits. A later 1.8.5 milestone expands the set only if this export architecture holds. Tool format notes below are a starting point; when each issue is written, verify them against that tool's current documentation.

**Batfish is a weak fit.** Batfish wants device configs, which NerdGram does not store and will not parse. It is not a 1.8.0 target. If someone wants a Batfish snapshot, they should collect configs with the tools that already do that, not from a diagram. This is the export direction only. The 1.7.5 Batfish translator still reads question JSON the operator already exported.

### 1.8.0-a Export framework plus pyATS testbed YAML

One PR, complete on its own: an export CLI and API that write a file from a diagram and its sibling network JSON, a shared exporter contract and test harness, and a pyATS testbed YAML module. The testbed should include devices, connections, links, and IPs, with credentials left as placeholders for pyATS to fill.

**Success.** The campus sample exports a testbed YAML that contains no secrets; `nerdgram` can write that file without a device connection; later targets can be discovered from a module file without a hard-coded core switch.

### 1.8.0-b containerlab topology YAML

A vendor-neutral containerlab topology file from the same diagram and network JSON.

**Success.** One module file, no core edits and no changes to the pyATS exporter; the output is a text topology the operator can open in containerlab. Verify the current containerlab topology schema when the issue is written.

### 1.8.0-c Cisco Modeling Labs lab YAML

A CML lab YAML from the same document.

**Success.** One module file, no core edits; credentials if the format requires them are placeholders only; NerdGram does not log in to CML. Verify the current CML lab format when the issue is written.

## [1.8.5 Additional exports](https://github.com/NetworkNerd1337/NerdGram1337/milestone/6)

Code name Meridian.

**Gated on 1.8.0.** This milestone exists only if 1.8.0 proves the modular export system works. If 1.8.0 shows that system will not work, 1.8.5 is simply dropped from the roadmap. It does not depend on 1.7.5, and nothing in 1.5.0 or 1.6.0 depends on it.

Each item is one export module, added the same way containerlab or CML was: one file, discovered automatically, no core edits. Every exporter writes a text file, stores no credentials, uses placeholders where a tool would expect a secret, and never connects to a device or a lab controller. When each issue is written, verify the target format against that tool's current documentation.

### 1.8.5-a Ansible inventory

An inventory file from the diagram's devices, groups, and addresses.

**Success.** One module, no stored Ansible secrets, honest about what a diagram can and cannot supply.

### 1.8.5-b Nornir inventory

A Nornir inventory from the same document.

**Success.** One module, no core edits and no changes to the Ansible exporter; credentials stay placeholders.

### 1.8.5-c GNS3 project

A GNS3 project or topology file the operator can open in GNS3.

**Success.** One module, no call out to a GNS3 server. Verify the current project format when the issue is written.

### 1.8.5-d EVE-NG lab

An EVE-NG lab file from the diagram.

**Success.** One module, no stored EVE-NG credentials and no connection to the emulator. Verify the current lab format when the issue is written.

## Later ideas

These are not scheduled and are not part of 1.5.0 through 1.8.5. They are suggestions.

- Once convert exists, a docs page of "produce this file" examples can also show NAPALM or Genie snippets as caller-side scripts, still not bundled, the same way [Generate from data](generate-from-data.md) already describes those tools today.
- A `convert --source auto` that detects NetBox vs LibreNMS vs canonical JSON would be useful, but it is not required for 1.7.0. Detection can wait until two mappers are solid.

## Future ideas (not committed)

These are possibilities being floated for after the planned milestones. They are not scheduled or promised, and they may never happen.

### Mobile companion app with GitHub sync

A separate mobile app, for a phone or a tablet, connects directly to a user's GitHub repository of Mermaid diagrams. It lets them view and lightly edit those diagrams there: code-first editing with a live preview, pinch zoom, and present. It works with diagrams made by NerdGram or by any other Mermaid editor.

GitHub is the sync layer. There is no NerdGram cloud service, no on-prem-to-mobile sync, and no change to NerdGram's local, `127.0.0.1`, no-auth model. The desktop app stays exactly as it is. A standalone mobile app without file sync would create drift between copies. GitHub already provides the shared copy.

This is only after the current roadmap is done and the product is mature.

## See also

- [Generate from data](generate-from-data.md)
- [Automation API](api.md)
- [Command-line tool](cli.md)
- [Security model](security.md)
- [Versioning and releases](releases.md)
