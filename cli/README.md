# nerdgram1337

`nerdgram` is the command-line client for [NerdGram1337](https://github.com/NetworkNerd1337/NerdGram1337), a local app for [Mermaid](https://mermaid.js.org/) diagrams. The npm package name is `nerdgram1337`. The command it installs is `nerdgram`.

List, search, and edit diagrams on a NerdGram server that is already running. `lint` and `render` of a `.mmd` file that is already on disk do not need the server. `convert` of a saved export does not need the server.

## Install

Node.js 20 or newer, and npm 10 or newer.

```bash
npm install -g nerdgram1337
```

```bash
npx nerdgram1337 --help
```

npm publishing is temporarily paused. Those commands still install the last version published to npm. A newer release is the Docker image `ghcr.io/networknerd1337/nerdgram1337` or a checkout of the tag.

`npm install -g` puts `nerdgram` on your `PATH`. `npx` runs that command without a global install. The package is public.

The install also downloads Mermaid and Puppeteer's chrome-headless-shell. Offline `lint` uses Mermaid's parser. Offline `render` uses that shell, which is the large part of the download. Commands that only call the API do not launch it.

## Use

`NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is an automation token from Settings in the app. `--url` and `--token` override those. `--json` prints one JSON object. The process exits `1` when the command fails.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token

nerdgram --help
nerdgram list
nerdgram mcp
nerdgram search Atlanta
nerdgram get Welcome.mmd -o Welcome.mmd
nerdgram put Notes.mmd ./Notes.mmd
nerdgram lint Welcome.mmd
nerdgram convert netbox export.json -o campus.network.json
nerdgram diff Welcome.mmd --from current --to current --format md
nerdgram baseline Welcome.mmd --name "Baseline"
nerdgram replace CORE-SW1 ATL-CORE-01 --dry-run
nerdgram replace CORE-SW1 ATL-CORE-01 --yes
nerdgram render Welcome.mmd -o Welcome.svg
```

`render` of a local `.mmd` file does not need a server. `--server` sends it to the API instead. `lint` of a local file does not need a server either. `lint` exits `1` when a diagnostic is an error.

The app still has to be reachable for every other command. NerdGram is a single-user app. The API is a tool port for programs you trust, not an always-on multi-user server. The browser routes have no token, so anyone who can reach the port can use them. The default URL is loopback. Point `NERDGRAM_URL` at another machine only when that machine has opened its Host setting to you.

The full command list is in the [command-line tool](https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/cli.md) page. Release notes are in the [changelog](https://github.com/NetworkNerd1337/NerdGram1337/blob/main/CHANGELOG.md).

## License

MIT © Ryan Thomas Huff
