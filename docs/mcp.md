# MCP server

An MCP client can list, read, lint, render, create, and update diagrams through NerdGram.

[Back to the documentation index](README.md)

## Contents

- [What it is](#what-it-is)
- [Transports](#transports)
- [Tokens](#tokens)
- [NetClaw](#netclaw)
- [Tools](#tools)
- [Resources and prompts](#resources-and-prompts)
- [Security](#security)

## What it is

`/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on the same port as the app, normally `8787`. It calls the same diagram services as [`/api/v1`](api.md). It does not keep a second copy of the files, and it does not call the browser routes under `/api`.

Writes go through the same save path as the API. A change keeps a revision, respects an editor lock, and repairs click links on rename and move. The MCP server does not write a `.mmd` file on its own.

NetClaw is one client. Any MCP client that speaks streamable HTTP, or stdio, can use the same tools.

## Transports

### Streamable HTTP

The app serves streamable HTTP at `/mcp`. That is the current MCP transport. The older SSE transport is not served. Point the client at `http://127.0.0.1:8787/mcp` and send the automation token in `Authorization`.

```bash
netclaw mcp add --transport http nerdgram http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer ng_your_token"
```

`--header` stores the token in NetClaw's encrypted secrets. It is not written into `netclaw.json`.

### stdio

`nerdgram mcp` speaks MCP on stdin and stdout. It is a proxy to a NerdGram that is already running. `NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is required. `--url` and `--token` override those. stdout is the protocol. Do not pass `--json`.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token
nerdgram mcp
```

NetClaw defaults to stdio:

```bash
netclaw mcp add --transport stdio \
  --env NERDGRAM_URL=http://127.0.0.1:8787 \
  --env NERDGRAM_TOKEN=ng_your_token \
  nerdgram -- nerdgram mcp
```

That example needs a `nerdgram` command on the host. A Docker install can run the command that is already in the container:

```bash
netclaw mcp add --transport stdio nerdgram -- docker exec -i \
  -e NERDGRAM_URL=http://127.0.0.1:8787 \
  -e NERDGRAM_TOKEN=ng_your_token \
  nerdgram1337 nerdgram mcp
```

`NERDGRAM_TOKEN` is passed through to the container. It is visible to local processes in the process list. The HTTP example above stores the token in NetClaw's encrypted secrets instead.

Inside the running container:

```bash
docker exec -i -e NERDGRAM_TOKEN=ng_your_token nerdgram1337 nerdgram mcp
```

The container reaches the app at `http://127.0.0.1:8787`, which is the default.

## Tokens

Create the token under **Automation tokens** on the settings page. It is shown once. The server stores a SHA-256 hash in `<data>/.meta/api-tokens.json` and does not store the token again for MCP.

A **read** token can list, search, get, export, lint, render, and read history. A **read-write** token can also create, overwrite, rename, move, duplicate, trash, generate, refresh, replace, and save a baseline. `tools/list` returns only the tools that token can call. A read token that calls a write tool is refused.

Use a read-write token when the client should create and update diagrams. Use a read token when it should only look.

## NetClaw

Run `netclaw init` and choose the Personal posture before you add this server. Personal can see every MCP server. Team and Public start with an empty grant list.

NetClaw may warn that the server exposes N tool(s) not granted to any audience. Personal allows every tool. That warning is expected.

After the server is connected:

```bash
netclaw mcp list
```

`connected` and a tool count means the handshake worked. The same row appears in `netclaw status` as `mcp:nerdgram`.

Personal allows every tool and runs them without asking. To keep create and update free, and to ask before trash or a bulk replace, set tool overrides. The key is `server/tool`:

```json
{
  "Tools": {
    "AudienceProfiles": {
      "Personal": {
        "ApprovalPolicy": {
          "ToolOverrides": {
            "nerdgram/nerdgram_trash": "Approval",
            "nerdgram/nerdgram_replace_apply": "Approval"
          }
        }
      }
    }
  }
}
```

`netclaw mcp permissions` edits the same grants. A key with a colon is ignored. `nerdgram/nerdgram_put` is also marked destructive, so add it to `ToolOverrides` when an overwrite should ask first.

Prompts from this server show up as skills named `mcp__nerdgram__diagram_from_lldp` and `mcp__nerdgram__lint_and_fix`. `netclaw skill list` needs the daemon running to show them.

## Tools

Every tool name starts with `nerdgram_`. A path is a workspace path such as `Sites/Campus.mmd`. It stays inside the data directory. Hidden paths and `.meta` are rejected. Diagram files end in `.mmd`.

Lint with `nerdgram_lint` before `nerdgram_create` or `nerdgram_put`. `content` is Mermaid source. `nerdgram_create` fails when the path exists. `nerdgram_put` overwrites. Pass `expectedHash` from `nerdgram_get`. A hash that does not match is a conflict and the file is left as it was. Omitting `expectedHash` overwrites the current file. The previous text is a revision.

`nerdgram_generate`, `nerdgram_upsert`, and `nerdgram_refresh` take raw data in `data`. That is CSV, JSON, Cisco CDP, LLDP, or network JSON text, not a path on the client's disk. `format` is `csv`, `json`, `cdp`, `lldp`, `route`, `arpmac`, or `network`. `route` is Cisco `show ip route` text. `arpmac` is `show ip arp` or `show arp` plus `show mac address-table`. `hosts` is `ports`, `port-counts`, or `vlan-counts` for `route` and `arpmac`. `view` is `l3` or `l2` and is required for `network`. Generate fails when the path exists. Upsert creates the diagram or updates the generated block and the data file beside it. Notes outside the generated markers stay. Refresh uses the format and view already stored in the diagram. It does not take a new view.

`nerdgram_render` with `format` `svg` returns SVG text. `format` `png` writes a PNG file and returns that path and a resource link. It does not return a base64 image. On `/mcp` the file is on the machine running NerdGram. With `nerdgram mcp` the file is on the machine running the command. Render is limited to 30 calls a minute for each token, the same limit as `POST /api/v1/render`.

`nerdgram_duplicate` copies to `Name (copy)` when `to` is omitted, then `Name (copy 2)`. `to` is an optional workspace path for the copy. A path that already exists is a conflict and nothing is written.

`nerdgram_replace_preview` writes nothing. `nerdgram_replace_apply` saves each selected diagram, so the previous text is a revision. `nerdgram_trash` moves a diagram to the trash.

`nerdgram_history` lists revisions. Each one includes `instanceName`, the configured instance name that saved it, or null when none was set.

| Tool | Token | Annotation |
| --- | --- | --- |
| `nerdgram_list` | read | `readOnlyHint` |
| `nerdgram_search` | read | `readOnlyHint` |
| `nerdgram_get` | read | `readOnlyHint` |
| `nerdgram_export` | read | `readOnlyHint` |
| `nerdgram_lint` | read | `readOnlyHint` |
| `nerdgram_render` | read | `readOnlyHint` |
| `nerdgram_history` | read | `readOnlyHint` |
| `nerdgram_diff` | read | `readOnlyHint` |
| `nerdgram_create` | read-write | |
| `nerdgram_put` | read-write | `destructiveHint` |
| `nerdgram_mkdir` | read-write | |
| `nerdgram_rename` | read-write | |
| `nerdgram_move` | read-write | |
| `nerdgram_duplicate` | read-write | |
| `nerdgram_trash` | read-write | `destructiveHint` |
| `nerdgram_generate` | read-write | |
| `nerdgram_upsert` | read-write | |
| `nerdgram_refresh` | read-write | |
| `nerdgram_replace_preview` | read-write | `readOnlyHint` |
| `nerdgram_replace_apply` | read-write | `destructiveHint` |
| `nerdgram_baseline` | read-write | |

`readOnlyHint` means the tool does not change a diagram. `destructiveHint` means a client should be able to ask before it runs. The other write tools are not marked destructive. `openWorldHint` is false on every tool. None of them call out to the network.

Exporters, translators, and baseline rename or delete are not tools.

## Resources and prompts

A saved diagram can be read as the resource `nerdgram://diagram/<path>`. The body is the Mermaid source.

Two prompts are registered. `diagram_from_lldp` takes `path`, `text`, and an optional `local_device`, and tells the client to call `nerdgram_upsert` with the raw LLDP text. `lint_and_fix` takes `path` and tells the client to lint, edit, lint the edit, and save with `expectedHash`.

## Security

`/mcp` requires `Authorization: Bearer <token>`. A missing or unknown token is **401**. The browser routes under `/api` stay open on the machine and are not a fallback for a failed MCP call. Any local process can `POST /api/tokens` and create a read-write automation token. A token stops other machines and web pages. It does not stop software that is already running as you on this computer. See [Security model](security.md).

The `Host` header has to be loopback: `localhost`, `127.0.0.1`, another `127.x.x.x` address, or `::1`. A `Host` that `/api` allows through `NERDGRAM_ALLOWED_HOSTS` is still rejected on `/mcp`. A missing `Origin` is allowed, which is what curl and NetClaw send. An `Origin` that is present has to be loopback too. Anything else is **403**.

The listen address is unchanged. The host default is `127.0.0.1` and `::1`. Docker still publishes `127.0.0.1:8787:8787`. MCP stores no new credential. The only secret is the automation token you already created, and only its hash is on disk. The server does not call out.

## See also

- [Automation API](api.md)
- [Command-line tool](cli.md)
- [Security model](security.md)
- [NetClaw MCP servers](https://netclaw.dev/configuration/mcp-servers/)
