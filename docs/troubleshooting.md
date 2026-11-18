# Troubleshooting

If the API port is taken, the server exits and prints the listen error.

[Back to the documentation index](README.md)

## Contents

- [Port already in use](#port-already-in-use)
- [Wrong Node.js version](#wrong-nodejs-version)
- [npm cannot find package.json](#npm-cannot-find-packagejson)
- [npm start cannot find server/dist/index.js](#npm-start-cannot-find-serverdistindexjs)
- [The page opens, but diagrams do not load](#the-page-opens-but-diagrams-do-not-load)
- [Can't read file](#cant-read-file)
- [A save returns 403 or 415](#a-save-returns-403-or-415)
- [The container exits immediately, or the volume looks empty](#the-container-exits-immediately-or-the-volume-looks-empty)
- [localhost opens the dev UI, and 127.0.0.1 does not](#localhost-opens-the-dev-ui-and-127001-does-not)
- [Corporate TLS inspection](#corporate-tls-inspection)

## Port already in use

If the API port is taken, the server exits and prints:

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:8787
```

A previous `npm run dev` or `npm start` is usually still running in another terminal. Switch to that terminal and press Ctrl+C, then start the app again. Do not run `npm run dev` and `npm start` at the same time. They both listen on 127.0.0.1 port 8787. A container published on that same host port collides with them too.

If Vite's port is taken, it does not exit. It prints:

```text
Port 5173 is in use, trying another one...
  ➜  Local:   http://localhost:5174/
```

Open the URL in that line. The API still has to be on port 8787, because the dev proxy forwards `/api` to `http://127.0.0.1:8787`. Saving a diagram from that fallback port needs the new origin on the allow-list. Stop the app, then start it again with `NERDGRAM_CORS_ORIGINS` set to the origin Vite printed. macOS or Linux: `NERDGRAM_CORS_ORIGINS=http://localhost:5174 npm run dev`. Command Prompt: `set NERDGRAM_CORS_ORIGINS=http://localhost:5174`. PowerShell: `$env:NERDGRAM_CORS_ORIGINS = "http://localhost:5174"`. Add `http://127.0.0.1:5174` in the same comma-separated list if you open the UI that way. Do not set a wildcard.

## Wrong Node.js version

Run `node -v` in the same terminal you use for `npm run dev`. It needs to be 20 or newer, and `npm -v` needs to be 10 or newer. If the commands are not found, or the numbers are too low, install Node.js 20+ from [https://nodejs.org/](https://nodejs.org/), then open a **new** terminal and check again. An old terminal can keep using the previous install. Docker uses the Node 22 image and does not use the host Node, except for the optional `node -p` in the build argument.

## `npm` cannot find `package.json`

```text
npm error enoent Could not read package.json
```

The terminal is not in the project root. `cd` into the folder from [Node.js](install.md#nodejs). `ls` or `dir` should show `package.json`, `client`, and `server` before you run npm.

## `npm start` cannot find `server/dist/index.js`

The production build has not been created. From the project root run `npm run build`, wait until it finishes, then run `npm start`.

## The page opens, but diagrams do not load

`npm run dev` has to keep both the `server` and `client` processes running. If you started only the client, the page has no API. Stop it, `cd` to the project root, and run `npm run dev`. Then check [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health). `"ok": true` means the API is up, and `dataDir` shows which folder it is reading. On the dev UI, keep using [http://localhost:5173](http://localhost:5173).

## Can't read file

A dashboard card or the editor says **Can't read file** when that diagram could not be read. The sentence under it is the reason. **Retry** reads the file again. **Parse error** is a different message: Mermaid could not draw the file. A lock names the other instance, the computer, and the time it was opened. A read error does not.

This often means the diagram folder is on iCloud Drive, OneDrive, Dropbox, or Google Drive, and the file is still a placeholder. Those folders are not supported for team locks. See [Synced folders](team-use.md#synced-folders).

## A save returns 403 or 415

**403** means the `Host` or `Origin` is not on the allow-list. **415** means a change was sent without `Content-Type: application/json`. The [curl example](security.md#security-model) has both headers. A Vite port other than 5173 needs `NERDGRAM_CORS_ORIGINS`. On a Node install, the machine's own IP is allowed after you save it as Host and start again, or when the bind is `0.0.0.0` or `::` and that IP was on an interface at startup. A DNS name still needs `NERDGRAM_ALLOWED_HOSTS`. In Docker, the published host address needs `NERDGRAM_ALLOWED_HOSTS` too.

## The container exits immediately, or the volume looks empty

A bind mount owned by root is not writable by uid 1001. `chown` it as in [Docker](install.md#docker). A named volume created by the image is already writable. A fresh volume receives the sample diagrams once, at `/data/Welcome.mmd`, `/data/NetworkMap.mmd`, `/data/Examples/Sequence.mmd`, `/data/WAN.mmd`, and `/data/Sites/Atlanta.mmd`, copied from the image's `diagrams/` folder. A volume that already has files is left as it is, including a volume where you deleted the samples.

## `localhost` opens the dev UI, and `127.0.0.1` does not

Vite is bound to `localhost`, which can be `::1` only. Use [http://localhost:5173](http://localhost:5173). The API is on both `127.0.0.1` and `::1` unless the log says `::1` failed.

## Corporate TLS inspection

Update checks and GitHub sync run inside the container. Both call GitHub over HTTPS from Node. A proxy that inspects TLS, such as Zscaler, re-signs that traffic with a corporate root CA. The host and Docker Desktop trust that CA. The container's Node does not, so the call fails before GitHub answers. **Check for updates** then says a proxy or TLS inspection on this network is likely intercepting HTTPS. GitHub sync fails for the same reason. On a network that does not inspect TLS, **Check for updates** reaches GitHub with no extra certificate.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. That turns certificate verification off. Add the corporate root instead.

### Export the corporate root as a PEM

Export the root that signed the proxy, not the certificate that carries GitHub's name. The file is text and starts with `-----BEGIN CERTIFICATE-----`. On Windows, open `certmgr.msc`, go to Trusted Root Certification Authorities, and export that root as Base-64 encoded X.509 (`.CER`). On macOS, export it from Keychain Access as a `.pem`. Several certificates can sit in the same file, one after another.

### Mount the file and point Node at it

The path inside the container in these examples is `/certs/corp-root.pem`. The mount is read-only. `NODE_EXTRA_CA_CERTS` is that path. Node adds those certificates to the public CAs it already trusts. It does not replace them. [`compose.yaml`](../compose.yaml) sets a read-only root filesystem. That does not block this mount.

`docker run`. The image tag is the one from [Install](install.md#docker).

```bash
docker run -d \
  --name nerdgram1337 \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e NERDGRAM_DATA_DIR=/data \
  -e NERDGRAM_INSTALL=docker \
  -e NODE_EXTRA_CA_CERTS=/certs/corp-root.pem \
  -v nerdgram-data:/data \
  -v /path/to/corp-root.pem:/certs/corp-root.pem:ro \
  ghcr.io/networknerd1337/nerdgram1337:v1.8.5
```

On Docker Desktop for Windows the host path is a Windows path, for example `-v C:\certs\corp-root.pem:/certs/corp-root.pem:ro`.

Compose. Add the variable and the mount to the `nerdgram` service in [`compose.yaml`](../compose.yaml). Leave the image tag that file already pins.

```yaml
services:
  nerdgram:
    environment:
      NODE_EXTRA_CA_CERTS: /certs/corp-root.pem
    volumes:
      - nerdgram-data:/data
      - /path/to/corp-root.pem:/certs/corp-root.pem:ro
```

Recreate the container after the change (`docker compose up -d`, or the `docker run` above if that is how you started it). **Check for updates** should then reach GitHub.

A Node install on the host needs the same variable. Node does not read the Windows certificate store. Set it in that shell before `npm start`. macOS or Linux: `NODE_EXTRA_CA_CERTS=/path/to/corp-root.pem npm start`. Command Prompt: `set NODE_EXTRA_CA_CERTS=C:\certs\corp-root.pem`. PowerShell: `$env:NODE_EXTRA_CA_CERTS = "C:\certs\corp-root.pem"`.

## See also

- [Install](install.md)
- [Configuration](configuration.md)
- [GitHub sync](github-sync.md)
- [Team use](team-use.md)
- [Security model](security.md)
