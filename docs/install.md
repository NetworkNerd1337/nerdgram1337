# Install

Run NerdGram with Docker, or with Node.js on the machine.

[Back to the documentation index](README.md)

## Quick start

Run NerdGram with Docker, or with Node.js on the machine. Docker is the install to use when you want the app. Node.js is how you develop it, and it is also a full install when you do not want Docker. Use one of them at a time. Development and production both want port **8787**.

The app is for you, on your personal machine. It is a single-user tool, not a client/server product. The API is a tool port: a conduit other programs can call on demand, not an always-on multi-user server. The [security model](security.md#security-model) is why every Docker command below publishes `127.0.0.1:8787:8787`, and why a Node install leaves `HOST` unset unless you want that tool port on the local network.

The Docker `pull` and `run` commands in this file use `v2.1.24`. That is `v` plus the `version` in the root `package.json`, and it is the tag [`compose.yaml`](../compose.yaml) pins. GHCR keeps that tag and `:latest`. The previous release stays published for 30 days after it is deprecated, then its tag is removed. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Pull `:latest` or `v2.1.24`. [`npm run version:check`](releases.md#versioning-and-releases) fails if an image pin in the README or the docs, the Dockerfile, or `compose.yaml` disagrees with `package.json`. The names of planned releases are listed under [Versioning and releases](releases.md#versioning-and-releases).

### Docker

You do not need Node.js, and you do not need to clone this repository, to run the published image. The image is Node.js 22 on Debian bookworm-slim (`node:22.23.5-bookworm-slim`), pinned by digest in the `NODE_IMAGE` argument of the [Dockerfile](../Dockerfile). SVG and PNG use a headless browser. linux/amd64 uses Puppeteer's chrome-headless-shell, the same shell a Node install downloads. linux/arm64 uses Debian's `chromium` package. Chrome for Testing does not publish a linux-arm64 headless shell, and the shell Puppeteer would download on that architecture is an x86-64 binary that cannot start. The arm64 image sets `PUPPETEER_EXECUTABLE_PATH` to `/usr/lib/chromium/chromium`. The process inside the container listens on `0.0.0.0` so Docker can publish the port. The image sets `HOST=0.0.0.0`, which wins over the saved Host setting, so the Settings page shows that box as read-only. The log notes that `0.0.0.0` is not loopback. That note is expected. On the host, publish **`127.0.0.1:8787:8787`** to keep the tool port on this machine. Publish **`<lan-ip>:8787:8787`** when another machine on that network should call the API. Publishing `8787:8787` or `0.0.0.0:8787` opens every host interface. The browser `/api` routes have no token, so anyone who can open the published port can use them. The container does not see the host's LAN addresses. Set `NERDGRAM_ALLOWED_HOSTS` to the address callers use, or those requests are **403**. See [Security model](security.md#security-model).

The image is `ghcr.io/networknerd1337/nerdgram1337`. GHCR keeps the latest release tag and `:latest`. The previous release's tag stays for 30 days after it is deprecated, then it is removed. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Git tags stay, and a git checkout can still use one. [`compose.yaml`](../compose.yaml) pins the tag that matches this tree. [`npm run version:check`](releases.md#versioning-and-releases) fails if an image pin in the README or the docs, the Dockerfile, or `compose.yaml` disagrees with `package.json`.

The package is public, so `docker pull` does not need a login. If a new package is still private, set **Public** once in the [package settings](https://github.com/users/NetworkNerd1337/packages/container/nerdgram1337/settings). The publish workflow warns when it cannot do that, and a successful image push still leaves the workflow green. See [Cutting a release](releases.md#cutting-a-release).

**1. Install Docker.** Install Docker Engine and the Compose plugin from [Docker's documentation](https://docs.docker.com/get-docker/). `docker version` and `docker compose version` should both print a version.

**2. Pull the image.** The command uses `v2.1.24`, the tag for this tree (the same pin as [`compose.yaml`](../compose.yaml)). `:latest` is that same release until the next one is published. The previous release's tag stays for 30 days after it is deprecated. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term.

```bash
docker pull ghcr.io/networknerd1337/nerdgram1337:v2.1.24
```

```bash
docker pull ghcr.io/networknerd1337/nerdgram1337:latest
```

**3. Start the container.** The named volume `nerdgram-data` is the whole workspace. One container per volume. Use the tag you pulled. If you pulled `:latest`, put that name on the last line instead.

```bash
docker run -d \
  --name nerdgram1337 \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e NERDGRAM_DATA_DIR=/data \
  -e NERDGRAM_INSTALL=docker \
  -v nerdgram-data:/data \
  ghcr.io/networknerd1337/nerdgram1337:v2.1.24
```

**About → Show upgrade steps** prints the run command with the real tag, the container name `nerdgram1337`, the volume `nerdgram-data`, and `127.0.0.1:8787:8787`. Updating an install you already have is [Update a Docker install](upgrading.md#update-a-docker-install).

**4. Open the app.** [http://127.0.0.1:8787](http://127.0.0.1:8787) or [http://localhost:8787](http://localhost:8787). The health check is [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health). `installKind` is `docker`, and `dataDir` is `/data`.

**Unsupported.** A data folder in iCloud Drive, Dropbox, OneDrive, Google Drive, or any other cloud-synced or on-demand folder is not supported. Cloud-only placeholder files cannot be downloaded through a Docker bind mount, so reads fail. Use a local folder, the named Docker volume `nerdgram-data`, or an SMB or NFS share.

The container runs as uid **1001**, gid **1001** (user `nerdgram`). A new named volume is writable by that user. A bind mount needs:

```bash
sudo chown -R 1001:1001 /path/to/nerdgram-data
```

If the directory is owned by root, the container stays up. The log says the data folder is not writable and names `chown` to `1001:1001`. `GET /api/health` is still ok, and its data report is degraded. Saves are refused. `nerdgram doctor` inside the container exits 2. Nothing is written into that mount. A shared sync folder can leave an empty or unreadable file. Startup still opens the app, copies that settings or history file under `/data/.meta/quarantine`, and shows the problem in the banner and in **Settings → Data folder**. `GET /api/doctor` is the same report. Share diagrams across machines with [GitHub sync](github-sync.md) instead. The instance name is stored at `/data/.meta/instance.json`, so recreating the container keeps it. An empty data directory is seeded once from the image's `diagrams/` folder. With `NERDGRAM_DATA_DIR=/data` the samples land at `/data/Welcome.mmd`, `/data/NetworkMap.mmd`, `/data/Examples/Sequence.mmd`, `/data/WAN.mmd`, and `/data/Sites/Atlanta.mmd`. The log says `Seeded empty data directory with the sample diagrams.` A directory that already has any entry is left alone.

`templates/` and `reference/` are in the image, not on the volume. With `NERDGRAM_DATA_DIR` set, a syntax-reference sync writes under `/data/.meta/reference` and survives a new container. Templates stay the ones in the image.

The published host port has to equal `PORT` inside the container (the image sets `8787`). The browser sends that port in the `Host` header. To use another port, set `PORT` in the container and publish `127.0.0.1:THAT:THAT`.

**Docker Compose.** [`compose.yaml`](../compose.yaml) is the same install as the `docker run` above, plus a read-only root filesystem, a `tmpfs` on `/tmp`, and `no-new-privileges`. The sample below matches that file and is pinned to this tree's tag. Building from a checkout uses [`compose.build.yaml`](../compose.build.yaml) instead of changing this image line. That override is described under [Build from this repository instead](#docker).

```yaml
name: nerdgram1337

services:
  nerdgram:
    image: ghcr.io/networknerd1337/nerdgram1337:v2.1.24
    container_name: nerdgram1337
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    ports:
      - "127.0.0.1:8787:8787"
    environment:
      NERDGRAM_DATA_DIR: /data
      NERDGRAM_INSTALL: docker
      NERDGRAM_GITHUB_CLIENT_ID: ${NERDGRAM_GITHUB_CLIENT_ID:-}
      NERDGRAM_GITHUB_TOKEN: ${NERDGRAM_GITHUB_TOKEN:-}
      NERDGRAM_ALLOWED_HOSTS: ${NERDGRAM_ALLOWED_HOSTS:-}
      NERDGRAM_CORS_ORIGINS: ${NERDGRAM_CORS_ORIGINS:-}
    volumes:
      - nerdgram-data:/data

volumes:
  nerdgram-data:
    name: nerdgram-data
```

| Key or variable | What it does |
| --- | --- |
| `name` | The Compose project name. It keeps this stack separate from other projects. |
| `image` | The published image. `v2.1.24` is this tree's tag and does not move. `:latest` is the newest full release and changes when a release is published. |
| `container_name` | The container is always `nerdgram1337`, so `docker logs nerdgram1337` finds it. |
| `restart` | `unless-stopped` starts the container again after a reboot, until you stop it yourself. |
| `read_only` | The container's own filesystem cannot be written. Diagrams live on the volume, not in the image. |
| `tmpfs: /tmp` | A small writable `/tmp` in memory, because the root filesystem is read-only. |
| `security_opt` | `no-new-privileges` stops a process in the container from gaining extra privileges. |
| `ports` | `127.0.0.1:8787:8787` publishes the tool port on this machine only. Use `<lan-ip>:8787:8787` when another machine on that network should call the API. Do not publish `8787:8787`. The browser routes have no token. |
| `NERDGRAM_DATA_DIR` | Where diagrams are stored inside the container. Keep this `/data`, the path the volume is mounted on. |
| `NERDGRAM_INSTALL` | `docker` tells the app this is a container, so **Update now** prints Docker steps instead of running git. |
| `NERDGRAM_GITHUB_CLIENT_ID` | Optional GitHub OAuth client id for GitHub sync. An empty value is unset. |
| `NERDGRAM_GITHUB_TOKEN` | Optional GitHub token for sync. The token file inside the volume is `/data/.meta/github-token`. An empty value is unset. |
| `NERDGRAM_ALLOWED_HOSTS` | Extra hostname or address callers use. A LAN publish needs the host's address here, because the container cannot see the host's interfaces. |
| `NERDGRAM_CORS_ORIGINS` | Origin allowed for browser saves. Required for a Docker LAN address, including `http://<lan-ip>:8787`, because `NERDGRAM_ALLOWED_HOSTS` does not add an origin. Also required when the origin is a different name. See [Publish on a LAN](#publish-on-a-lan). |
| `nerdgram-data` | The named volume. Compose and `docker run` both use the name `nerdgram-data`. Keep it mounted on `/data`. |

### Publish on a LAN

Keep the published port on one address. Anyone who can open that port can use the app. There is no login.

1. Publish `<lan-ip>:8787:8787`. Do not publish `8787:8787` or `0.0.0.0:8787`.
2. Set `NERDGRAM_ALLOWED_HOSTS` to that same IP. The container cannot see the host's network addresses, so a request whose `Host` is the LAN IP is **403** until this is set. A browser page request then shows a short HTML page naming that host. `/api`, MCP, and any request that does not ask for HTML still get `{"error":"Forbidden host"}`.
3. Set `NERDGRAM_CORS_ORIGINS` to `http://<lan-ip>:8787`. This is required for saves from that address. It is not optional when the origin equals the published host: a name added only in `NERDGRAM_ALLOWED_HOSTS` passes the Host check and does not become an allowed origin. A Node install that saves that IP as Host, or that binds `0.0.0.0` and discovers the address, does allow `http://<that-ip>:<port>` without this variable. A DNS name still needs both variables on either install.
4. Run `docker compose up -d`.

```yaml
ports:
  - "<lan-ip>:8787:8787"
environment:
  NERDGRAM_ALLOWED_HOSTS: "<lan-ip>"
  NERDGRAM_CORS_ORIGINS: "http://<lan-ip>:8787"
```

The same two lines can live in `.env` next to `compose.yaml` when the compose file already interpolates them. The blocked-address page fills in the host and port from the request so those lines can be copied as they are.

There is no environment variable for the automation token. Create that in Settings. It is stored as a hash under `/data`. MCP uses the same token. Do not put it in the compose file.

Optional values can live in a `.env` file next to `compose.yaml`. Compose reads `${NERDGRAM_GITHUB_TOKEN:-}` from that file. The file is gitignored. Use placeholders, and do not commit a real token:

```text
NERDGRAM_GITHUB_CLIENT_ID=your-github-oauth-client-id
NERDGRAM_GITHUB_TOKEN=your-github-token
NERDGRAM_ALLOWED_HOSTS=
NERDGRAM_CORS_ORIGINS=
```

A bind mount instead of the named volume has to be writable by uid **1001**, gid **1001** (user `nerdgram`):

```yaml
    volumes:
      - /path/to/nerdgram-data:/data
```

```bash
sudo chown -R 1001:1001 /path/to/nerdgram-data
```

From the directory that contains `compose.yaml`:

```bash
docker compose pull
docker compose up -d
docker compose logs
docker compose down
```

`pull` fetches the pinned tag. `up -d` creates or replaces the container and leaves it running. `logs` shows the server log. `down` stops and removes the container and keeps the named volume, so the diagrams stay. To move to a newer tag, change the `image:` line, then `docker compose pull` and `docker compose up -d` again. The same `nerdgram-data` volume is mounted on `/data`.

If Compose warns that the volume already exists and was not created by Compose, that is the volume from an earlier `docker run`. Keep it.

**Build from this repository instead.** Pulling the published image is the usual install. Build locally when you want an image from a checkout or a ZIP. Clone is only for this path.

From a `Projects` folder (see [step 2 under Node.js](#nodejs) for the same `mkdir` and `cd` on macOS, Linux, and Windows):

```bash
git clone https://github.com/NetworkNerd1337/NerdGram1337.git
cd NerdGram1337
```

A ZIP of the repository works too. GitHub names that folder `NerdGram1337-main`. Either way, the folder you `cd` into contains the `Dockerfile`.

The Dockerfile uses BuildKit. The first line is `# syntax=docker/dockerfile:1`, and the `RUN` steps mount a cache with `--mount=type=cache`. Docker Engine 23 and newer, and current Docker Desktop, use BuildKit by default. `docker buildx version` should print a version. If this build stops on the syntax line or says `--mount` is unknown, prefix the command with `DOCKER_BUILDKIT=1`, or run `docker buildx build --load` with the same arguments. `docker buildx create --use` makes buildx the default builder when it is not already.

```bash
docker build \
  --build-arg NERDGRAM_VERSION="$(node -p "require('./package.json').version")" \
  --build-arg NERDGRAM_COMMIT="$(git rev-parse HEAD)" \
  -t nerdgram1337:local .
```

`node` and `git` are only used for those two arguments. The image itself has no git binary, and GitHub sync does not need one. Omit the `--build-arg` lines if you do not have `node` or `git`. `NERDGRAM_VERSION` then stays at the default in the Dockerfile, which matches the root `package.json`.

Start it with the same `docker run` as step 3, and use `nerdgram1337:local` as the image name. With Compose, from the project root:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

That tags the image `nerdgram1337:local`. It does not label the local build with the published `vX.Y.Z` name. `docker compose pull` and `docker compose up -d`, without `compose.build.yaml`, still use the published tag in [`compose.yaml`](../compose.yaml). Pass the commit when you have one: `NERDGRAM_COMMIT=$(git rev-parse HEAD) docker compose -f compose.yaml -f compose.build.yaml build`.

Optional variables go on `docker run -e`, or in a `.env` file next to `compose.yaml` (that file is gitignored):

- `NERDGRAM_GITHUB_CLIENT_ID` for GitHub sync. `NERDGRAM_GITHUB_TOKEN` is optional. The token file is `/data/.meta/github-token` with mode `0600`. The git working copy is `/data/.nerdgram-git`.
- `NERDGRAM_ALLOWED_HOSTS` and `NERDGRAM_CORS_ORIGINS` for a LAN address or a DNS name. The steps are [Publish on a LAN](#publish-on-a-lan). That is still a single-user tool port, not a shared server. See [Security model](security.md#security-model).

**Corporate TLS inspection.** Update checks and GitHub sync run inside the container. A proxy that re-signs HTTPS, such as Zscaler, uses a corporate root CA the container does not trust. Export that root as a PEM, mount it read-only, and set `NODE_EXTRA_CA_CERTS` to the path inside the container. The `docker run` and Compose steps are [Corporate TLS inspection](troubleshooting.md#corporate-tls-inspection).

### Node.js

**1. Check Node.js, npm, and Git.** On the host, use **Node.js 20 or newer** and **npm 10 or newer**. The CI verify job installs Node 20. The image and the Docker CI job use Node 22. The root `package.json` has no `engines` field, so npm will not refuse an older Node for you. Check:

```bash
node -v
npm -v
```

A usable result looks like `v20.x.x` or `v22.x.x`, and npm `10.x.x` or newer. `v18` and anything below 20 is too old. npm 9 and below is too old. Install Node.js 20 or newer from [https://nodejs.org/](https://nodejs.org/). The Windows and macOS installers include npm. On Linux, a distribution package can be an older Node, so check `node -v` after installing. Close the terminal and open a new one so the new install is on your `PATH`.

**Git** is required for `git clone` and for **Update now** on a git install. It is not required for the ZIP or for Docker. Check with `git --version`. Install it from [https://git-scm.com/downloads](https://git-scm.com/downloads) if you want to clone.

On macOS the built-in app is **Terminal**. On Windows use **PowerShell** or **Command Prompt**. On Linux use your distribution's terminal. An editor terminal works when `node -v` succeeds there.

**2. Get the code.** Put the project in a folder you can find again. A `Projects` directory in your home folder is a good spot.

| Shell | Create `Projects` and enter it |
| --- | --- |
| macOS or Linux | `mkdir -p "$HOME/Projects" && cd "$HOME/Projects"` |
| Command Prompt | `mkdir %USERPROFILE%\Projects` then `cd %USERPROFILE%\Projects` |
| PowerShell | `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Projects"` then `Set-Location "$env:USERPROFILE\Projects"` |

That path is `/Users/you/Projects` on macOS, `/home/you/Projects` on Linux, and `C:\Users\you\Projects` on Windows. `$HOME`, `%USERPROFILE%`, and `$env:USERPROFILE` already expand to your home folder.

**Clone:**

```bash
git clone https://github.com/NetworkNerd1337/NerdGram1337.git
```

Git creates `NerdGram1337`. A clone of `main` includes changes that are merged but not yet in a milestone release. npm and Docker stay on the latest milestone release until that release is cut. See [Release policy](releases.md#release-policy).

**ZIP:** open [the repository](https://github.com/NetworkNerd1337/NerdGram1337), choose **Code**, then **Download ZIP**. The same archive is [main.zip](https://github.com/NetworkNerd1337/NerdGram1337/archive/refs/heads/main.zip). Extract it in `Projects`. GitHub names the folder `NerdGram1337-main`. The files match the clone. The ZIP has no `.git` directory, so the app treats that copy as a ZIP install.

**3. Open the project root.** Every `npm` command is run from the folder that contains the top-level `package.json`, next to `client/` and `server/`. npm reads the `package.json` in the current folder. If that file is missing, npm stops with `Could not read package.json`.

| How you got the code | macOS or Linux | Command Prompt |
| --- | --- | --- |
| git clone | `cd "$HOME/Projects/NerdGram1337"` | `cd %USERPROFILE%\Projects\NerdGram1337` |
| ZIP | `cd "$HOME/Projects/NerdGram1337-main"` | `cd %USERPROFILE%\Projects\NerdGram1337-main` |

PowerShell uses `Set-Location` with the same path, for example `Set-Location "$env:USERPROFILE\Projects\NerdGram1337"`. Confirm with `pwd` and `ls` (Command Prompt: `cd` and `dir`). You should see `package.json`, `client`, `server`, and `diagrams`.

The root scripts call `client/package.json` and `server/package.json` with `--prefix client` and `--prefix server`. `--prefix` tells npm which folder's `package.json` to use.

**4. Install dependencies.**

```bash
npm run install:all
```

That runs `npm install && npm install --prefix client && npm install --prefix server`. Root installs `concurrently` into `node_modules/`. Client installs React, Vite, and mermaid.js into `client/node_modules/`. Server installs Express and the server toolchain into `server/node_modules/`. The three `node_modules` folders together are roughly 900 MB, and on a typical connection the command takes a couple of minutes. The server install also downloads Puppeteer's chrome-headless-shell (about 260 MB) into Puppeteer's cache at `~/.cache/puppeteer`, or into `PUPPETEER_CACHE_DIR` when that is set. `npm install -g nerdgram1337` downloads that same shell, because the CLI package depends on puppeteer. You will see three install reports, each with a line like `added N packages`. Depending on the npm version and config, an audit summary may follow that line, or it may not appear at all. If the server summary lists high-severity findings, including ones that come from puppeteer, that is expected and the install still succeeded. The command does not start the app. Run it again after you update the code, delete a `node_modules` folder, or see a missing-package error. A finished install leaves `git status` clean.

npm 11 can warn that an install script is not covered by `allowScripts`. Puppeteer, installed under `server/` and by `npm install -g nerdgram1337`, uses its postinstall script to download Chrome. The warning means npm has not yet classified that script. Chrome still downloads, and offline PNG render still works, including when `PUPPETEER_CACHE_DIR` was empty before the install. The same note is in [the command-line tool](cli.md#install). If a later export or render says Chrome is missing, run `npx puppeteer browsers install` from `server/`. To let that script run on the next install, from `server/` run `npm install-scripts approve puppeteer` and then `npm install`.

**5. Run in development.**

```bash
npm run dev
```

That runs `concurrently -n server,client -c blue,magenta "npm run dev --prefix server" "npm run dev --prefix client"`.

- **server** runs `tsx watch src/index.ts`. The API listens on **127.0.0.1 port 8787** and, when IPv6 loopback is available, **::1 port 8787**. It does not listen on the LAN.
- **client** runs Vite bound to **localhost** on port **5173**. Vite may bind only `::1`. Use [http://localhost:5173](http://localhost:5173). If [http://127.0.0.1:5173](http://127.0.0.1:5173) does not connect, stay on `http://localhost:5173`. Requests to `/api` are proxied to `http://127.0.0.1:8787` (not `localhost`, which can resolve to `::1` first). Leave the API on 8787 during `npm run dev`. The proxy target is fixed in `client/vite.config.ts`.

Leave the terminal open. A successful start looks like this (the Vite version, the timing, the commit, and the data path will be yours):

```text
> nerdgram1337@X.Y.Z dev
> concurrently -n server,client -c blue,magenta "npm run dev --prefix server" "npm run dev --prefix client"

[server] > nerdgram1337-server@X.Y.Z dev
[server] > tsx watch src/index.ts
[client] > nerdgram1337-client@X.Y.Z dev
[client] > vite

[client]   VITE v8.x  ready
[client]   ➜  Local:   http://localhost:5173/
[server] NerdGram1337 API listening on http://127.0.0.1:8787
[server] NerdGram1337 API listening on http://[::1]:8787
[server] Data directory: /home/you/Projects/NerdGram1337/diagrams
[server] Install: git vX.Y.Z Code name <commit>
[server] Server module dir: /home/you/Projects/NerdGram1337/server/src
```

`vX.Y.Z Code name` is the root `package.json` version and its code name. On a ZIP copy, `Install:` says `zip`. If the log says it could not listen on `::1`, open [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health) for the API. Day to day, use the UI URL. Vite forwards `/api` for you.

The health check returns JSON with `"ok": true`, `dataDir`, `version`, `commit`, and `installKind`.

**6. Stop, and start again later.** Press **Ctrl+C** in that terminal. Both processes exit, with lines like:

```text
[client] npm run dev --prefix client exited with code SIGINT
[server] npm run dev --prefix server exited with code SIGINT
```

Closing the terminal stops the app too. To start again, `cd` to the same root and run `npm run dev`. You do not need `install:all` again unless the code or `node_modules` changed.

**7. Run in production.** This builds static files and serves the UI and the API from one process. Stop the dev server first. Both modes want port 8787.

```bash
npm run build
npm start
```

`npm run build` runs the client build (`tsc -b && vite build`, output `client/dist/`) and then the server build (`tsc`, output `server/dist/`). It does not start the server. `npm start` runs `node dist/index.js` in `server/`. It does not set `NODE_ENV`. When `client/dist` exists, Express serves those files and sends other non-API routes to `client/dist/index.html`.

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) or [http://localhost:8787](http://localhost:8787). There is no Vite server, so port 5173 will not respond. The log matches the dev server lines above, and `Server module dir` ends in `server/dist`. `npm start` does not watch files. After you change code, press Ctrl+C, run `npm run build`, then `npm start`.

`npm start` before a successful build fails because `server/dist/index.js` does not exist yet:

```text
Error: Cannot find module '.../server/dist/index.js'
```

Run `npm run build` from the project root, then `npm start` again.

**Unsupported.** A diagram folder in iCloud Drive, Dropbox, OneDrive, Google Drive, or any other cloud-synced or on-demand folder is not supported. Cloud-only placeholder files cannot be downloaded through a Docker bind mount, so reads fail. Use a local folder or an SMB or NFS share.

Leave `HOST` unset unless another machine should call the API. Unset, the server listens on `127.0.0.1` and `::1`. The same default is the Host box on the settings page. `PORT` changes the production port (`PORT=8790 npm start`; Command Prompt: `set PORT=8790` then `npm start`; PowerShell: `$env:PORT = "8790"`). During `npm run dev`, leave the API on 8787 and leave the bind on loopback: the dev page proxies to `127.0.0.1:8787`. See [Configuration](configuration.md#configuration) for `HOST`, the saved Host setting, `NODE_ENV`, and `NERDGRAM_DATA_DIR`.

A git clone is updated with [Update a git clone](upgrading.md#update-a-git-clone). A ZIP copy is updated with [Update a ZIP copy](upgrading.md#update-a-zip-copy).

## See also

- [Configuration](configuration.md)
- [Security model](security.md)
- [Upgrading](upgrading.md)
- [Troubleshooting](troubleshooting.md)
- [nerdgram command](cli.md)
