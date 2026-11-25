# nerdgram command

`nerdgram` is the command-line client for NerdGram1337.

[Back to the documentation index](README.md)

## Contents

- [Install](#install)
- [Use](#use)
- [One call builds the whole diagram](#one-call-builds-the-whole-diagram)
- [Command to route map](#command-to-route-map)
- [MCP](#mcp)
- [Continuous integration](#continuous-integration)

`nerdgram` is the command-line client for NerdGram1337. The npm package name is `nerdgram1337`. The command it installs is `nerdgram`. This page is the install and the commands you run against a server that is already up. `nerdgram` is the client for that API. It talks to a NerdGram server on this machine, or on another machine that can reach the tool port. `lint` and `render` of a `.mmd` file that is already on disk do not need the server. `convert` of a saved export does not need the server either. `generate` and `refresh` follow the [one-call model](api.md#one-call-builds-the-whole-diagram): each call sends the complete data, and the path is the id. Every command and the route it calls is in [Command to route map](#command-to-route-map).

## Install

Node.js 20 or newer, and npm 10 or newer.

```bash
npm install -g nerdgram1337
```

```bash
npx nerdgram1337 --help
```

`npm install -g` puts `nerdgram` on your `PATH`. `npx` runs the command without a global install. The package is public. If the shell cannot find it, open a new terminal. npm warns when its global bin directory is not on `PATH`. `npx` downloads the package and runs the command without a global install. Point `NERDGRAM_URL` at the running app. The default is `http://127.0.0.1:8787`, which is right when the app is on the same computer. Node.js 20 or newer and npm 10 or newer are the same versions [the app uses](install.md#nodejs).

**Do not run `npx nerdgram1337` inside a checkout of this repository.** The root `package.json` is also named `nerdgram1337` and has no `bin`. From that directory, npm stops with `could not determine executable to run`. Use `npm install -g` or `npx` from any other directory.

From a checkout, after `npm run build`, run the program from the repository root with `node server/dist/cli.js` in place of `nerdgram`. The `nerdgram` bin in `server/package.json` points at `server/dist/cli.js`, but `npm run install:all` does not link it, so `npm exec --prefix server -- nerdgram` does not print the command list. The shell reports `nerdgram: not found`.

```bash
node server/dist/cli.js --help
```

Inside the running container the image already puts `nerdgram` on `PATH`:

```bash
docker exec -e NERDGRAM_TOKEN=ng_your_token nerdgram1337 nerdgram list
```

The install downloads Mermaid and Puppeteer's chrome-headless-shell. Offline `lint` and `render` use them. Commands that only call the API do not launch the shell. That shell is the large part of the install. The linux/amd64 server image uses the same kind of shell. The linux/arm64 image uses Debian chromium. See [Install](install.md#docker).

npm 11 can print `puppeteer (postinstall) not yet covered by allowScripts` during `npm install -g nerdgram1337`. That warning means npm has not yet classified Puppeteer's install script. The Chrome download still runs. Offline PNG render still works after that install, including when `PUPPETEER_CACHE_DIR` was empty before the install and Chrome was downloaded into it. You do not need to set `ignore-scripts` or approve the script by hand for the render command to work.

The `cli/` directory is what gets published. Its `prepack` script bundles that program into `cli/dist` before `npm pack` or `npm publish`. The Docker image does not use the bundle. It puts `node /app/server/dist/cli.js` on `PATH` as `nerdgram`. The package readme that npm shows is [`cli/README.md`](../cli/README.md).

## Use

`NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is an automation token from Settings. `--url` and `--token` override those. `nerdgram --version` prints `nerdgram` and the version with its code name, such as `nerdgram v2.1.26 Azimuth`, then exits. `nerdgram doctor` prints the data-folder report for this computer. It exits 0 when that folder is fine, 1 for a warning, and 2 when the folder is not writable. An info note, such as a case-insensitive disk, prints as `Info:` and does not change that exit code. It does not take or refresh `.meta/instance-lock.json`. A server that is already running on this machine is not a second instance. Doctor asks that server for `GET /api/doctor` on `127.0.0.1` and the port stored in the lock when it can. If it cannot, the report says NerdGram is running, with the pid and the age of the heartbeat, and that line is not a warning. `--json` prints that report and nothing else. `--repair` quarantines bad settings and history files, restores fresh copies, removes old temp files, and runs migrations. It does not change diagrams. `--restore <ts>` copies that quarantine set back. Both refuse while a live server holds the lock. Stop the app first, or restore a quarantine set from Settings. `--url http://127.0.0.1:8787` reads `GET /api/doctor` from a running server instead of the local folder. `--json` prints one JSON object and nothing else. Success is `{"ok":true, ...}` with that command's fields, such as `path`, `hits`, `diagnostics`, `folders`, and `files`. Failure is `{"ok":false,"error","status"}` on stdout, and the process exits `1`. `status` is the HTTP status when the failure has one, such as `500` when a render's SVG would not parse. A failure with no HTTP status uses `"error"`.

`generate --format network` needs `--view l3` (subnets) or `--view l2` (VLANs, trunks, and LAGs). `--include-down` draws shutdown and down interfaces. `--vlan` is an integer from 1 to 4094 and keeps Layer 2 links that carry that VLAN. `--group-by` is `platform` or `capability` for CDP and LLDP, `vrf` for a Layer 3 network view, and `site`, `role`, or `platform` for a Layer 2 network view. `refresh` rejects `--view`. The view is already in the diagram. `render <file> --server` renders a workspace path such as `Sites/Campus.mmd`. A file on this computer is rendered without `--server`. Passing that file with `--server` says so, instead of `Not found`.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token

nerdgram list
nerdgram search Atlanta
nerdgram get Welcome.mmd -o Welcome.mmd
nerdgram put Notes.mmd ./Notes.mmd
nerdgram export Examples -o ./exported
nerdgram lint Welcome.mmd
nerdgram rename Notes.mmd Archive/Notes.mmd
nerdgram move Campus.mmd Sites
nerdgram duplicate Campus.mmd --copy-data
nerdgram duplicate Campus.mmd --share-data
nerdgram delete Notes.mmd --keep-data
nerdgram delete Notes.mmd --with-data
nerdgram repair-links
nerdgram repair-links --apply
nerdgram generate --path Campus.mmd --data docs/samples/campus-links.csv
nerdgram generate --path Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp --format cdp
nerdgram generate --path Core.mmd --data docs/samples/neighbors/cisco-ios-lldp.lldp --format lldp
nerdgram generate --path Edge.mmd --data docs/samples/neighbors/lldpd.json --format lldp --local-device edge
nerdgram generate --path Campus-L3.mmd --data docs/samples/network/campus.network.json --format network --view l3
nerdgram generate --path Campus-L2.mmd --data docs/samples/network/campus.network.json --format network --view l2 --group-by site
nerdgram convert netbox docs/samples/translators/netbox/campus.json -o campus.network.json
nerdgram convert librenms docs/samples/translators/librenms/campus.json -o campus.network.json
nerdgram refresh Campus.mmd
nerdgram diff Campus.mmd --from "Baseline - pre-change" --to current --format md
nerdgram diff Campus.mmd --from "Baseline - pre-change" --format svg -o campus-diff.svg
nerdgram baseline Campus.mmd --name "Baseline - pre-change"
nerdgram replace CORE-SW1 ATL-CORE-01 --folder Sites/ATL
nerdgram replace CORE-SW1 ATL-CORE-01 --yes
nerdgram replace CORE-SW1 ATL-CORE-01 --regex --yes
nerdgram replace --undo <id>
nerdgram render Welcome.mmd -o Welcome.svg
nerdgram render Welcome.mmd -o Welcome.png
```

`render` writes `.svg` or `.png`. Another extension stops with `The output file must end in .svg or .png.` `--server` posts that format to the API, which accepts `svg` or `png` only. `jpg` and `pdf` are browser exports. `render` and `lint` of a `.mmd` file on disk do not need a server. `convert` does not need a server. `--server` sends `render` to the API instead. A file with the line `%% nerdgram: warnings=muted`, after any YAML front matter, omits warnings from `lint`. Errors are still reported, and `--strict` still exits 1 for a warning on a diagram that is not muted. `nerdgram lint Welcome.mmd` is a workspace path: it needs a running server and `NERDGRAM_TOKEN` unless a file named `Welcome.mmd` is already in the current directory. In a checkout the sample is `diagrams/Welcome.mmd`, and `nerdgram lint diagrams/Welcome.mmd` (or `node server/dist/cli.js lint diagrams/Welcome.mmd` after `npm run build`) does not need a server. `lint` exits `1` when a diagnostic is an error. `--strict` also exits `1` for warnings.

`rename`, `move`, `duplicate`, and `delete` need the server and a read-write token. `rename` and `move` also move a sibling CSV, JSON, network JSON, CDP, or LLDP file and update `nerdgram.source`. `duplicate --copy-data` copies that file onto the new diagram. `duplicate --share-data` keeps both diagrams on the original file. `delete --with-data` moves the file to the trash with the diagram. `delete --keep-data` leaves it in the workspace. When a data file is present and the flag is omitted, `duplicate` and `delete` stop and list the file.

`nerdgram repair-links` prints the preview and writes nothing. `--dry-run` is the same. `--apply` saves the rewrites. A read token can run the preview. `--apply` needs a read-write token.

`nerdgram diff <path> --from <id|name|current> [--to <id|name|current>] [--format md|json|svg]` compares two revisions of one diagram, or a revision and the current file. `--to` defaults to `current`. `--from` and `--to` accept a revision id, a baseline name, or `current`. `--format md` prints a Markdown change summary. `--format json` prints the structured diff, including nodes and edges for a flowchart and a text diff for every diagram type. `--format svg` writes the read-only coloured picture and needs `-o file.svg`. A diagram that is not a flowchart has no picture; the command says to use `md` or `json`. The diagram file is not modified. A read token is enough.

`nerdgram baseline <path> --name "…" [--note "…"] [--id <revision>]` saves the current diagram as a named baseline. `--id` names an existing revision instead of snapshotting the current file. The name is kept when the 20-revision limit drops older saves. The command needs a read-write token. Removing a name is `DELETE /api/v1/history/baseline`.

`nerdgram replace <find> <replace> [--folder path] [--regex] [--whole-word] [--match-case] [--front-matter] [--no-recursive] [--dry-run] [--yes]` previews a replace across diagrams. The default prints the preview and writes nothing. `--dry-run` is that default. `--yes` applies the preview, skipping a diagram that would not parse, a diagram open in an editor, and a file that changed after the preview. Each saved diagram gets a revision first. `--folder` limits the scope. `--no-recursive` does not enter subfolders. The body is searched unless `--front-matter` is set. Hidden files, `.meta`, trash, and templates are not changed. `nerdgram replace --undo <id>` restores that operation and skips a file edited since. Preview is `POST /api/v1/replace/preview` and needs a read token. Apply is `POST /api/v1/replace/apply` and undo is `POST /api/v1/replace/undo`. Both need a read-write token. The same three paths exist under `/api`. Mutating calls need `Content-Type: application/json`.

The `generate` lines that pass `docs/samples` are run from the repository root, and they need the server and token. `convert` is run from the repository root when the sample path is `docs/samples`, and it does not need the server or a token. `export <target>` is the same: it reads a file on this computer and does not need the server. `export <folder>` still needs the server. Every command other than offline `lint`, `render`, `convert`, and design `export` needs the server and a token.

### Convert an export

`nerdgram convert <source> [file] [-o out.network.json]` reads a saved export and writes canonical network JSON. `<source>` is a translator id. `nerdgram convert` with no source prints the installed ids. Omit the file, or pass `-`, to read stdin. `-o` writes the document to that file. Without `-o`, the document is the only thing on stdout, so it can be piped. Warnings go to stderr. `--json` prints one object with `source`, `document`, and `warnings` when there is no `-o`. With `-o`, `--json` prints `source`, `output`, `warnings`, and `bytes`, and the file is the document. The file is valid network JSON. An unknown source, a file that is not JSON or YAML, and a file larger than 4 MiB exit 1. The API body stays JSON. YAML is for a file on disk, such as a testbed. The command does not log in and does not call out. The same mapping is `POST /api/v1/convert/<source>`. Field tables are in [Translators](translators.md).

```bash
nerdgram convert netbox docs/samples/translators/netbox/campus.json -o campus.network.json
nerdgram convert librenms docs/samples/translators/librenms/devices-only.json
nerdgram generate --path Campus-L3.mmd --data campus.network.json --format network --view l3
```

### Export a design

`nerdgram export <target> <diagram.mmd|file.network.json> [-o file]` writes a file for another tool. `<target>` is an exporter id. `nerdgram export` with no arguments prints both usage forms and the installed ids. A diagram needs a sibling `.network.json`. `-o` writes the file. Several files, such as a Nornir inventory, need `-o` to be a directory. Without `-o`, one file is the only thing on stdout. Warnings go to stderr. `--map file.yml` overrides the built-in mapping table. The command does not log in. `nerdgram export <folder> -o dir/` is still the folder export and still needs the server. Field tables are in [Design exports](exports.md).

```bash
nerdgram export pyats docs/samples/network/campus.network.json -o campus.yml
nerdgram export containerlab docs/samples/network/campus.network.json -o campus.clab.yml
```

### One call builds the whole diagram

`nerdgram generate` and `nerdgram refresh` do not build a diagram up across several calls. Each call sends the complete data, and the server builds the complete generated diagram from that call. A later call on the same path replaces the generated block. It does not add to it. `POST /api/v1/generate/refresh` rewrites only the lines between `%% nerdgram:generated` and `%% nerdgram:generated end`. A device or link left out of the new data drops off the diagram. Notes, styling, and hand-added nodes outside those markers stay. The workspace path, such as `Network/Core.mmd`, is the id the refresh uses. Paste every device's CDP or LLDP output into one file, one after another, and pass that file to `--data`. The previous diagram is saved as a revision when the refresh is written, so `nerdgram diff` and baselines can compare old against new.

```bash
nerdgram generate --path Network/Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp --format cdp
nerdgram refresh Network/Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp
```

`generate` is `POST /api/v1/generate/upsert`. The first run creates the diagram. The next run of the same path updates the generated block and the data file beside it. Notes outside the generated markers stay. `--create-only` is `POST /api/v1/generate` and returns **409** when the path already exists. `refresh` is `POST /api/v1/generate/refresh` with `save: true`, and with `writeData: true` when `--data` is set. `format` on refresh comes from the diagram, so the new file has to match the format `generate` stored. CDP and LLDP use `--format cdp` or `--format lldp`, `--group-by platform|capability`, and `--local-device` when the paste has no prompt. A Cisco routing table uses `--format route`. ARP and MAC tables use `--format arpmac`. `--hosts` is `ports`, `port-counts`, or `vlan-counts` for either. `--local-device` names a paste that has no prompt. The paste is still at most 4 MiB. Network JSON uses `--format network` and `--view l3` or `--view l2`. `--include-down` draws shutdown and down interfaces. `--vlan` keeps Layer 2 links that carry that VLAN. `--group-by` is `vrf` for Layer 3, or `site`, `role`, or `platform` for Layer 2. Refresh does not take `--view`. The view and the options are already in the diagram. The same HTTP calls are in [One call builds the whole diagram](api.md#one-call-builds-the-whole-diagram). The format is described in [Layer 3 and Layer 2 from network data](generate-from-data.md#network-data-json).

The default URL is loopback. Point `NERDGRAM_URL` at another machine only when that machine's Host setting or `HOST` is already open to you. The browser `/api` routes have no token. Anyone who can reach the port can use them. A token covers `/api/v1` only.

### Command to route map

Every `nerdgram` command is listed with the `/api/v1` route it calls. `none` means the route has no command. Offline `lint` and `render` of a `.mmd` file on disk do not call the API. Offline `convert` does not call the API. `lint` of a workspace path uses the GET route. `render --server` uses the POST route.

<!-- cli-route-map -->
| Command | Route |
| --- | --- |
| none | `GET /api/v1/openapi.json` |
| none | `GET /api/v1/schema/network.json` |
| none | `GET /api/v1/schema/graph.json` |
| `nerdgram list` | `GET /api/v1/diagrams` |
| `nerdgram search` | `GET /api/v1/search` |
| `nerdgram get` | `GET /api/v1/diagrams/content` |
| none | `POST /api/v1/diagrams` |
| `nerdgram put` | `PUT /api/v1/diagrams` |
| `nerdgram rename` | `POST /api/v1/diagrams/rename` |
| `nerdgram move` | `POST /api/v1/diagrams/move` |
| `nerdgram duplicate` | `POST /api/v1/diagrams/duplicate` |
| `nerdgram delete` | `DELETE /api/v1/diagrams` |
| none | `POST /api/v1/folders` |
| `nerdgram export` | `GET /api/v1/export` |
| `nerdgram export <target>` | none |
| none | `GET /api/v1/exporters` |
| none | `POST /api/v1/export/{target}` |
| `nerdgram repair-links` | `GET /api/v1/link-repairs` |
| `nerdgram repair-links --apply` | `POST /api/v1/link-repairs` |
| `nerdgram lint` | `GET /api/v1/lint` |
| none | `POST /api/v1/lint` |
| none | `GET /api/v1/render` |
| `nerdgram render --server` | `POST /api/v1/render` |
| none | `POST /api/v1/generate/preview` |
| `nerdgram generate` | `POST /api/v1/generate/upsert` |
| `nerdgram generate --create-only` | `POST /api/v1/generate` |
| `nerdgram refresh` | `POST /api/v1/generate/refresh` |
| `nerdgram convert` | none |
| none | `GET /api/v1/translators` |
| none | `POST /api/v1/convert/{source}` |
| none | `GET /api/v1/history` |
| `nerdgram diff` | `GET /api/v1/history/diff` |
| `nerdgram baseline` | `POST /api/v1/history/baseline` |
| none | `PATCH /api/v1/history/baseline` |
| none | `DELETE /api/v1/history/baseline` |
| `nerdgram replace` | `POST /api/v1/replace/preview` |
| `nerdgram replace --yes` | `POST /api/v1/replace/apply` |
| `nerdgram replace --undo` | `POST /api/v1/replace/undo` |
| `nerdgram template` | local `<data>/.templates` |
| `nerdgram mcp` | stdio proxy. Each tool calls `/api/v1`. See [MCP](mcp.md). |
| `nerdgram doctor` | none |
<!-- /cli-route-map -->

`nerdgram put` sends `force: true`, so it is the overwrite route, not `POST /api/v1/diagrams`. That POST creates a file and fails when the path exists. There is no `nerdgram` command for it, for folders, for linting unsaved source, for `GET /api/v1/render`, for generate preview, for listing history, or for renaming or deleting a baseline. Those are in the endpoint table in [Automation API](api.md).

## MCP

`nerdgram mcp` speaks MCP on stdin and stdout. It is a proxy to `/api/v1` on a NerdGram that is already running. `NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is required. `--url` and `--token` override those. Do not pass `--json`. stdout is the protocol, and log lines go to stderr.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token
nerdgram mcp
```

```bash
docker exec -i -e NERDGRAM_TOKEN=ng_your_token nerdgram1337 nerdgram mcp
```

The tools, the `/mcp` HTTP transport, and NetClaw setup are in [MCP server](mcp.md).

## Continuous integration

A CI job can render every diagram in the repo without a token, because that path is offline. From a checkout the command is `node server/dist/cli.js`, after `npm run build`:

```yaml
name: diagrams
on: [push]
jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci --prefix server
      - run: npm run build --prefix server
      - name: Render
        run: |
          mkdir -p out
          find diagrams -name '*.mmd' -print0 | while IFS= read -r -d '' file; do
            node server/dist/cli.js render "$file" -o "out/$(basename "$file" .mmd).svg"
          done
```

To render from a running server instead, create a read token, store it as a secret, and set `NERDGRAM_URL` and `NERDGRAM_TOKEN`.

## See also

- [Automation API](api.md)
- [MCP server](mcp.md)
- [Generate from data](generate-from-data.md)
- [Install](install.md)
