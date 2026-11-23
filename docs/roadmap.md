# Roadmap

Planned work from 2.5.0 through 3.0.0. This is a plan, not a commitment. Scope and order can change.

[Back to the documentation index](README.md)

## Contents

- [Where we are](#where-we-are)
- [Releases and support](#releases-and-support)
- [Milestones](#milestones)
- [2.5.0 Crossstaff](#250-crossstaff)
- [2.5.5 Theodolite](#255-theodolite)
- [Later milestones](#later-milestones)
- [Future ideas (not committed)](#future-ideas-not-committed)

## Where we are

The current release is 2.1.20, code name Azimuth. Shipped work stays in the changelog and on the [releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases). The next planned line starts at 2.5.0.

NerdGram stays a local, on-demand, code-first diagram tool. It does not discover the network, poll devices, or store device credentials. How data gets into a diagram today is [Generate from data](generate-from-data.md) and [Translators](translators.md).

## Releases and support

Ryan calls a milestone release. Until that call, changes start as issues, fold into pull requests, and merge to `main` after testing. Those changes stay under `## Unreleased`. The version, the code name, the git tag, npm, and the container image move only at a milestone. That path is the [release policy](releases.md#release-policy).

Support covers the life of a major.minor line. When a milestone is published, the previous release is deprecated that day and keeps a 30-day grace period. The table and the wording are under [Supported versions](releases.md#supported-versions). How to move an install is in [Upgrading](upgrading.md).

The code names below are the names planned for those milestones. They are not in the `codenames` map until that milestone is cut. The map, and the names already shipped, are in [Version numbers and code names](releases.md#version-numbers-and-code-names).

## Milestones

| Version | Code name | Planned features |
| --- | --- | --- |
| 2.5.0 | Crossstaff | Layered views. Path tracing. |
| 2.5.5 | Theodolite | Better sharing. Multi-language support. |
| 2.6.0 | Astrolabe | Features to be determined. |
| 2.6.5 | Quadrant | Features to be determined. |
| 2.7.0 | Octant | Features to be determined. |
| 2.7.5 | Chronometer | Features to be determined. |
| 2.8.0 | Latitude | Features to be determined. |
| 2.8.5 | Longitude | Features to be determined. |
| 2.9.0 | Equator | Features to be determined. |
| 2.9.5 | Sextant | Features to be determined. |
| 3.0.0 | Horizon | Features to be determined. |

## 2.5.0 Crossstaff

Two features are planned. Neither is a commitment, and either can move or shrink.

### Layered views

One diagram can switch between Layer 2, Layer 3, VLAN, VRF, and site views. Tags filter the topology, so the same diagram shows the slice you asked for.

### Path tracing

Pick a source and a destination. The diagram highlights the path, using routing and ARP data that has already been imported.

## 2.5.5 Theodolite

Two features are planned. Neither is a commitment, and either can move or shrink.

### Better sharing

A read-only static HTML export, or a single-file viewer, that you can send to someone who does not have NerdGram installed.

### Multi-language support

- **App interface.** Menus, Settings, dialogs, and messages come from language files bundled with the app, and a language picker chooses among them. This works fully offline. There is no third-party translation service, and no network call by default.
- **Diagram text.** Labels and descriptions in a diagram, including front matter, can be stored per language, or the diagram can switch its display language. Mermaid syntax is never changed.
- **Identifiers stay as written.** Hostnames, IP addresses, interface names, and VLAN IDs are never translated automatically.
- **Machine translation is opt-in.** It goes through the person's own tools, for example the existing MCP server with their own AI. NerdGram stays local-first and does not store those credentials.

## Later milestones

2.6.0 Astrolabe, 2.6.5 Quadrant, 2.7.0 Octant, 2.7.5 Chronometer, 2.8.0 Latitude, 2.8.5 Longitude, 2.9.0 Equator, 2.9.5 Sextant, and 3.0.0 Horizon do not have features yet. They will be planned later. This page does not invent them.

## Future ideas (not committed)

These are possibilities after the milestones above, or beside them if a later plan picks one up. They are unscheduled and unpromised. Each one stays local: no discovery, no polling, no stored device credentials, and no login to a device.

### Network snapshot diff for change windows

Compare two canonical network JSON documents by their fields. Report devices, interfaces, links, VLANs, and subnets that were added, removed, or changed. This is not a diff of the Mermaid text. A Markdown or JSON report can go in a change ticket, and an optional overlay can use the compare colours from [History](features.md#trash-and-history). NerdGram does not collect the two files. The person exports before and after, and the command reads those local files.

### Failure what-if

In the preview, mark one or more devices or links as failed. Show which devices, subnets, and VLANs can no longer reach the rest of the topology, and list the impact in words. The same check can name single points of failure. This is graph math on the links already in the file. It is not a routing simulation, and it writes nothing unless the person exports the picture.

### Design rules as code

An optional rules file next to the diagrams states design intent. A check compares canonical network JSON with that file, and a non-zero exit code can fail a Git hook or a CI job. Examples are two uplinks from an access role to a distribution role, matching trunk VLANs, no duplicate addresses, and a site and management address on every device. Each rule kind is one module. There is no general-purpose policy language. This idea waits until snapshot diff and failure what-if prove useful.

### Bring your own output

NerdGram parses device output that the person's own tooling already collected. A watched folder or an API receives that output and uses it for drift detection. NerdGram will not store device credentials or log into devices. That is a non-goal.

### Produce-this-file examples

A docs page that shows how to build the file `nerdgram convert` reads, including caller-side NAPALM or Genie scripts. Those scripts are not bundled, and NerdGram does not run them. [Generate from data](generate-from-data.md) already names those tools.

### Auto-detect the translator

`nerdgram convert --source auto` reads a file, detects which installed translator it came from, and runs that translator. A file that matches none of them is reported, and nothing is added. Detection reads the local file. It does not call the source tool.

### Mobile companion app

A separate phone or tablet app reads a GitHub repository of Mermaid diagrams and can view and lightly edit them, with a live preview, pinch zoom, and present. GitHub is the shared copy. There is no NerdGram cloud, and the desktop app stays local. This comes only after the planned milestones are done and the product is mature.

### Considered and left out

- Cloud storage connectors are not added.
- Routing, traffic, and convergence simulation are not added. Failure what-if, if it is built, stays graph math on the links already in the file.
- A general-purpose policy or query language is not added. Design rules, if they are built, stay a small closed set.
