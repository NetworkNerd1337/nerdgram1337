# Automation API

`/api/v1` is for scripts, CI, and other tools.

[Back to the documentation index](README.md)

Paths in this document use two placeholders, always in code formatting so GitHub does not treat the angle brackets as HTML tags. `<data>` is the data directory: `NERDGRAM_DATA_DIR` when that variable is set, and `diagrams/` inside the project when it is not. `<repo>` is the project folder, the git clone or the extracted ZIP.

`/api/v1` is for scripts, CI, and other tools. The browser UI keeps using `/api` and does not send a token. Create a token under **Automation tokens** on the settings page (`/settings`). The new token is shown once, in a highlighted panel with **Copy**. **Done** dismisses it. The server stores a SHA-256 hash in `<data>/.meta/api-tokens.json` (mode `0600`) and compares it in constant time. It does not keep the token, and it does not write the token to the log. Revoke a token on that same page. A revoked token stops working immediately and cannot be turned back on. **Delete** removes one revoked token from the list. **Clear revoked** removes all of them after you confirm. An active token has to be revoked before it can be deleted. Deleting a revoked token does not make it work again.

A token is `read` or `read-write`. Read can list, search, fetch source, export, lint, render, and preview link repairs. Read-write can also create, update, rename, move, duplicate, trash, generate, refresh, and apply link repairs. A read token that tries to write gets **403**. A missing, wrong, or revoked token gets **401**.

