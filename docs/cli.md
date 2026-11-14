# nerdgram command

`nerdgram` is the command-line client for NerdGram1337. The npm package name is `nerdgram1337`. The command it installs is `nerdgram`. The app README section [Command-line tool](../README.md#command-line-tool) is the full description. This page is the install and the commands you run against a server that is already up.

## Install

Node.js 20 or newer, and npm 10 or newer.

```bash
npm install -g nerdgram1337
```

```bash
npx nerdgram1337 --help
```

`npm install -g` puts `nerdgram` on your `PATH`. `npx` runs the command without a global install. The package is public.

**Do not run `npx nerdgram1337` inside a checkout of this repository.** The root `package.json` is also named `nerdgram1337` and has no `bin`. From that directory, npm stops with `could not determine executable to run`. Use `npm install -g` or `npx` from any other directory.

From a checkout, after `npm run build`, run the program from the repository root with `node server/dist/cli.js` in place of `nerdgram`. `npm run install:all` does not link the server package's `nerdgram` bin, so `npm exec --prefix server -- nerdgram` does not print the command list. The shell reports `nerdgram: not found`.

```bash
node server/dist/cli.js --help
```

Inside the running container the image already puts `nerdgram` on `PATH`:

```bash
docker exec -e NERDGRAM_TOKEN=ng_your_token nerdgram1337 nerdgram list
```

The install downloads Mermaid and Puppeteer's chrome-headless-shell. Offline `lint` and `render` use them. Commands that only call the API do not launch the shell.

## Use

`NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is an automation token from Settings. `--url` and `--token` override those. `--json` prints one JSON object. The process exits `1` when the command fails.

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
nerdgram refresh Campus.mmd
nerdgram render Welcome.mmd -o Welcome.svg
nerdgram render Welcome.mmd -o Welcome.png
```

`render` and `lint` of a `.mmd` file on disk do not need a server. `--server` sends `render` to the API instead. `nerdgram lint Welcome.mmd` is a workspace path: it needs a running server and `NERDGRAM_TOKEN` unless a file named `Welcome.mmd` is already in the current directory. In a checkout the sample is `diagrams/Welcome.mmd`, and `nerdgram lint diagrams/Welcome.mmd` (or `node server/dist/cli.js lint diagrams/Welcome.mmd` after `npm run build`) does not need a server. `lint` exits `1` when a diagnostic is an error. `--strict` also exits `1` for warnings.

`rename`, `move`, `duplicate`, and `delete` need the server and a read-write token. `rename` and `move` also move a sibling CSV, JSON, CDP, or LLDP file and update `nerdgram.source`. `duplicate --copy-data` copies that file onto the new diagram. `duplicate --share-data` keeps both diagrams on the original file. `delete --with-data` moves the file to the trash with the diagram. `delete --keep-data` leaves it in the workspace. When a data file is present and the flag is omitted, `duplicate` and `delete` stop and list the file.

`nerdgram repair-links` prints the preview and writes nothing. `--dry-run` is the same. `--apply` saves the rewrites. A read token can run the preview. `--apply` needs a read-write token.

The `generate` lines that pass `docs/samples` are run from the repository root, and they need the server and token. Every command other than offline `lint` and `render` needs the server and a token.

Keep the server on loopback. A token does not make it safe to publish port 8787.

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
