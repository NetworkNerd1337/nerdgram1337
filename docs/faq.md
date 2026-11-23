# FAQ

Short answers to the questions that come up first, with a link to the page that has the detail.

[Back to the documentation index](README.md)

## Contents

- [What is NerdGram?](#what-is-nerdgram)
- [Does my data leave this machine?](#does-my-data-leave-this-machine)
- [Can I use another port or host?](#can-i-use-another-port-or-host)
- [Docker or npm, and how do I upgrade?](#docker-or-npm-and-how-do-i-upgrade)
- [Where are my files stored?](#where-are-my-files-stored)
- [How do I feed it from other tools?](#how-do-i-feed-it-from-other-tools)
- [Why is a lab export disabled?](#why-is-a-lab-export-disabled)
- [Will a refresh overwrite hand edits?](#will-a-refresh-overwrite-hand-edits)
- [How does GitHub sync work?](#how-does-github-sync-work)
- [Can a team share it?](#can-a-team-share-it)
- [Is there a mobile app?](#is-there-a-mobile-app)
- [Where do I ask a question or report a problem?](#where-do-i-ask-a-question-or-report-a-problem)

## What is NerdGram?

NerdGram is a local, code-first app for network diagrams in [Mermaid](https://mermaid.js.org/). You edit a `.mmd` file, preview it, and keep that file. It is not a drawing canvas like draw.io or Visio. The picture comes from the text. See [Features](features.md).

## Does my data leave this machine?

No, unless you turn on GitHub sync. There is no account and no hosted service. The app does not need the internet to edit, preview, or export. An update check is the call that reaches GitHub, and only when you use it. See [Security model](security.md).

## Can I use another port or host?

Yes. `PORT` changes the port. Leave `HOST` unset to keep the bind on `127.0.0.1` and `::1`. The Host check still applies: a request whose Host header is not allowed is **403**. The schema `$id` the server returns uses the host and port of that request. The copy in the repository keeps the default port 8787. See [Configuration](configuration.md) and [Security model](security.md).

## Docker or npm, and how do I upgrade?

Docker is the install to use when you want the app. npm installs the `nerdgram` command. Node.js from a clone is a full install and is also how you develop. Use one of them at a time. The 2.1 line is supported until the next minor or major release. Only the newest patch is published. Upgrade with `npm i -g nerdgram1337@latest`, or pull `ghcr.io/networknerd1337/nerdgram1337:latest`. The previous release stays published for 30 days after it is deprecated, then it is removed. Older npm versions are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Upgrade steps are in [Install](install.md) and [Upgrading](upgrading.md).

## Where are my files stored?

Diagrams are `.mmd` files in the data directory. By default that is `diagrams/` inside the project. Docker uses the `nerdgram-data` volume. Copy that directory, including the hidden `.meta` folder, to back it up. See [Data and backups](data-and-backups.md).

## How do I feed it from other tools?

You produce the file. **From data** accepts CSV, JSON, network JSON, and CDP or LLDP text. NerdGram does not call NetBox, LibreNMS, or pyATS, and it does not ship those tools. A script or cron job can POST the JSON you already have. See [Generate from data](generate-from-data.md).

## Why is a lab export disabled?

**Export as** lists **Lab and automation** for every installed exporter. The entries are disabled when the open diagram has no sibling `.network.json`. A line under the menu says to generate the diagram from data. That link opens **From data** at `/generate` and does not discard unsaved edits. A diagram that has network JSON keeps the entries enabled. See [Design exports](exports.md).

## Will a refresh overwrite hand edits?

No. Generated lines sit between `%% nerdgram:generated` and `%% nerdgram:generated end`. Refresh rewrites that block. Notes, the theme, and anything outside the markers stay, including a node you added by hand. See [Generate from data](generate-from-data.md).

## How does GitHub sync work?

Sync is optional. It copies diagrams to a private repository you own. It uses an OAuth token you create. It does not copy `.meta`, tokens, or the trash. See [GitHub sync](github-sync.md).

## Can a team share it?

There are no accounts and no roles. Two or three people can still share a folder or one process on a network they trust. See [Team use](team-use.md).

## Is there a mobile app?

Not yet. A narrow window stacks the editor panes and hides the dividers. **Present** fills the window. See [Preview](features.md#preview) and [Presentation](features.md#presentation).

## Where do I ask a question or report a problem?

Questions and ideas go to [Discussions](https://github.com/NetworkNerd1337/NerdGram1337/discussions). A bug or a feature request uses the forms on the issue page. A vulnerability goes through the [security policy](../SECURITY.md), not a public issue.

## See also

- [Install](install.md)
- [Security model](security.md)
- [Generate from data](generate-from-data.md)
- [Design exports](exports.md)
- [Team use](team-use.md)