The OpenAPI document is `GET /api/v1/openapi.json`. That one route does not require a token. Every other `/api/v1` route does. Host and Origin checks still apply, including on token routes. A foreign `Host` is **403**. Every `POST`, `PUT`, `PATCH`, and `DELETE` needs `Content-Type: application/json`, including `DELETE /api/v1/diagrams`. Without that header the response is **415** and `{"error":"Content-Type must be application/json"}`. A foreign `Origin` is **403**. A token does not turn those checks off. The same header is required on the browser routes under `/api`. See [Security model](security.md#security-model). Full request schemas are in `GET /api/v1/openapi.json`.

**Status codes.** **401** is a missing, unknown, or revoked token, on every route except the OpenAPI document. **403** is a read token calling a read-write route, a `Host` that is not allowed, or an `Origin` that is not allowed. **409** is a conflict: the path already exists, a sibling data file needs `copyData` or `deleteData`, `expectedHash` or `expectedMtimeMs` does not match, or a link-repair choice is not in the preview. **415** is a mutation without `Content-Type: application/json`. **423** is an editor lock on a write. The JSON `lock` object includes `instanceName`, `hostname`, `acquiredAt`, `heartbeatAt`, and `sameInstance`. When another instance holds the diagram, `error` names that instance and the time it was opened, and `nerdgram` prints that same sentence. A lock on this computer still says the diagram is open in another window. **429** is the render limit, with `Retry-After`. **400** is a rejected body or query. The table below is every route. The purpose is the success response. The fields are the main query parameters or JSON body.

Settings routes used by the settings page, not by `nerdgram`, are `GET` and `POST /api/host` (the listen address, stored in the instance config and not in the diagram folder), `GET` and `POST /api/data-dir` (sets `NERDGRAM_DATA_DIR`; the JSON field is `path`), and `GET` and `POST /api/instance` (the instance name). Host and Diagram folder each report `saved` and `running`. The restart notice is shown only while those two differ. `POST /api/host` answers **409** in Docker, where `HOST` stays the bind. `POST /api/data-dir` answers **400** when the path is not absolute, is not a writable folder, or cannot be created, and **409** when Docker, an external `NERDGRAM_DATA_DIR`, or GitHub sync makes the field read-only. A relative diagram folder, such as `relative/path`, answers **400** with `An absolute path is required.`

`GET /api/host` and `POST /api/host` use these fields. `saved` is the Host setting for the next start. A missing file is shown as `127.0.0.1`. `savedHosts` is the bind that setting will use on the next start. A saved `127.0.0.1`, or a missing save, is `127.0.0.1` and `::1`. `effectiveHosts` is the bind of the process that is running now. It does not change when you save a new Host. Compare `savedHosts` with `effectiveHosts` to see whether a restart is still waiting. `source` is how that bind is chosen, and it follows the saved value immediately: `env` when `HOST` is set, `saved` when the saved address is not `127.0.0.1`, and `default` when `HOST` is unset and the saved Host is missing or `127.0.0.1`. Saving `127.0.0.1` reports `source: "default"` because that value is the loopback pair, not a custom address. `running` is the Host value this process started with, and the restart note compares it with `saved`.

A workspace name cannot be only spaces, and it cannot include a drive letter or `:`, `\`, `*`, `?`, `"`, `<`, `>`, or `|`. `  .mmd` and `C:\evil.mmd` are **400**. `POST /api/v1/folders` answers **409** with code `exists` when that folder is already there, and **201** when it is created. `POST /api/v1/diagrams/move` into the folder the item is already in answers **409** with code `same` and `That item is already in this folder.` Renaming or moving a generated diagram updates `nerdgram.description` when that text is still the automatic `Generated from <path>` line. A description you wrote stays as it is.

<!-- v1-route-table -->
| Method | Path | Scope | Purpose | Fields |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/openapi.json` | `public` | Returns this OpenAPI document. No token. | none |
| GET | `/api/v1/diagrams` | `read` | Lists folders and diagrams in one folder. | query `path` (empty is the root) |
| GET | `/api/v1/search` | `read` | Searches diagram names and text. | query `q` (required), `names`, `contents`, `regex` (`0` or `1`) |
| GET | `/api/v1/diagrams/content` | `read` | Reads one diagram's source and metadata. | query `path` (required) |
| POST | `/api/v1/diagrams` | `read-write` | Creates a diagram. **409** when the path already exists. **201** on success. | body `path`, `content` |
| PUT | `/api/v1/diagrams` | `read-write` | Creates or overwrites a diagram. `expectedHash` and `expectedMtimeMs` return **409** when the file changed. `force` overwrites. | body `path`, `content`, `force`, `expectedHash`, `expectedMtimeMs` |
| POST | `/api/v1/diagrams/rename` | `read-write` | Renames a diagram or folder and updates click links. **409** when `updateLinks` is false and another diagram links here. | body `from`, `to`, `updateLinks` (default true) |
| POST | `/api/v1/diagrams/move` | `read-write` | Moves a diagram or folder, updates click links, and moves a sibling data file. **409** `same` when the item is already in `toFolder`. | body `from`, `toFolder` (empty is the root), `updateLinks` |
| POST | `/api/v1/diagrams/duplicate` | `read-write` | Duplicates a diagram or folder. **409** with `files` when a sibling data file exists and `copyData` is omitted. | body `path`, `copyData` |
| DELETE | `/api/v1/diagrams` | `read-write` | Moves a diagram or folder to the trash. **200** with `path` and `trashed`. **409** with `files` when a sibling data file exists and `deleteData` is omitted. | query or body `path`; body `confirmLinks` (default true), `deleteData` |
| POST | `/api/v1/folders` | `read-write` | Creates a folder. **409** when that folder already exists. **201** on success. | body `path` |
| GET | `/api/v1/export` | `read` | Reads every diagram under a folder. | query `path` |
| GET | `/api/v1/link-repairs` | `read` | Previews click-link repairs. Nothing is written. | none |
| POST | `/api/v1/link-repairs` | `read-write` | Previews, or applies when `dryRun` is false and `confirm` is true. **409** when a pair is not in the preview. | body `dryRun` (default true), `confirm`, `lockToken`, `choices` (`from`, `to`) |
| GET | `/api/v1/lint` | `read` | Lints one saved diagram, or every diagram when `path` is omitted. A file that cannot be read is returned under `unreadable`, and the other diagrams are still checked. | query `path` |
| POST | `/api/v1/lint` | `read` | Lints Mermaid source that is not necessarily saved. Use this to check a paste before writing it. | body `source`, `sourcePath`, `diagramPaths`, `rules` |
| GET | `/api/v1/render` | `read` | Renders a saved diagram to SVG or PNG. **429** over 30 calls a minute per token. | query `path`, `format` (`svg` or `png`), `background` |
| POST | `/api/v1/render` | `read` | Renders a saved diagram or posted source. Send `path` or `source`, not both. Same **429** limit. | body `path` or `source`, `format`, `background` |
| POST | `/api/v1/generate/preview` | `read` | Builds a diagram from CSV, JSON, CDP, LLDP, or network JSON and writes nothing. | body `text`, `format` (`csv`, `json`, `cdp`, `lldp`, `network`), `view` (`l3` or `l2`, required for network), `includeDown`, `vlan`, `direction`, `groupBy`, `localDevice`, `title`, `edgesText`, `mapping`, `grouping`, `shape` |
| POST | `/api/v1/generate` | `read-write` | Creates the complete diagram from that same data and stores the data file beside it. **409** when the path exists. **201** on success. This is the create-only call. | body `text`, `path`, `format` (`csv`, `json`, `cdp`, `lldp`, `network`), `view` (`l3` or `l2`), `includeDown`, `vlan`, `direction`, `groupBy`, `localDevice`, `title`, `edgesText`, `storeData`, `mapping`, `grouping`, `shape` |
| POST | `/api/v1/generate/upsert` | `read-write` | Creates that diagram, or updates the generated block and the sibling data file when the path already exists. **201** on create, **200** on update. Notes outside the generated markers stay. **409** when the file was not generated from data. | body `text`, `path`, `format` (`csv`, `json`, `cdp`, `lldp`, `network`), `view` (`l3` or `l2`), `includeDown`, `vlan`, `direction`, `groupBy`, `localDevice`, `title`, `edgesText`, `storeData`, `mapping`, `grouping`, `shape` |
| POST | `/api/v1/generate/refresh` | `read-write` | Replaces the generated block from the data in this call. Network view and options come from the diagram, not from this body. | body `path`, `text`, `edgesText`, `diagramText`, `writeData`, `save` |
| GET | `/api/v1/history` | `read` | Lists revisions for one diagram, including baseline name and note. | query `path` |
| GET | `/api/v1/history/diff` | `read` | Diffs two revisions, or a revision and the current diagram. The file is not modified. | query `path`, `from`, `to` (id, baseline name, or `current`) |
| POST | `/api/v1/history/baseline` | `read-write` | Names a revision, or saves the current diagram as a named baseline. **201** on success. | body `path`, `name`, `id`, `note` |
| PATCH | `/api/v1/history/baseline` | `read-write` | Renames a baseline or changes its note. An empty `note` clears it. | body `path`, `id`, `name`, `note` |
| DELETE | `/api/v1/history/baseline` | `read-write` | Removes a baseline name. The revision stays, and the 20-revision limit applies to it again. | body `path`, `id` |
| POST | `/api/v1/replace/preview` | `read` | Previews a find and replace. Nothing is written. | body `find`, `replace`, `matchCase`, `wholeWord`, `regex`, `includeFrontMatter`, `scope` |
| POST | `/api/v1/replace/apply` | `read-write` | Applies a previewed replace. Each saved diagram becomes a revision first. | body `find`, `replace`, `files` (`path`, `hash`, `skipMatchIds`) |
| POST | `/api/v1/replace/undo` | `read-write` | Undoes one replace. Files edited since that replace are skipped. | body `id` |
<!-- /v1-route-table -->

`nerdgram` calls these routes as listed in [docs/cli.md](cli.md#command-to-route-map). Routes with no command are API-only: create (as opposed to overwrite), folders, lint of unsaved source, GET render, generate preview, history list, and baseline rename or delete.

```bash
curl -fsS "http://127.0.0.1:8787/api/v1/diagrams" \
  -H "Authorization: Bearer ng_your_token"

curl -fsS "http://127.0.0.1:8787/api/v1/diagrams/content?path=Welcome.mmd" \
  -H "Authorization: Bearer ng_your_token"

curl -fsS -X POST "http://127.0.0.1:8787/api/v1/render" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Welcome.mmd","format":"svg"}' \
  -o Welcome.svg
```

Rename and move update `click` links the same way the editor does after you confirm. Pass `"updateLinks": false` to refuse the change when another diagram links there (**409**, with the file list). A CSV, JSON, network JSON, CDP, or LLDP file in the same folder moves with the diagram, and the response `dataFiles` list is the old path and the new path. `nerdgram.source` is updated. Duplicate is `POST /api/v1/diagrams/duplicate`. When a sibling data file exists, omit `copyData` and the call returns **409** with `files`. `"copyData": true` copies the file and points the duplicate at the copy. `"copyData": false` shares the original file and does not change it. Delete is `DELETE /api/v1/diagrams`. It answers **200** with `path` and `trashed`. The path can be a query parameter or a JSON field. Send `Content-Type: application/json` and a JSON body. `{}` is enough when `path` is in the query string. When a sibling data file exists, omit `deleteData` and the call returns **409** with `files`. `"deleteData": true` moves that file to the trash with the diagram. If another diagram still records the same file, the file stays and the **200** body includes `message` and `dataKept`. `message` names that diagram. `dataKept` lists the file and the diagrams. `"deleteData": false` leaves the file in the workspace. `nerdgram rename`, `nerdgram move`, `nerdgram duplicate` (`--copy-data` or `--share-data`), and `nerdgram delete` (`--with-data` or `--keep-data`) call those routes. An editor lock returns **423**. Paths stay inside the data directory.

```bash
curl -fsS -X DELETE "http://127.0.0.1:8787/api/v1/diagrams" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Notes.mmd"}'
```

`GET /api/v1/link-repairs` previews repairs after a diagram was renamed or moved outside the app, including by a sync pull. Nothing is written. `POST /api/v1/link-repairs` writes only when the body is `{"dryRun":false,"confirm":true}`. Leave `dryRun` out, or set it true, and the response is the same preview. `choices` is the list of `from` and `to` paths you already previewed. Omit it to apply every suggestion that has one target. A suggestion with more than one target is never applied. A pair that is not in the current preview is **409**.

Lint reuses the same checks as the editor:

```bash
curl -fsS "http://127.0.0.1:8787/api/v1/lint?path=Welcome.mmd" \
  -H "Authorization: Bearer ng_your_token"
```

## One call builds the whole diagram

`generate` and `refresh` are not a way to add one device per call. Each call builds the **complete** generated diagram from the data in that call. A later call on the same diagram replaces that generated block. It does not append. `POST /api/v1/generate/refresh` rewrites only the lines between `%% nerdgram:generated` and `%% nerdgram:generated end`. A device or link left out of the new data drops off the diagram. Notes, styling, and hand-added nodes outside those markers stay. The workspace path, such as `Network/Core.mmd`, is the id a later refresh uses. Put every device's CDP or LLDP output in **one** `text` value, pasted one after another. The previous diagram is saved as a revision before the refresh is written, so history, baselines, and `diff` can compare old against new.

CSV and JSON still use the [Generate from data](generate-from-data.md#generate-from-data) pipeline. CDP and LLDP use the same routes: `format` is `cdp` or `lldp`, `groupBy` is `platform` (the default) or `capability`, and `localDevice` is the hostname when the paste has no CLI prompt. Network JSON uses the same routes with `format` `network` and `view` `l3` or `l2`. `includeDown`, `vlan`, and `groupBy` (`vrf` for Layer 3, and `site`, `role`, or `platform` for Layer 2) are the view options. Refresh reads those from `nerdgram.source` and does not take them in the body. `POST /api/v1/generate/upsert` is the call to repeat. The first post creates the diagram. The next post of the same path updates the generated block and the sibling data file. Notes outside `%% nerdgram:generated` stay. `POST /api/v1/generate` stays create-only and returns **409** when `path` already exists. `nerdgram generate` calls upsert. `nerdgram generate --create-only` calls generate. `save: true` on refresh writes the diagram. Without it, the response is the new source and the diff, and the file stays as it was. `writeData: true` stores the new `text` in the sibling data file.

A network script can post `show cdp neighbors detail` and NerdGram builds the diagram. This paste is two devices in one call:

```bash
curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Network/Core.mmd","format":"cdp","groupBy":"platform","text":"core-sw#show cdp neighbors detail\n-------------------------\nDevice ID: dist-sw\nPlatform: cisco WS-C3750X-48, Capabilities: Switch\nInterface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet1/0/48\n-------------------------\nDevice ID: access-sw\nPlatform: cisco WS-C2960-24TT-L, Capabilities: Switch\nInterface: GigabitEthernet1/0/2, Port ID (outgoing port): GigabitEthernet0/1\n"}'
```

LLDP is the same call with `"format":"lldp"`. A paste that has no prompt needs `"localDevice":"edge-sw"`. The samples are `docs/samples/neighbors/cisco-ios-cdp.cdp` and `docs/samples/neighbors/cisco-ios-lldp.lldp`.

Later, the same path is the refresh. This replaces the generated block with the new neighbor output and keeps the previous diagram as a revision:

```bash
curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate/refresh" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Network/Core.mmd","text":"core-sw#show cdp neighbors detail\n-------------------------\nDevice ID: dist-sw\nPlatform: cisco WS-C3750X-48, Capabilities: Switch\nInterface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet1/0/48\n","writeData":true,"save":true}'
```

Refresh reads `format` from the diagram's front matter, so the new `text` has to match the format the generate call stored. The matching CLI, from a checkout that can read the sample file, is:

```bash
nerdgram generate --path Network/Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp --format cdp
nerdgram refresh Network/Core.mmd --data docs/samples/neighbors/cisco-ios-cdp.cdp
nerdgram generate --path Campus-L3.mmd --data docs/samples/network/campus.network.json --format network --view l3
nerdgram refresh Campus-L3.mmd
```

Network JSON is the same one-call shape. `text` is the whole document. A later refresh of `Campus-L3.mmd` rebuilds the Layer 3 view from the new document and leaves notes outside the markers.

```bash
curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Campus-L3.mmd","format":"network","view":"l3","text":"{\"schemaVersion\":1,\"devices\":[{\"name\":\"core\"},{\"name\":\"dist\"}],\"interfaces\":[{\"device\":\"core\",\"name\":\"Gi0/0\",\"ipv4\":[{\"address\":\"10.0.0.1\",\"prefix\":30}]},{\"device\":\"dist\",\"name\":\"Gi0/1\",\"ipv4\":[{\"address\":\"10.0.0.2\",\"prefix\":30}]}]}"}'
```

`nerdgram refresh` sends `save: true`, and `writeData: true` when `--data` is set. CSV still works:

```bash
curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate" \
  -H "Authorization: Bearer ng_your_token" \
  -H "Content-Type: application/json" \
  -d '{"path":"Campus.mmd","text":"Local Device,Remote Device\nCore,Atlanta\n"}'
