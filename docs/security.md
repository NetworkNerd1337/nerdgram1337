# Security model

NerdGram1337 is a local, single-user personal tool.

[Back to the documentation index](README.md)

NerdGram1337 is a local, single-user personal tool. It has no accounts and no login, by design. Diagrams are plain `.mmd` files. An in-app login would not protect anything the operating system does not already protect. Your OS account and the permissions on the data directory are the access control. Automation tokens, described in [Automation API](api.md#automation-api), apply only to `/api/v1`. They do not cover the browser routes.

NerdGram was built for one person on one machine. It was not designed as a client/server application, and it does not grow an account system when the port is reachable. The API is a tool port: other programs on a network you trust can ask for a diagram on demand. It is not an always-on service for many users. *DO NOT* forward port 8787 or 5173 from an ISP router. Know what a published port opens before you publish it.

**What the process binds to.** With `HOST` unset and no non-default Host setting saved, the API listens on `127.0.0.1` and then `::1` on the same port. If `::1` is unavailable, IPv4 loopback still serves, and the log says to use `http://127.0.0.1:<port>` when `localhost` does not open. Vite's dev server listens on `localhost` only. `HOST`, when set, wins over the Host saved in the instance config, and the settings page shows that override. A saved `127.0.0.1` is the default pair, not IPv4-only. A saved machine IP listens on that address only. `0.0.0.0` and `::` listen on every interface of that family. The log then notes that the bind is not loopback, that `/api` has no authentication, and that anyone who can reach the port can change your diagrams. That note is expected. It is there so you know what you opened.

The image sets `HOST=0.0.0.0` so Docker can publish the port. Publish `127.0.0.1:8787:8787` to keep the tool port on the host loopback. Publish `<lan-ip>:8787:8787` when another machine should call it. Publishing `8787:8787` opens every host interface. A bearer token on `/api/v1` does not protect `/api`. The Host box is read-only in Docker because the container env already chose the bind.

**Checks on every request.** The `Host` header has to be a name the server allows, including the API port (`192.168.1.10:8787` and `192.168.1.10` are the same name plus the port check). Loopback names are always allowed: `localhost`, `127.0.0.1`, and `::1`. A specific saved IP or `HOST` value is allowed as well. For `0.0.0.0` and `::`, the wildcard itself is not a Host name. NerdGram allows the machine's non-loopback interface addresses discovered at startup, so a caller can use those IPs without `NERDGRAM_ALLOWED_HOSTS`. Values in `NERDGRAM_ALLOWED_HOSTS` are merged in. A star, `0.0.0.0`, and `::` in that list are ignored. Any other `Host` is **403** (`Forbidden host`). That still blocks a public DNS name that points at your machine unless you add the name yourself. Inside Docker, discovery sees the container's interfaces. Add the host address callers use to `NERDGRAM_ALLOWED_HOSTS`.

Opening the UI on an allowed non-loopback address also allows that origin (`http://<address>:<port>`) for browser edits. A different origin, including a DNS name, still needs `NERDGRAM_CORS_ORIGINS`. `curl` does not send `Origin`, so a token call only has to pass the Host check.

**Checks on changes.** `POST`, `PUT`, `PATCH`, and `DELETE` on `/api` and `/api/v1` require `Content-Type: application/json`. That includes `DELETE` and the POST routes that take no fields: `/api/trash/empty`, `/api/reference/sync`, `/api/sync/now`, `/api/sync/pull`, `/api/sync/device/start`, `/api/updates/check`, `/api/updates/skip`, `/api/updates/later`, and `/api/updates/apply`. Anything else, including a missing header or a browser form, is **415** with `{"error":"Content-Type must be application/json"}`. The curl examples include a JSON body. `{}` is enough when the path or id is already in the URL or the query string: `DELETE /api/item`, `DELETE /api/trash/item`, `DELETE /api/tokens/:id`, and `DELETE /api/v1/diagrams`. `DELETE /api/item` and `DELETE /api/trash/item` answer **204**. `DELETE /api/tokens/:id` answers **200**. Browsers also send `Origin` and `Sec-Fetch-Site`. The origin has to be the API itself (`http://127.0.0.1:8787`, `http://localhost:8787`, or `http://[::1]:8787`, on whatever `PORT` is). A saved Host, or the address this process is bound to, is also allowed when that address is another loopback address such as `127.0.0.2`. `http://127.0.0.3:8787` is not, unless that address is the saved or effective Host. In development, `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://[::1]:5173` are allowed too. `NERDGRAM_CORS_ORIGINS` adds explicit origins. It is not a wildcard. A foreign origin is **403**. `Sec-Fetch-Site` of `cross-site` is rejected unless that `Origin` is on the list. `same-origin`, `same-site`, and `none` are accepted. A local `curl` that sends neither `Origin` nor `Sec-Fetch-Site` is accepted. It still has to send `Content-Type: application/json`.

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

**Files.** Paths stay inside the data directory. The server rejects null bytes, hidden paths such as `.meta`, and any path that escapes that directory. Diagram writes must be `.mmd` files. A `click` link is checked with that same rule: `nerdgram:` and relative `.mmd` paths cannot leave the data directory, and `javascript:` is not opened. Editor locks only keep two windows from writing the same diagram.

**GitHub and updates.** The sync token is stored as described in [GitHub sync](github-sync.md#github-sync). Sync and **Update now** use the same Host, Origin, and JSON checks as other changes. Update checks call the public Releases API with no token. Treat the data directory, `.meta`, and `.nerdgram-git` as personal documents: use your OS permissions, and do not share that folder casually.

## See also

- [Configuration](configuration.md)
- [Automation API](api.md)
- [GitHub sync](github-sync.md)
