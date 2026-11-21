# Install

Run NerdGram with Docker, or with Node.js on the machine.

[Back to the documentation index](README.md)

## Quick start

Run NerdGram with Docker, or with Node.js on the machine. Docker is the install to use when you want the app. Node.js is how you develop it, and it is also a full install when you do not want Docker. Use one of them at a time. Development and production both want port **8787**.

The app is for you, on your personal machine. It is a single-user tool, not a client/server product. The API is a tool port: a conduit other programs can call on demand, not an always-on multi-user server. The [security model](security.md#security-model) is why every Docker command below publishes `127.0.0.1:8787:8787`, and why a Node install leaves `HOST` unset unless you want that tool port on the local network.

The Docker `pull` and `run` commands in this file use `v2.1.0`. That is `v` plus the `version` in the root `package.json`, and it is the tag [`compose.yaml`](../compose.yaml) pins. Use the current tag on the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases) when you want a different release. [`npm run version:check`](releases.md#versioning-and-releases) fails if an image pin in the README or the docs, the Dockerfile, or `compose.yaml` disagrees with `package.json`. The names of planned releases are listed under [Versioning and releases](releases.md#versioning-and-releases).

### Docker

You do not need Node.js, and you do not need to clone this repository, to run the published image. The image is Node.js 22 on Debian bookworm-slim (`node:22.23.5-bookworm-slim`), pinned by digest in the `NODE_IMAGE` argument of the [Dockerfile](../Dockerfile). SVG and PNG use a headless browser. linux/amd64 uses Puppeteer's chrome-headless-shell, the same shell a Node install downloads. linux/arm64 uses Debian's `chromium` package. Chrome for Testing does not publish a linux-arm64 headless shell, and the shell Puppeteer would download on that architecture is an x86-64 binary that cannot start. The arm64 image sets `PUPPETEER_EXECUTABLE_PATH` to `/usr/lib/chromium/chromium`. The process inside the container listens on `0.0.0.0` so Docker can publish the port. The image sets `HOST=0.0.0.0`, which wins over the saved Host setting, so the Settings page shows that box as read-only. The log notes that `0.0.0.0` is not loopback. That note is expected. On the host, publish **`127.0.0.1:8787:8787`** to keep the tool port on this machine. Publish **`<lan-ip>:8787:8787`** when another machine on that network should call the API. Publishing `8787:8787` or `0.0.0.0:8787` opens every host interface. The browser `/api` routes have no token, so anyone who can open the published port can use them. The container does not see the host's LAN addresses. Set `NERDGRAM_ALLOWED_HOSTS` to the address callers use, or those requests are **403**. See [Security model](security.md#security-model).

The image is `ghcr.io/networknerd1337/nerdgram1337`. Each full release is a tag `vX.Y.Z`, the same tag as the GitHub Release. The workflow also pushes `:latest` for the newest full release. The tag to use is on the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases). [`compose.yaml`](../compose.yaml) pins the tag that matches this tree. [`npm run version:check`](releases.md#versioning-and-releases) fails if an image pin in the README or the docs, the Dockerfile, or `compose.yaml` disagrees with `package.json`.

The package is public, so `docker pull` does not need a login. If a new package is still private, set **Public** once in the [package settings](https://github.com/users/NetworkNerd1337/packages/container/nerdgram1337/settings). The publish workflow warns when it cannot do that, and a successful image push still leaves the workflow green. See [Cutting a release](releases.md#cutting-a-release).

**1. Install Docker.** Install Docker Engine and the Compose plugin from [Docker's documentation](https://docs.docker.com/get-docker/). `docker version` and `docker compose version` should both print a version.

**2. Pull the image.** The command uses `v2.1.0`, the tag for this tree (the same pin as [`compose.yaml`](../compose.yaml)). Use the current tag from the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases) when it differs. `:latest` is the newest full release.

```bash
docker pull ghcr.io/networknerd1337/nerdgram1337:v2.1.0
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
  ghcr.io/networknerd1337/nerdgram1337:v2.1.0
```

**About → Show upgrade steps** prints the run command with the real tag, the container name `nerdgram1337`, the volume `nerdgram-data`, and `127.0.0.1:8787:8787`. Updating an install you already have is [Update a Docker install](upgrading.md#update-a-docker-install).

**4. Open the app.** [http://127.0.0.1:8787](http://127.0.0.1:8787) or [http://localhost:8787](http://localhost:8787). The health check is [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health). `installKind` is `docker`, and `dataDir` is `/data`.

The container runs as uid **1001**, gid **1001** (user `nerdgram`). A new named volume is writable by that user. A bind mount needs:

```bash
sudo chown -R 1001:1001 /path/to/nerdgram-data
```

If the directory is owned by root, the process exits and the log says it cannot write the data directory as that uid. An empty data directory is seeded once from the image's `diagrams/` folder. With `NERDGRAM_DATA_DIR=/data` the samples land at `/data/Welcome.mmd`, `/data/NetworkMap.mmd`, `/data/Examples/Sequence.mmd`, `/data/WAN.mmd`, and `/data/Sites/Atlanta.mmd`. The log says `Seeded empty data directory with the sample diagrams.` A directory that already has any entry is left alone.

`templates/` and `reference/` are in the image, not on the volume. With `NERDGRAM_DATA_DIR` set, a syntax-reference sync writes under `/data/.meta/reference` and survives a new container. Templates stay the ones in the image.

The published host port has to equal `PORT` inside the container (the image sets `8787`). The browser sends that port in the `Host` header. To use another port, set `PORT` in the container and publish `127.0.0.1:THAT:THAT`.

**Compose.** [`compose.yaml`](../compose.yaml) publishes the same loopback port and mounts the same volume. It also sets a read-only root filesystem (`read_only: true`), `tmpfs` on `/tmp`, and `no-new-privileges`. The `docker run` above does not. The `image:` line is the published tag. From the directory that contains `compose.yaml`:

```bash
docker compose pull
docker compose up -d
```

Keep the volume mounted on `/data`. Compose and `docker run` both use the volume name `nerdgram-data`. If Compose warns that the volume already exists and was not created by Compose, that is the volume from an earlier `docker run`. Keep it.

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
- `NERDGRAM_ALLOWED_HOSTS` and `NERDGRAM_CORS_ORIGINS` when callers use a DNS name, or when the published host address is not an address the container can see. Saving from `diagrams.home` needs `NERDGRAM_ALLOWED_HOSTS=diagrams.home` and `NERDGRAM_CORS_ORIGINS=http://diagrams.home:8787`. A LAN IP published as `<lan-ip>:8787:8787` needs that IP in `NERDGRAM_ALLOWED_HOSTS` because interface discovery inside the container is the container's own addresses, not the host's. That is still a single-user tool port, not a shared server. See [Security model](security.md#security-model).

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

Git creates `NerdGram1337`.

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
[server] Install: git X.Y.Z <commit>
[server] Server module dir: /home/you/Projects/NerdGram1337/server/src
```

`X.Y.Z` is the root `package.json` version. On a ZIP copy, `Install:` says `zip`. If the log says it could not listen on `::1`, open [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health) for the API. Day to day, use the UI URL. Vite forwards `/api` for you.

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

Leave `HOST` unset unless another machine should call the API. Unset, the server listens on `127.0.0.1` and `::1`. The same default is the Host box on the settings page. `PORT` changes the production port (`PORT=8790 npm start`; Command Prompt: `set PORT=8790` then `npm start`; PowerShell: `$env:PORT = "8790"`). During `npm run dev`, leave the API on 8787 and leave the bind on loopback: the dev page proxies to `127.0.0.1:8787`. See [Configuration](configuration.md#configuration) for `HOST`, the saved Host setting, `NODE_ENV`, and `NERDGRAM_DATA_DIR`.

A git clone is updated with [Update a git clone](upgrading.md#update-a-git-clone). A ZIP copy is updated with [Update a ZIP copy](upgrading.md#update-a-zip-copy).

## See also

- [Configuration](configuration.md)
- [Security model](security.md)
- [Upgrading](upgrading.md)
- [Troubleshooting](troubleshooting.md)
- [nerdgram command](cli.md)