```

Render runs headless Chrome (the `chrome-headless-shell` build, not the full browser) so SVG and PNG match the editor. `format` is `svg` or `png` on `POST /api/v1/render` and on `GET /api/v1/render`. `jpg`, `pdf`, and any other value are **400** with `{"error":"format must be svg or png","code":"invalid"}`. An SVG that is not well-formed XML is **500**. A DOM emulator was not accurate enough for layout. The shell adds about 260 MB unpacked, plus the shared libraries the image installs for it. That is the size cost of a correct picture. Render is limited to 30 calls a minute per token (**429**, `Retry-After`). Posted source is limited to 512 KB, and the SVG is sanitized the same way cached thumbnails are.

The server binds to `127.0.0.1` and `::1` when `HOST` is unset and the saved Host setting is `127.0.0.1` or missing. To let another machine call this API, set Host to that machine's IP or to `0.0.0.0`, then start NerdGram again. The setting adds that address, or the machine's discovered interface addresses for `0.0.0.0` and `::`, to the allowed `Host` names. You do not set `NERDGRAM_ALLOWED_HOSTS` for those addresses on a Node install. A token does not protect the browser routes under `/api`. Those routes stay open on purpose, for the UI. Anyone who can reach the port can use them. Treat the open port as a tool port on a network you trust, and limit it with a firewall rule or a reverse proxy. Do not forward it from an ISP router. In Docker, publish the host port you want and set `NERDGRAM_ALLOWED_HOSTS` to the address callers use. See [Security model](security.md#security-model).

## See also

- [nerdgram command](cli.md)
- [Security model](security.md)
- [Generate from data](generate-from-data.md)
