# Security model

NerdGram1337 is a local, single-user personal tool.

[Back to the documentation index](README.md)

## Principles

- NerdGram is a local, single-user tool, and having no login is a deliberate choice.
- Diagram, import, and template files and request parameters are treated as untrusted input. A crafted file must never escape the data folder, run a script in a rendered SVG, or hang the server.
- Your data stays in the data folder, and OS permissions are the access control.
- Opening the port beyond loopback is your choice, and NerdGram warns when it is open.
- Supply chain: Actions are pinned to SHAs, npm publishes through trusted publishing, and code owners review `.github/` and `package.json` changes.
- Dependabot and CodeQL run passively and only send alerts. Nothing changes the code automatically, and each finding is triaged: fixed in a release, or dismissed with a written reason.

NerdGram1337 is a local, single-user personal tool. It has no accounts and no login, by design. Diagrams are plain `.mmd` files. An in-app login would not protect anything the operating system does not already protect. Your OS account and the permissions on the data directory are the access control. Automation tokens, described in [Automation API](api.md#automation-api), apply only to `/api/v1`. They do not cover the browser routes.

The browser routes under `/api` have no token. That is on purpose: the page on this computer uses them. Any program already running as you can call `POST /api/tokens` and create a read-write automation token. A token stops other machines, and it stops a web page from another origin. It does not stop software that is already running as you on this computer.

NerdGram was built for one person on one machine. It was not designed as a client/server application, and it does not grow an account system when the port is reachable. The API is a tool port: other programs on a network you trust can ask for a diagram on demand. It is not an always-on service for many users. *DO NOT* forward port 8787 or 5173 from an ISP router. Know what a published port opens before you publish it.

**What the process binds to.** With `HOST` unset and no non-default Host setting saved, the API listens on `127.0.0.1` and then `::1` on the same port. If `::1` is unavailable, IPv4 loopback still serves, and the log says to use `http://127.0.0.1:<port>` when `localhost` does not open. Vite's dev server listens on `localhost` only. `HOST`, when set, wins over the Host saved in the instance config, and the settings page shows that override. A saved `127.0.0.1` is the default pair, not IPv4-only. A saved machine IP listens on that address only. `0.0.0.0` and `::` listen on every interface of that family. The log then notes that the bind is not loopback, that `/api` has no authentication, and that anyone who can reach the port can change your diagrams. That note is expected. It is there so you know what you opened.

The image sets `HOST=0.0.0.0` so Docker can publish the port. Publish `127.0.0.1:8787:8787` to keep the tool port on the host loopback. Publish `<lan-ip>:8787:8787` when another machine should call it. Publishing `8787:8787` opens every host interface. A bearer token on `/api/v1` does not protect `/api`. The Host box is read-only in Docker because the container env already chose the bind.

**Checks on every request.** The `Host` header has to be a name the server allows, including the API port (`192.168.1.10:8787` and `192.168.1.10` are the same name plus the port check). Loopback names are always allowed: `localhost`, `127.0.0.1`, and `::1`. A specific saved IP or `HOST` value is allowed as well. For `0.0.0.0` and `::`, the wildcard itself is not a Host name. NerdGram allows the machine's non-loopback interface addresses discovered at startup, so a caller can use those IPs without `NERDGRAM_ALLOWED_HOSTS`. Values in `NERDGRAM_ALLOWED_HOSTS` are merged in. A star, `0.0.0.0`, and `::` in that list are ignored. Any other `Host` is **403** (`Forbidden host`). That still blocks a public DNS name that points at your machine unless you add the name yourself. Inside Docker, discovery sees the container's interfaces. Add the host address callers use to `NERDGRAM_ALLOWED_HOSTS`.

Opening the UI on an address this process discovered, or on a saved Host, also allows that origin (`http://<address>:<port>`) for browser edits. A name added only in `NERDGRAM_ALLOWED_HOSTS` does not. In Docker that is the usual LAN case: the container cannot see the host's addresses, so `http://<lan-ip>:<port>` needs `NERDGRAM_CORS_ORIGINS` even though the origin host equals the published host. A different origin, including a DNS name, needs it on a Node install too. The steps are [Publish on a LAN](install.md#publish-on-a-lan). A browser page that fails the Host check gets an HTML 403. `/api` and MCP stay JSON. `curl` does not send `Origin`, so a token call only has to pass the Host check.

**Checks on changes.** `POST`, `PUT`, `PATCH`, and `DELETE` on `/api` and `/api/v1` require `Content-Type: application/json`. That includes `DELETE` and the POST routes that take no fields: `/api/trash/empty`, `/api/reference/sync`, `/api/sync/now`, `/api/sync/pull`, `/api/sync/device/start`, `/api/updates/check`, `/api/updates/skip`, `/api/updates/later`, and `/api/updates/apply`. Anything else, including a missing header or a browser form, is **415** with `{"error":"Content-Type must be application/json"}`. The curl examples include a JSON body. `{}` is enough when the path or id is already in the URL or the query string: `DELETE /api/item`, `DELETE /api/trash/item`, `DELETE /api/tokens/:id`, `POST /api/tokens/:id/delete`, `POST /api/tokens/clear-revoked`, and `DELETE /api/v1/diagrams`. `DELETE /api/item` and `DELETE /api/trash/item` answer **204**. `DELETE /api/tokens/:id` answers **200** and revokes the token. `POST /api/tokens/:id/delete` answers **200** when that token is already revoked, and **409** when it is still active. `POST /api/tokens/clear-revoked` answers **200** with the number removed. Neither delete route returns the token. Browsers also send `Origin` and `Sec-Fetch-Site`. The origin has to be the API itself (`http://127.0.0.1:8787`, `http://localhost:8787`, or `http://[::1]:8787`, on whatever `PORT` is). A saved Host, or the address this process is bound to, is also allowed when that address is another loopback address such as `127.0.0.2`. `http://127.0.0.3:8787` is not, unless that address is the saved or effective Host. In development, `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://[::1]:5173` are allowed too. `NERDGRAM_CORS_ORIGINS` adds explicit origins. It is not a wildcard. A foreign origin is **403**. `Sec-Fetch-Site` of `cross-site` is rejected unless that `Origin` is on the list. `same-origin`, `same-site`, and `none` are accepted. A local `curl` that sends neither `Origin` nor `Sec-Fetch-Site` is accepted. It still has to send `Content-Type: application/json`.

```bash
curl -fsS -X PUT "http://127.0.0.1:8787/api/file" \
  -H "Host: 127.0.0.1:8787" \
  -H "Origin: http://127.0.0.1:8787" \
  -H "Content-Type: application/json" \
  -d '{"path":"Notes.mmd","content":"flowchart LR\n  A --> B\n"}'

curl -fsS -X DELETE "http://127.0.0.1:8787/api/item?path=Notes.mmd" \
  -H "Host: 127.0.0.1:8787" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -fsS -X DELETE "http://127.0.0.1:8787/api/tokens/TOKEN_ID" \
  -H "Host: 127.0.0.1:8787" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Production does not enable cross-origin browser access, because the UI and the API are the same port. Development CORS allows only the origins listed above.

**MCP.** `/mcp` is streamable HTTP for an MCP client. It requires `Authorization: Bearer` and the automation token from Settings. A missing or unknown token is **401**. The call does not fall back to `/api`. The Host has to be loopback (`localhost`, `127.0.0.1`, another `127.x.x.x` address, or `::1`), even when `NERDGRAM_ALLOWED_HOSTS` would let that name through to `/api`. A missing Origin is allowed. An Origin that is present has to be loopback. Anything else is **403**. `nerdgram mcp` is a stdio proxy to `/api/v1` and uses the same token. MCP stores no new credential. The listen address and the Docker publish `127.0.0.1:8787:8787` are unchanged. The tool list is in [MCP server](mcp.md).

**Files.** Paths stay inside the data directory. The server rejects null bytes, hidden paths such as `.meta`, and any path that escapes that directory. Diagram writes must be `.mmd` files. A `click` link is checked with that same rule: `nerdgram:` and relative `.mmd` paths cannot leave the data directory, and `javascript:` is not opened. Editor locks only keep two windows from writing the same diagram.

**GitHub and updates.** The sync token is stored as described in [GitHub sync](github-sync.md#github-sync). Sync and **Update now** use the same Host, Origin, and JSON checks as other changes. Update checks call the public Releases API with no token. Treat the data directory, `.meta`, and `.nerdgram-git` as personal documents: use your OS permissions, and do not share that folder casually.

## Repository supply chain

Actions in `.github/workflows` are pinned to a full commit SHA, with the version in a comment on the same line. `node scripts/check-supply-chain.mjs` fails CI when a `uses:` line is not a 40-character SHA, and when any `package.json` adds a `preinstall`, `install`, or `postinstall` script. Checkout steps set `persist-credentials: false` because no job pushes with the checkout token. Each workflow starts at `contents: read`. The release job raises `contents: write` to publish the GitHub Release. The npm job raises `id-token: write` for provenance. The Docker publish job raises `packages: write` to push the image. Dependabot opens a weekly pull request for Actions and one grouped pull request per npm directory (root, client, server). `.github/CODEOWNERS` names `@NetworkNerd1337` for `.github/` and the four `package.json` files.

The npm publish tries [trusted publishing](https://docs.npmjs.com/trusted-publishers) first. The job's `id-token: write` permission lets npm mint the OIDC token. `NODE_AUTH_TOKEN` is unset for that attempt, and any project `.npmrc` from setup-node is removed so a stored token cannot hide the OIDC path. The job logs `Published nerdgram1337 with npm trusted publishing (OIDC).` If that publish fails and `NPM_TOKEN` is set, the job logs the fallback and publishes with the token. If both fail, the npm job fails. The GitHub Release job is separate. After a trusted publish succeeds, delete the `NPM_TOKEN` repository secret.

These are the owner settings. The files in the repo do not turn them on.

- **Ruleset on `main`.** Require a pull request before merging. Require the **verify** and **docker** checks. Block force pushes. Require a review from code owners so a change under `.github/` or to a `package.json` needs the maintainer.
- **Actions.** Require approval before a workflow runs from an outside collaborator. That setting is under Settings, Actions, General.
- **Secret scanning and push protection.** Turn both on under Settings, Code security. Push protection stops a commit that contains a token.
- **CodeQL.** Default setup is on under Settings, Code security. Copilot Autofix is off. CodeQL sends alerts and does not change the code. Each finding is fixed in a release or dismissed with a written reason.
- **npm trusted publisher.** This is already set on npmjs.com for `nerdgram1337`: GitHub Actions, owner `NetworkNerd1337`, repository `nerdgram1337`, workflow `release.yml`, environment empty. The publish job tries that OIDC path first. `NPM_TOKEN` is only the fallback when that publish fails. After a trusted publish succeeds, delete the `NPM_TOKEN` repository secret.

## See also

- [Security policy](../SECURITY.md)
- [Configuration](configuration.md)
- [Automation API](api.md)
- [MCP server](mcp.md)
- [GitHub sync](github-sync.md)
