# Changelog

Release notes for GitHub Releases. The heading for a release is `## X.Y.Z "Code name" - YYYY-MM-DD`. It has to match the root `package.json` version. `npm run version:check` requires the quoted code name to match the `codenames` map. The notes script also accepts `## X.Y.Z` and `## [X.Y.Z]`, with an optional code name and date. The `vX.Y.Z` tag is the version the update check reads. The GitHub Release title is `vX.Y.Z "Code name"`, from that tag and the map.

`## Unreleased` is everything that is not in a numbered release yet. When that list is empty, the section is `_No unreleased items._`, so the heading does not look like it belongs to the release below. That line is not a release note. `npm run version:sync` moves real Unreleased notes under the new version heading when that heading is not there yet, then puts `_No unreleased items._` back.

## Unreleased

_No unreleased items._

## 1.5.1 "Compass" - 2026-11-17

Patch on the Compass line. The code name stays Compass. Long flowchart labels keep their padding, a failed render reports a status, and a diagram can save and apply a named style preset.

- Flowchart node labels keep inner padding in the preview, in presentation, and in SVG and PNG exports when a line is a long address such as `2001:db8::1/128`, in the light and dark themes. A label with a line break still shows every line. Edge-label padding is unchanged (from #144).
- `nerdgram render --json` reports a status when a render fails. An SVG that would not parse exits 1 with `"status": 500` and the error, the same failure `POST /api/v1/render` returns as **500**. A failure with no HTTP status uses `"status": "error"` (from #143, #142).
- Named style presets can be saved from Diagram info, applied to a diagram, and set as the default for new diagrams. Applying a preset copies its theme, look, layout, font, colors, and related options into that diagram's file, so the diagram still renders the same way without the preset. Custom fonts suggest families already used in the workspace, and theme color fields show swatches of colors the diagrams already use (from #116). A preset does not change `flowchart.wrappingWidth`.

## 1.5.0 "Compass" - 2026-11-17

Minor release. The code name for 1.5.0 through 1.9.x is Compass. 1.0.0 through 1.4.x stay Atlas.

- Multi-line edge labels keep every line. Side padding is on the label text, not the inline wrapper that was clipping the last line. SVG and PNG from the API and `nerdgram render` are well-formed XML, including labels that contain a line break and diagrams with a `click` line. A render that does not parse fails instead of writing a broken file (from #139).
- The editor divider reports a whole-number value at its limits. Resizing the window clamps only the panes on screen and does not replace the saved split (from #140).
- Network JSON validation errors name the field path, for example `/devices/0/serial`, and ask you to fix the fields listed before creating, updating, or refreshing. CSV and other row-based imports still name the row (from #135).
- Edge labels in the editor preview, presentation, and SVG and PNG exports have a few pixels of side padding in the light and dark themes. The label text and the Mermaid source stay the same (from #136).
- The divider between the code pane and the preview can be dragged. The split is remembered in this browser, a double-click puts it back, and arrow keys move it. A narrow window still stacks the panes (from #137).
- Refreshing a diagram after this upgrade draws `device.platform` on the device and `interface.description` on the Layer 2 link when the file already set them (from #126). A file that omits those fields draws the same diagram as before.
- `POST /api/v1/generate/upsert` creates a generated diagram, or updates its generated block and the sibling data file when that path already exists (from #128). Notes outside the generated markers stay. `POST /api/v1/generate` is still create-only and returns **409** when the path exists. `nerdgram generate` calls upsert. `--create-only` keeps the **409**.
- A clean GitHub pull no longer pushes an empty commit. A pull or conflict resolution that leaves the files matching the latest commit is not treated as a local edit, and NerdGram does not create a commit whose tree matches its only parent. An edit made after a pull still becomes a commit.
- Network JSON stays on `schemaVersion` 1 and adds optional `device.model`, `device.diagram`, `interface.speed`, and a link `label` (from #127). The model is written under the device name. A child diagram path becomes a click line. Speed and the link label are written on the edge when they are set. `docs/samples/network/campus.network.json` omits them and draws the same views. Unexpected properties are still errors.
- Network diagrams draw `device.platform` under the device name, and `interface.description` on the Layer 2 link when that text is set (from #126). Layer 2 group-by can be platform, along with site and role. A file that omits those fields draws the same diagram as before.
- Network JSON has a compatibility policy (from #125). An additive optional field stays on `schemaVersion` 1. A change to a field's meaning bumps `schemaVersion` to 2. The schema stays closed, so an unexpected property is still an error. A file that uses a key added in NerdGram 1.5 needs that release or a later one. A file that omits the new key keeps working. The policy is in `docs/schema`, in Generate from data, and in the description of `docs/schema/network.schema.json`.

## 1.4.8 "Atlas" - 2026-11-17

Patch on the Atlas line. The code name stays Atlas. GitHub sync can push the first commit, report a failed connect, and refresh a Device Flow token. Settings walks through the OAuth app. An empty Unreleased list says there is nothing pending.

- GitHub sync sends the git HTTP token as Basic `x-access-token` and keeps Bearer for the REST API. A git HTTP 401 or 403 is an authorization failure. Connect and sync failures stay on the sync status, and the log line is the error code plus a message with no token.
- An OAuth app that expires user tokens can keep syncing. The refresh token and the expiry times stay in the mode `0600` token file. Device flow refresh does not need a client secret. A token that does is refreshed only when `NERDGRAM_GITHUB_CLIENT_SECRET` is set. Otherwise the status asks you to connect again.
- Settings explains GitHub sync with a short setup list and a status line: not set up, signed in, connected, or needs attention.
- An empty Unreleased section is `_No unreleased items._`. Cutting a release moves the notes into the version section and puts that line back. The GitHub Release notes skip it.

## 1.4.7 "Atlas" - 2026-11-17

Patch on the Atlas line. The code name stays Atlas. Exports use the diagram theme and background. Favorites are Bookmarks, and the sidebar opens with Your space. The template gallery is grouped by category. Create flows ask for a file name, and Diagram info suggests tags already used in the workspace.

### Themed exports, the syntax reference, and bookmarks

From #112 (#107).

- SVG, PNG, JPG, and PDF exports use the diagram's theme and background, the same colors as the editor. PNG can still be saved transparent from the export menu.
- SVG and PDF are drawn again with SVG text labels, so flowchart words are in the file and not only in an HTML label. If that PDF cannot be built, the PDF is the same picture as the PNG.
- **Open Syntax Reference Library** opens the syntax reference in a new tab. The dashboard or editor stays where it was.
- Favorites are Bookmarks. An older list in `.meta/favorites.json` is kept. Bookmarks can sit in folders. **Move up** and **Move down** reorder a bookmark among the others in the same folder, and the same buttons reorder folders. **Manage** opens the bookmarks settings. A bookmark whose file is gone is marked **Missing** and can be removed. Deleting a bookmark folder keeps the bookmarks and moves them to the top level.

### Template gallery

From #112 (#108).

- The gallery is one section per category, in this order: Network, Software, Internet & Cloud, Security, OT & Industrial, Data Center, Operations & Planning, then User created. Every category is shown, including one with no templates. An empty section says **No templates here yet.** User created also says to open a diagram and choose **Create as template**.
- Shipped templates stay read-only. They have no Edit, Rename, or Delete. A request to change a shipped template answers **403**.
- **Create as template** saves a copy of the open diagram under User created, in the data directory's `.templates` folder. The original diagram is not changed. The category is always User created.

### File names and refreshing diagram checks

From #112 (#109).

- **New diagram**, **Paste Mermaid**, **From data**, and **Use template** ask for a **File name** before the `.mmd` file is written. An empty name is not saved as `Untitled.mmd`.
- Click the file name in the editor header, or run **Rename file** from the command palette, to rename the file in place. That does not change the front matter title, and renaming the title does not rename the file.
- Diagram checks and **Needs attention** share one workspace check. Moving a diagram to Trash, restoring it, deleting it, renaming it, or creating one runs that check again. It does not poll.

### Your space

From #112 (#110).

- **Your space** in the sidebar is, from top to bottom, Dashboard, Recent, Bookmarks, Needs attention, Trash, then the folder tree.
- Recent is the last 10 diagrams opened in this browser. It is stored in the browser, not on the server. A rename or move keeps the row. A deleted or trashed diagram drops off. **Clear** empties the list.
- Needs attention opens a dashboard list of diagrams with check problems, broken links, or files that could not be read. The count is hidden when nothing needs attention.

### Subgraph ids in diagram checks

From #112 (#111).

- A link to a subgraph id is not flagged as an unlabeled endpoint. That includes `subgraph ID`, `subgraph ID["Label"]`, `subgraph "Title only"`, and a subgraph inside another.
- A real typo still warns. A case-only mismatch, such as `SouthBound` against `Southbound`, still warns, and the message names the closest id when there is one.

### Tag autocomplete

From #112 (#113).

- The tag field in **Diagram info** suggests tags already used in the workspace, from `GET /api/tags`. Each row is a stored spelling and how many diagrams use it. Trash is left out. The dashboard tag filter uses the same list.
- A prefix match comes before a match later in the word, and a more-used tag comes before a rarer one. If you type a different case of a tag that already exists, that existing spelling is offered first.

## 1.4.6 "Atlas" - 2026-11-17

Patch on the Atlas line. The code name stays Atlas. A new token is shown with Copy, and revoked tokens can be deleted. The editor breadcrumb ends in the file name and returns to that diagram's folder. Cards and the header lead with the file name, and Diagram info is one button.

### Automation tokens and folder cards

From #105 (#102).

- A new token is shown once, in a highlighted panel with **Copy** and **Done**. The server still stores only a hash, and it does not write the token to the log.
- **Delete** removes one revoked token. **Clear revoked** removes all of them after you confirm. An active token has to be revoked before it can be deleted. Deleting a revoked token does not make it work again.
- A folder card counts the diagrams and subfolders directly inside it, for example **0 diagrams · 2 folders**. A folder with no subfolders shows only the diagram count. The count is not a total of everything nested further down.

### Editor breadcrumb and folder tree

From #105 (#103).

- The editor header is the folder path and the file name, without `.mmd`. Each folder is a link to that folder on the dashboard. The file name is not a link. A long path collapses the middle folders to an ellipsis.
- The logo leaves the editor for the folder that contains the diagram. A diagram at the root returns to the dashboard root. If that folder is gone, the link opens the nearest folder that is still there.
- In the sidebar, a folder that contains another folder has a chevron. **Collapse all** closes every branch except the folders you need to see the one you have open. The choice is saved in this browser. Opening a folder expands the folders above it so the current one stays visible.

### File names, fonts, and diagram info

From #105 (#104).

- Font family is a preset list: **Default**, **System UI**, **Sans-serif**, **Serif**, **Monospace**, and **Custom…**. Custom keeps the spaces you type and saves when you leave the field or press Enter.
- Cards and the editor header lead with the file name, without `.mmd`. A different front matter title is a muted second line. A title that matches the file name does not repeat. The rendered diagram and **Present** still use the title.
- **Diagram info** in the editor header opens and closes the panel, and it stays marked while the panel is open. The preview toolbar no longer has **Edit info**.

## 1.4.5 "Atlas" - 2026-11-17

Patch on the Atlas line. The code name stays Atlas. Check for updates reports on every click, including when GitHub is offline, rate-limits the check, or a TLS certificate fails, and a TLS failure links to Corporate TLS inspection. The roadmap adds a 1.7.5 Batfish translator and a translator picker with a data-completeness notice.

### Update checks

From #100 (#99).

- **Check for updates** shows a busy state, then the result or the error, on every click, including when that error is the same as the last one.
- The failure is one of three classes. GitHub could not be reached. GitHub rate-limited the check. A TLS certificate failed. Certificate errors (`SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `CERT_HAS_EXPIRED`, and `DEPTH_ZERO_SELF_SIGNED_CERT`, including when the code is on `error.cause`) say a proxy or TLS inspection on this network is likely intercepting HTTPS, and link to Corporate TLS inspection.
- Corporate TLS inspection explains that update checks and GitHub sync run inside the container, why a proxy such as Zscaler fails there, and how to mount the corporate root PEM read-only with `NODE_EXTRA_CA_CERTS` (`docker run` and Compose). It does not turn TLS verification off.
- **Check for updates** is a secondary button, with a muted fill, a border, and ink text, so it reads as a button on the dialog in Light and Dark. The automatic-check and prerelease checkboxes sit on one row with their labels.

### Roadmap

From #98.

- **1.7.5-k Batfish.** The translator reads exported Batfish or pybatfish question JSON (interface properties, IP ownership, VLAN and switched-VLAN properties, and layer-3 edges) into canonical network JSON. NerdGram does not run Batfish and does not parse device configs. Config-only output draws the routed view. Layer 1 and Layer 2 links are inferred or missing unless a `layer1_topology.json` is added to the snapshot upstream. Inferred links stay marked inferred. An unresolved neighbor is a placeholder node. The translator never invents a link.
- **1.7.5-l Translator picker.** On the generate-from-data paste screen, a picker lists installed translator modules from the registry. Choosing one sets that tool's format hint and placeholder. Paste and file upload both call `POST /api/v1/convert/<source>`. When a translator is selected, a data-completeness notice titled **Your diagram reflects your data** sits above the input. **Translator tips** links to that translator's docs. **Don't show again** is remembered per translator.

## 1.4.4 "Atlas" - 2026-11-16

Patch on the Atlas line. The code name stays Atlas. Diagram checks handle a file that cannot be read, the dashboard card and the editor say Can't read file with Retry, and the team use docs say synced folders are not supported for team locks.

### Unreadable diagram files

From #96 (#95).

- `GET /api/diagram-lint` and `GET /api/v1/lint` read each diagram on its own. A file that cannot be read is listed with a short explanation, and the other diagrams are still checked. The Diagram checks panel shows that explanation in plain words. EIO, EACCES, EPERM, ENOENT, EBUSY, and ETIMEDOUT each have their own sentence.
- A dashboard card and the editor say **Can't read file**, with the reason and **Retry**, when the file cannot be read. **Parse error** stays the badge for a diagram Mermaid cannot draw. Lock holder details stay on the **423** lock.
- Team use docs say that iCloud Drive, OneDrive, Dropbox, and Google Drive are not supported for team locks. Use an SMB or NFS share, or GitHub sync.

## 1.4.3 "Atlas" - 2026-11-16

Patch on the Atlas line. The code name stays Atlas. The code pane scrolls inside its frame, the preview pans and zooms with Fit, and Settings can set Appearance to Light, Dark, or Match system.

### Editor scrolling, preview pan and zoom, and appearance

From #93 (#92).

- The code pane scrolls inside its frame. The wheel, the scrollbars, a trackpad, and the keyboard move through a long diagram, and the caret stays in view. This holds with the info panel open or closed, and in a narrow window.
- The preview pane drags to pan, and the wheel zooms toward the pointer. **Fit** on the preview toolbar resets pan and zoom. The zoom percent sits beside it. Typing does not snap the view back.
- **Appearance** on the settings page is Light, Dark, or Match system. Match system is the default. The choice is stored in this browser. The dashboard, sidebar, settings, dialogs, the reference, and the editor follow it. A diagram's own theme, look, and layout are unchanged.

## 1.4.2 "Atlas" - 2026-11-15

Patch on the Atlas line. The code name stays Atlas. Fixes from 1.4.0 testing print the CLI version and flag help, reject a bad folder, path, or view, keep generated descriptions and replace undo honest, and correct network views, Host and sync settings, editor lock retries, and the npm 11 Puppeteer note.

### Fixes from 1.4.0 testing

From #88 (#87).

- `nerdgram --version` prints the version, and `--help` lists `--vlan`, `--include-down`, `--group-by`, `--url`, `--token`, and the `--json` object. `refresh` rejects `--view`. A local file passed to `render --server` says to drop `--server`.
- Creating a folder that already exists is **409**. A move into the current folder is **409**. Whitespace-only names and names with a drive letter or other invalid path characters are rejected. A rename updates an automatic `Generated from <path>` description. A second replace undo says already undone.
- The Generate direction list has one Top to bottom choice. VRF grouping keeps a multi-VRF device in a subgraph named for those VRFs. A named native VLAN is shown with its name. The same address on two devices is a warning.
- A relative Diagram folder says an absolute path is required. `/api/host` reports `savedHosts` next to `effectiveHosts`, and the fields are documented. A missing template says the template was not found. Repair links stays disabled when nothing matches. Sync connect with no account is `not_connected`. An empty client ID clears a saved one.
- A lock retry while another window holds the diagram does not log a **423** each time. Sidebar Settings links to Diagram folder and Instance name. The CLI docs note the npm 11 `allowScripts` warning for the Puppeteer postinstall.

## 1.4.1 "Atlas" - 2026-11-15

Patch on the Atlas line. The code name stays Atlas. The README is a short overview, and the guides are pages under `docs/`. Fixes from 1.4.0 testing keep a fresh install's git tree clean, return JSON for a bad request body, and correct shared data files, editor locks, the preview, a loopback Host, CLI errors, the syntax reference, dialogs, and long file names.

### Documentation

From #83 (#82). The README is a short overview. Install, features, the API, the CLI, and the other guides are pages under `docs/`.

### Fixes from 1.4.0 testing

From #85 (#84).

- `npm run install:all` leaves the git tree clean. The verify job fails if an install changes a lockfile.
- A malformed JSON body returns **400** and a body over 5 MB returns **413**, both as `{error, code}`. The server log is one line, with no stack and no absolute path. `npm start` does not set `NODE_ENV`.
- Deleting a diagram with `deleteData` keeps a data file that another diagram still uses. The API response and the dashboard name that diagram.
- The editor lock alert clears as soon as this window gets the lock. A stale or taken-over lock records a new open time.
- Diagram info and a long source keep the preview in view. The preview uses the width of its pane.
- A saved or effective Host on another loopback address, such as `127.0.0.2`, is an allowed origin. Other origin checks are unchanged.
- `nerdgram generate` and `nerdgram refresh` print the row and field errors the API returns, in text and in `--json`.
- The Syntax Reference no longer shows the source and license comments or a repeated title. The upstream link stays on the page.
- Escape closes a dialog. The Move dialog focuses its folder list. An error banner sits above an open dialog.
- A file name the filesystem cannot store returns **400** with a name-length message. A long diagram path no longer makes the lock filename too long.

## 1.4.0 "Atlas" - 2026-11-15

Minor release on the Atlas line. The code name stays Atlas. Two installs can share one diagram folder, with instance-aware file locks, a Diagram folder setting, and team use docs. A vendor-neutral network JSON file draws a Layer 3 subnet view or a Layer 2 VLAN, trunk, and LAG view. Host is stored per instance, and the campus sample connects the Layer 2 uplinks.

### Team use

From #78 (#77). Instance-aware editor locks for a shared diagram folder. Each install keeps an instance id and an optional instance name in its own startup config, not in the shared folder. Lock files record the instance id, instance name, and hostname. A lock from another instance is judged by heartbeat age. The pid check stays for this instance, and for older lock files that have no instance id. A second instance is told who has the diagram, in the **423** body, in `nerdgram`, and in the existing editor lock banner.

The Diagram folder setting stores `NERDGRAM_DATA_DIR` in that same startup config. An external `NERDGRAM_DATA_DIR` stays the source of truth and the field is read-only. Docker stays read-only and points at the volume mount. The field is disabled while GitHub sync is on. GitHub sync itself is unchanged.

The restart note on Host and on Diagram folder shows only while the saved value differs from the value this process started with. After a restart that is running the saved value, the note is gone. The README **Team use** section covers a shared folder, a shared hub, and GitHub sync.

### Host setting

From #80. The Host setting is stored in the instance startup config (`~/.nerdgram/instance.json`, or `NERDGRAM_INSTANCE_FILE`), with the instance id and the Diagram folder. It is not stored in the diagram folder, so installs that share a folder keep their own bind address. An existing `<data>/.meta/listen-host.json` is copied into that config once, when the config has no Host yet, and the old file is left in place and then ignored. `HOST` still wins. Docker is unchanged: the image sets `HOST=0.0.0.0` and the box stays read-only. Saving Host and Diagram folder, then restarting once, applies both. The restart note still shows only until that restart.

### Campus sample

From #80. The campus network sample connects `core-rtr` to the distribution switch and `wan-rtr` to the core on Layer 2 trunks. The Layer 2 view no longer warns that those nodes are defined but never connected. The Layer 3 view is unchanged.

### Network data

From #79 (#74). **From data** accepts a vendor-neutral network JSON file (`.network.json`, `schemaVersion` 1) and draws either a Layer 3 subnet view or a Layer 2 VLAN, trunk, and LAG view. NerdGram does not parse vendor CLI for this, and it does not call an LLM. The caller builds the JSON with the tools they already have. The same input always produces the same generated block. Generate, preview, and refresh take `format: "network"` and `view: "l3"` or `"l2"`. `nerdgram generate --format network --view l3|l2` and `nerdgram refresh` do the same. The data file is stored beside the diagram, and rename, move, duplicate, and delete move it the way they move a CSV. The schema is `docs/schema/network.schema.json`. A campus sample is `docs/samples/network/campus.network.json`.

## 1.3.0 "Atlas" - 2026-11-15

Minor release on the Atlas line. The code name stays Atlas. Settings can choose the address NerdGram listens on, the docs describe that address as a LAN tool port, and the Automation API reference lists every route. The app image is a new portrait.

### Host setting

From #75 (#73). Settings has a Host box. It defaults to `127.0.0.1` and is stored under the data directory, so it is still there after a restart. That default, and a missing file, keep today's loopback bind: `127.0.0.1` and `::1`. A machine IP listens on that interface only. `0.0.0.0` listens on every IPv4 interface, and `::` listens on every IPv6 interface. The box accepts an IPv4 or IPv6 address only. A hostname is not accepted. NerdGram does not restart itself. When the saved value is not `127.0.0.1`, the page tells you to restart NerdGram manually before that address takes effect. Saving `127.0.0.1` again clears that notice.

When `HOST` is set, it wins over the saved value, and the page says so. `HOST=127.0.0.1` is IPv4 loopback only, which is not the same as the saved default. Inside Docker the image sets `HOST=0.0.0.0`, so the box is read-only. Other machines reach the container through the published port. `127.0.0.1:8787:8787` keeps the tool port on the host loopback. `<lan-ip>:8787:8787` publishes that address. The container does not see the host's LAN addresses, so those callers need `NERDGRAM_ALLOWED_HOSTS`.

A saved machine IP is accepted as a `Host` name, including `IP:port` on the API port. `0.0.0.0` and `::` are not Host names. At startup NerdGram allows the machine's non-loopback interface addresses instead, so a caller can use any of those IPs without adding them to `NERDGRAM_ALLOWED_HOSTS`. Loopback names (`localhost`, `127.0.0.1`, `::1`) stay allowed. Names in `NERDGRAM_ALLOWED_HOSTS` are merged in. A DNS name still belongs there.

### LAN tool port

From #75 (#73). The README and the CLI docs call the API a tool port: a conduit other programs on a network you trust can call on demand, not an always-on server for many users. The default bind stays loopback. The docs say what publishing the port opens, and the full set of changes a Node install and a Docker install each need before a LAN call succeeds.

### One call builds the whole diagram

From #75 (#73). `generate` and `refresh` each send the complete data for the diagram. A later call replaces the generated block. It does not add one device at a time. The workspace path is the id a refresh uses. The docs include a CDP example that posts `show cdp neighbors detail` for two devices in one call, then refreshes that same path. Notes outside the generated markers stay. The previous diagram is kept as a revision.

### Endpoint reference

From #75 (#73). The Automation API section lists every `/api/v1` route in one table: method, path, token scope, what a success returns, and the main fields. `docs/cli.md` maps each route to the `nerdgram` command that calls it. A test reads that table and that map and fails when either one drifts from the routes the server serves.

### App image

The header, the About panel, and the browser icon use a new portrait of NetworkNerd1337.

## 1.2.2 "Atlas" - 2026-11-15

Patch on the Atlas line. The code name stays Atlas. Clicking an object in the preview jumps the editor to the line that drew it.

### Click to source

From #71 (#70). A click on a rendered object in the preview puts the caret on the source line that defined it and scrolls that line into view when it is off screen. If the line is already on screen, the editor does not scroll. This covers a flowchart node, edge, edge label, and subgraph; a sequence participant and message; a class, a class member, and a relation; a state and a transition; and an ER entity, an attribute, and a relationship. The line the caret is on has a soft background highlight. The tint stays light enough that syntax colors stay readable, in the dark editor and on a light editor surface, and it stays on whichever line the caret is on while you type or click. A click that cannot be tied to one statement does nothing. Dragging, a linked-diagram click, and presentation mode behave as before.

## 1.2.1 "Atlas" - 2026-11-14

Patch on the Atlas line. The code name stays Atlas. The dashboard list of diagram findings is quieter and starts closed.

### Diagram checks

From #68 (#67). The panel that was titled **Workspace problems** is now **Diagram checks**. It is closed the first time you visit, and this browser remembers whether you left it open, including when you change folders and when you reload. The closed row already shows the result: a green check when every diagram looks good, an amber count of warnings, or a red count when a diagram has an error. While the check is running it says **Checking diagrams…**. The check runs once when the dashboard opens. It does not keep asking. Opening the panel shows a short explanation and the findings, grouped by diagram, with a link to each line. **Repair links** still opens from a broken diagram link. The checks themselves, and the **Parse error** and **Front matter** badges on thumbnails, are unchanged. A workspace with nothing to report looks neutral.

## 1.2.0 "Atlas" - 2026-11-14

Minor release on the Atlas line. The code name stays Atlas. This adds a Support button and a fuller About panel, a read-only compare of revisions with named baselines, and find and replace across the workspace.

### Support and About

From #63 (#58). A **Support** button in the header opens Ko-fi in a new tab. At a narrow width it collapses to the cup icon, and presentation mode does not show it. **About NerdGram1337**, from the sidebar and the command palette, shows the logo, a one-line description, the version and code name, the install type, the commit when one is known, author and help links, the MIT license, the update status, and **Support on Ko-fi**. The update controls that were already in that panel stay there. Nothing donation-related opens on its own.

### Compare and baselines

From #64 (#61). History can show what changed, and a revision can be kept as a named baseline. Name, rename, or remove a baseline on any revision. **Save baseline** stores the current diagram even when it has not changed since the last save. Names, notes, and the time they were named stay in the revision index. Named baselines are not dropped by the 20-revision prune. Each diagram keeps up to 20 (`NERDGRAM_BASELINE_CAP`, default 20, a whole number from 1 to 200). At the limit the API refuses another one and says how many are allowed. Removing a name puts that revision back under the 20-revision limit. Baselines follow rename, move, and trash, and a permanent delete removes them. A duplicate still starts with no history.

Every diagram type gets a text diff, including front matter. Flowcharts also get a node and edge diff: adds, removes, relabels, duplicate edges, arrow and style changes, subgraph moves, and click changes. **Compare** is read-only. It draws a merged diagram (added green, removed red and dashed, changed amber, unchanged dimmed), plus side-by-side and text views, a legend, and a change summary. **Present** shows the same picture full screen. The Compare view uses high-contrast label text on the colored diff nodes. The diagram file is never modified. The picture can be exported as SVG, PNG, JPG, or PDF, and the summary as Markdown. `GET /api/history/diff` and `POST`, `PATCH`, and `DELETE /api/history/baseline` are also on `/api/v1`. `nerdgram diff` and `nerdgram baseline` call them.

### Find and replace

From #65 (#62). Workspace find and replace previews a change across diagrams, then saves each selected file through the existing revision path, so every changed file gets a revision first. The editor find bar still applies only to the open diagram. **Replace in all diagrams…** on that bar, **Replace across…** on the dashboard, and **Replace across diagrams…** in the command palette open the same dialog. Scope is all diagrams (the default), the current folder with or without subfolders, or the diagrams left checked in the preview. Options match the editor: match case, whole word, regular expressions with `$1`, and body only (the default) or body plus front matter. Hidden files, `.meta`, trash, and templates are never changed.

The preview shows each match with the line before and after, totals, and a lint check. You can leave out a file or a single match. A diagram that would not parse, or that gains a new error, starts unchecked. A file open in an editor, and a file whose hash changed since the preview, are skipped and reported. **Undo this replace** restores the batch and skips any file edited since. `POST /api/replace/preview`, `POST /api/replace/apply`, and `POST /api/replace/undo` are also on `/api/v1`. `nerdgram replace` prints the preview. `--dry-run` is that preview, `--yes` applies it, and `--undo` restores an operation. `--folder` limits the scope, `--no-recursive` stays in that folder, and `--front-matter` includes the YAML block.

## 1.1.5 "Atlas" - 2026-11-14

Maintenance release on the Atlas line. The code name stays Atlas. This ships the work 1.1.0 left open: neighbor import, link repair, lint for more diagram types, data files that follow a generated diagram, and the npm package.

### Diagrams from data

Phase 2 of #36. **From data** accepts Cisco CDP (`show cdp neighbors detail` on IOS, IOS-XE, and NX-OS) and vendor-agnostic LLDP neighbor detail. LLDP is one parser over the standard TLVs, including Linux `lldpctl` text, keyvalue, and JSON. Links seen from both ends become one edge, interface names are normalized, and devices can be grouped by platform or capability. The raw output is stored next to the diagram (`.cdp` or `.lldp`) and **Refresh from data** parses it again. Sample output is in `docs/samples/neighbors/`.

### Link repair

From #44. A rename or move made outside the app (the file manager, `git mv`, or a GitHub sync pull) leaves `click` links on the old path. **Repair links**, on the dashboard warnings list and on a broken-link warning, previews every rewrite and saves them on confirmation. A match is one missing path and one new file from the same gap, by content hash, or by file name when the hash does not decide. Two equal matches are shown and left unchanged. Nothing is written on a preview. `GET /api/v1/link-repairs` and `nerdgram repair-links` preview. `POST /api/v1/link-repairs` with `{"dryRun":false,"confirm":true}` and `nerdgram repair-links --apply` write those saves, including revision history.

### Diagram checks

From #45. Class diagrams warn when the same class is defined again with a different label, and when a relationship names a class that was never declared once any class is declared. A diagram made only of relationships is left alone. ER diagrams warn about a repeated attribute and a relationship to an entity that was never declared once any entity is declared. Gantt charts warn about a task that depends on an unknown id, and about a date that does not match `dateFormat` or is not a real calendar date. Mindmaps and timelines warn about an empty node and a repeated sibling. A quick fix can rename the duplicate class, declare the missing class or entity, remove the extra attribute, or remove the empty or repeated node. The same checks run in the editor, `POST /api/lint`, `/api/v1/lint`, and `nerdgram lint`. A sequence return arrow (`-->>`) is read as the arrow, so a name such as `Mermaid.js` is not reported as unlabeled.

### Data files follow the diagram

From #46. Renaming, moving, copying, or deleting a generated diagram also handles the CSV, JSON, CDP, or LLDP file that sits next to it, and updates `nerdgram.source` (including an edges file). A data file stored somewhere else stays put, and refresh keeps reading that path. Duplicate asks whether to copy the data file onto the new diagram or keep sharing the original. Sharing does not change the original file. Delete asks whether to move the data file to the trash with the diagram or leave it in the workspace. Restore brings a trashed data file back beside the diagram. The same choices are on `/api/v1` and `nerdgram rename`, `move`, `duplicate`, and `delete`. GitHub sync copies the files that remain after the move. **Repair links** also updates `nerdgram.source` when a rename outside the app moved the data file with the diagram.

### npm package

From #43. The CLI is installable from npm as the package `nerdgram1337`. The command name stays `nerdgram`. Install it with `npm install -g nerdgram1337`, or run `npx nerdgram1337 --help`. A `vX.Y.Z` tag publishes that package when the `NPM_TOKEN` repository secret is set, and refuses when the tag does not match `cli/package.json`. If the secret is missing, the release warns and the GitHub Release still goes out.

## 1.1.0 "Atlas" - 2026-11-13

First minor release on the Atlas line. The code name stays Atlas. This adds the v1.1 features and the fixes from a fresh-clone smoke test of main at `2ee2952`.

### Diagram checks

From #39 (#38, #34). The editor underlines a Mermaid syntax error on the line and column the parser stopped at, and it keeps the last diagram that rendered, marked out of date. Optional warnings cover duplicate ids, unconnected flowchart nodes, unlabeled endpoints, unused and undefined classes, front matter, and a `click` link to a diagram that is not in the workspace. A quick fix can rename a duplicate id, remove an unused class, create a missing class, or jump to the first definition. `nerdgram lint`, `POST /api/lint`, and `/api/v1/lint` run the same checks. A syntax error is an error diagnostic with that line number, and `nerdgram lint` exits non-zero. `nerdgram render` reports the same line, not the caret line in Mermaid's message.

### Linked diagrams

From #40 (#35). A Mermaid `click` line opens another diagram in the preview and in presentation. The trail keeps Back and Forward. Renaming or moving a diagram inside the app rewrites `click` targets that point at it. A real pointer click in presentation drills down. Panning still starts once the pointer moves.

### Diagrams from data

Phase 1 of #36, from #41. A CSV or JSON file can create a flowchart. Refresh from data shows nodes and edges added, removed, and changed before it rewrites the generated block. Text outside `%% nerdgram:generated` stays. The sample files are `docs/samples/campus-links.csv` and `docs/samples/campus.json`.

### Automation

From #42 (#37). `/api/v1` takes a bearer token for list, search, get, put, export, lint, generate, refresh, and render. `nerdgram` runs those commands. Render and lint of a file on disk do not need a server. Revoking a token asks first.

### Fixes from the smoke test

- The image seeds every bundled sample, including subfolders. `WAN.mmd` and `Sites/Atlanta.mmd` are in the image and in an empty data directory. A test fails if a new `.mmd` file under `diagrams/` is left out of the Docker context.
- Dashboard thumbnails draw diagrams that contain `click` lines. Mermaid's `xlink:href` is given the xlink namespace so the picture is valid XML when the browser draws it as an image.
- The Refresh from data dialog uses dark text on its white background. The editor header Commands button and the Edit info button use light text on the dark header. Both meet WCAG AA.
- The out-of-date mark sits above the preview instead of covering the diagram.
- Building from source says that Docker BuildKit is required, and how to turn it on. A local Compose build is tagged `nerdgram1337:local`. `docker compose pull` still uses `ghcr.io/networknerd1337/nerdgram1337:v1.1.0`.
- The code editor's accessible name is on the editable text. Automation tokens and diagram checks are in the sidebar, not only under the GitHub sync page.

### Not in this release

- #36 phase 2 (CDP and LLDP neighbor import) is not in 1.1.0.
- #43: publishing the `nerdgram` package to npm.
- #44: repairing `click` links after a rename or move made outside the app.
- #45: lint rules for diagram types other than flowchart, sequence, and state.
- #46: moving or copying a generated diagram's data file when the diagram is moved, duplicated, or deleted.

## 1.0.6 "Atlas" - 2026-11-13

Patch on the Atlas line. The code name stays Atlas. These fixes come from the v1.0.5 release run and a fresh-user smoke test.

- The Docker publish workflow no longer fails the release when it cannot mark the GHCR package public. `PATCH /user/packages/container/nerdgram1337` returns HTTP 404, the image push itself succeeds, and anonymous pulls already work. The step now prints a warning and leaves the job green. Set the package to Public once in the package settings.
- GitHub Releases use only the CHANGELOG section. The release workflow turns off generated release notes, so GitHub does not append its own "What's Changed" list.
- The Docker quick start pulls `ghcr.io/networknerd1337/nerdgram1337`. The current tag is on the Releases page, and `:latest` is the newest full release. Building from a clone is the alternative. The old "no image until the tag is pushed" wording is gone from the README and from `compose.yaml`.
- Placeholders such as `<data>` and `<repo>` are written in code formatting, and the README explains those names once, so GitHub does not hide them as HTML tags.
- The bundled Mermaid syntax reference points Getting Started at `https://mermaid.js.org/intro/getting-started.html`, including the initialize-call anchor, and points the other short diagram links that 404 (`flowchart`, `sequenceDiagram`, `stateDiagram`, `pie`, `sankey`) at the current `/syntax/` pages. A reference sync rewrites those retired URLs if upstream still emits them.
- An editor lock still expires 90 seconds after its last heartbeat, and the open editor keeps refreshing it. Leaving the page releases the lock with `navigator.sendBeacon`, with a keepalive request if the beacon is refused, so a navigation that aborts `POST /api/lock/release` does not leave the lock behind. If a lock is left anyway, the read-only banner offers **Take over editing**. After confirmation, that call replaces the lock only once it is stale. A second window that is still heartbeating keeps the lock.

## 1.0.5 "Atlas" - 2026-11-13

First release of NerdGram1337. Atlas is the code name for the whole 1.x line. Diagrams are `.mmd` files on this computer. The app is a local, single-user tool: there is no account and no login.

### Highlights

- A dashboard and an editor for Mermaid diagrams, with three sample diagrams the first time a data directory is empty.
- Delete moves a diagram or folder to trash. The last 20 revisions of a file are kept, and an autosave will not overwrite a copy that changed on disk.
- Move, duplicate, and import sit next to that. Search covers names and the text inside a diagram. Presentation is a full-screen, read-only view.
- Optional GitHub sync copies `.mmd` files to a private repository you create with your own OAuth app. An in-app update check reads the public GitHub Releases for this project.
- The same version is in `package.json`, the About line, and the container image `ghcr.io/networknerd1337/nerdgram1337:v1.0.5`.

### Security

The API listens on `127.0.0.1` and `::1` when `HOST` is unset. If IPv6 loopback is unavailable, IPv4 loopback still serves (#15).

- Every request needs an allowed `Host` (`localhost`, `127.0.0.1`, or `::1`, plus any name in `NERDGRAM_ALLOWED_HOSTS`). Anything else is rejected.
- `POST`, `PUT`, `PATCH`, and `DELETE` have to be `Content-Type: application/json`. A browser form cannot set that.
- Those requests also check `Origin` and `Sec-Fetch-Site`. A page on another site is rejected. `curl` on this machine, which sends neither header, is allowed.
- `HOST=0.0.0.0` is for the container. The image sets it so Docker can publish the port, and the publish in `compose.yaml` is `127.0.0.1:8787:8787`. On the host, leave `HOST` unset.
- Server and client tests run in CI.

### Editing & files

Trash is a soft delete. Restore puts the file or folder back. Emptying trash is the permanent delete (#8).

- Each save keeps the previous contents. The last 20 revisions are kept, and you can restore one from the history dialog.
- Autosave sends the hash of the copy it loaded. If the file changed on disk, autosave pauses and asks you to keep yours unsaved, reload from disk, or overwrite with yours.
- An editor tab holds a lock on the open diagram so a second window does not write over it. The lock is not a login.

Move, duplicate, and import (#9):

- Move from the menu or by dragging onto a folder. A drop onto a diagram does nothing. A name that is already in the destination is not overwritten. Move to… can offer `Name (copy)` when you need a free name.
- Duplicate writes `Name (copy).mmd`, then `Name (copy 2).mmd`. The copy is not favorited, does not take the source lock, and starts with no revision history.
- Import reads `.mmd`, `.md`, and `.txt`, up to 512 KB each, 25 files at a time, and 3 MB of text in one request. When a name is taken you choose Skip, Rename, or Replace. Replace goes through the normal save, so a locked file stays put and the previous bytes become a revision.

### Diagrams & metadata

A diagram can start with Mermaid YAML front matter (#16).

- `title`, `config.theme`, `config.look`, and `config.layout` are Mermaid's own fields. Theme, look, and layout are also on the preview toolbar.
- Description, tags, and notes live under `nerdgram:` in that same block, so they stay in the `.mmd` file and Mermaid ignores them.
- Diagram info edits those fields in the editor.
- A legacy `%%{init}%%` or `%%{initialize}%%` directive can be moved into `config`. The directive's keys win where both set the same thing, which is how Mermaid already draws the diagram. Other front matter, including `nerdgram`, stays.

### Navigation & search

The dashboard keeps a thumbnail for each diagram under `.meta/thumbs/` and reuses it while the file is unchanged (#10). The open tab also keeps an in-memory copy.

- Find and replace, and go to line, use the editor search keys. Go to line is Ctrl+Alt+G (Ctrl+Option+G on a Mac). On Windows, AltGr can collide with that chord. See Known limitations.
- Ctrl+K (Cmd+K on a Mac) opens the command palette from the dashboard, the editor, and the other pages. It stays closed during presentation.

Search matches the file name, the path, the title, tags, the description, notes, and the visible labels in the diagram, and ranks a name match ahead of a label buried in the source (#13). The dashboard field and the command palette use the same search. Names only limits it to file and folder names.

### Presentation

Present opens the diagram full screen without saving it and without taking the editor lock (#18).

- Start with F5 or Ctrl+Shift+Enter (Cmd+Shift+Enter on a Mac) while a diagram is open and the cursor is not in a form field. F5 still reloads the page on the dashboard, the new-diagram page, and the reference. The command palette and the Present button on a card do the same thing.
- Esc leaves presentation. Zoom, pan, rotate, and fit are on the bar and on the keyboard. The bar hides until you move the pointer or press Tab.
- The view is read-only.

### Templates

The template gallery ships six starters: flowchart, sequence, network topology, home lab, rack elevation, and firewall policy (#17). Creating a diagram copies the starter into your folder as a normal `.mmd` file. The gallery files live in `templates/`, not in the data directory. Dropping another `.mmd` file in that folder adds it to the gallery. This release does not store templates you save yourself.

### GitHub sync

GitHub sync is optional (#14). NerdGram does not ship a client ID. You register an OAuth app in your own account, enable Device flow, and paste that client ID.

- The token is stored at `<data>/.meta/github-token` with mode `0600`, or taken from `NERDGRAM_GITHUB_TOKEN`. It is not sent to the browser and not written into the git remote URL.
- The git working copy is a hidden `.nerdgram-git` directory inside the data folder. The data directory itself is not a git repository.
- Synced files are the `.mmd` diagrams, plus a short README, `.gitignore`, and `.gitattributes` so the GitHub repository can be read on its own. `.meta`, templates, and the syntax reference stay on this computer.
- NerdGram does not force-push. If GitHub has commits this computer does not, you pull. When both copies changed, you choose Keep local, Keep both, or Use GitHub copy. An open editor is not overwritten.

### Updates & releases

About and the bottom of the sidebar show the running version and its code name, for example `v1.0.5 "Atlas"`. `GET /api/version` and `GET /api/health` return the same version, `codename`, commit when there is one, and how this copy was installed (#19).

- The update check calls the public GitHub Releases API for this repository. It sends no token and no telemetry. It reads the version from the release tag. The release title is not the version.
- When a newer stable release exists, the banner and the release dialog show that release's code name. The name comes from the major number (1 is Atlas, 2 is Meridian). A major that is not in the map is taken from a release title shaped like `vX.Y.Z "Name"`, and only when that title is that one safe phrase.
- On a clean git clone of this repository, on `main` or a detached release tag, Update now fetches the tag and fast-forwards only (`git merge --ff-only` on `main`). A tag that is not a fast-forward is refused. The check's "ahead" state means `package.json` is newer than the latest stable tag. It is not a count of extra commits.
- A Docker install is not changed from inside the container. About shows copyable pull, stop, remove, and run steps that keep the `nerdgram-data` volume and `127.0.0.1:8787:8787`.
- The root `package.json` version is the only version. `npm run version:sync` copies it into the client, the server, the lockfiles, the Dockerfile, and `compose.yaml`, and it copies the code name into the image build arg. Pushing the `vX.Y.Z` tag runs the release workflow and the image workflow.

### Docker

The container image runs the production server as uid 1001, user `nerdgram`, with a read-only root filesystem in Compose (#12).

- `compose.yaml` publishes `127.0.0.1:8787:8787` and mounts the named volume `nerdgram-data` at `/data`.
- An empty `/data` is seeded once from the image's `diagrams/` folder. The samples land at `/data/Welcome.mmd`, `/data/NetworkMap.mmd`, and `/data/Examples/Sequence.mmd`. A data directory that already has anything in it is left alone.
- The image tag matches the package version: `ghcr.io/networknerd1337/nerdgram1337:v1.0.5`. The workflow also pushes `:latest` and `sha-<commit>` when the `v1.0.5` tag is pushed. Pull requests do not push.
- CI builds the image and runs a smoke test: health, a write, uid 1001, and a diagram that is still there after a restart.
- The image records the version and the code name. `org.opencontainers.image.version` is the version, `org.opencontainers.image.codename` is the code name, and `NERDGRAM_CODENAME` is set in the container environment. The running app still reads the code name from `package.json`.

### Docs

The README is the install, security, and release-lifecycle guide (#11). Version numbers, the Atlas and Meridian code names, how to pin a release, and the steps to cut a tag are in Versioning and releases.

### Known limitations

- There is no store of templates you save yourself. The gallery is the files in `templates/`.
- The editor preview has theme, look, layout, and Present. It does not zoom. Zoom, pan, and rotate are in presentation.
- On Windows, AltGr is reported as Ctrl+Alt. On a layout where AltGr+G types a character, Ctrl+Alt+G can type that character instead of opening Go to line. Use Go to line in the command palette.
- The first image on GHCR may still be private if the publish workflow cannot mark the package public. Set that package to Public once in the GitHub package settings.
