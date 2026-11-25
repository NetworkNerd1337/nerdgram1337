# Configuration

Set a variable in the same terminal before `npm run dev` or `npm start`, so the process inherits it.

[Back to the documentation index](README.md)

Paths in this document use two placeholders, always in code formatting so GitHub does not treat the angle brackets as HTML tags. `<data>` is the data directory: `NERDGRAM_DATA_DIR` when that variable is set, and `diagrams/` inside the project when it is not. `<repo>` is the project folder, the git clone or the extracted ZIP.

Set a variable in the same terminal before `npm run dev` or `npm start`, so the process inherits it. The Docker image already sets `HOST=0.0.0.0`, `PORT=8787`, `NERDGRAM_DATA_DIR=/data`, `NERDGRAM_INSTALL=docker`, and `NODE_ENV=production`.

| Shell | For the next command | For the rest of the session |
| --- | --- | --- |
| macOS or Linux | `NAME=value npm run dev` | `export NAME=value` |
| Command Prompt | `set NAME=value` then the command | same `set`, until the window closes |
| PowerShell | `$env:NAME = "value"` then the command | same assignment, until the window closes |

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | API port. Inside Docker this must equal the published host port. |
| `HOST` | unset, which binds `127.0.0.1` and `::1` | One address replaces that pair. When this variable is set, it wins over the Host setting saved in the UI, and the settings page says so. `HOST=127.0.0.1` is IPv4 loopback only. `HOST=::1` is IPv6 loopback only. `HOST=0.0.0.0` listens on every IPv4 interface. `HOST=::` listens on every IPv6 interface. The Docker image sets `HOST=0.0.0.0` so a published port can reach the process. |
| `NODE_ENV` | unset | `npm start` and `npm run dev` do not set this. NerdGram still infers a mode from the entry file: a `tsx` process is development and `node dist/index.js` is production. That mode decides whether the Vite origins on port 5173 are allowed. It does not set `NODE_ENV`, so Express is not in production mode unless you set the variable. Set `NODE_ENV=production` or `NODE_ENV=development` to override the inferred mode. Docker sets `NODE_ENV=production`. |
| `NERDGRAM_DATA_DIR` | `<repo>/diagrams` | Absolute path of the workspace. The image uses `/data`. The Diagram folder setting stores this same variable in the instance startup config. An external value, from the shell, a service file, or Docker, is the source of truth and the field is read-only. |
| `NERDGRAM_ALLOWED_HOSTS` | empty | Comma-separated extra `Host` names, merged with the names the bind already allows. A star, `0.0.0.0`, and `::` are ignored. Use this for a DNS name, or for a Docker host address the container cannot discover. |
| `NERDGRAM_CORS_ORIGINS` | empty | Comma-separated extra origins for mutations, such as `http://localhost:5174`. Not a wildcard. |
| `NERDGRAM_INSTALL` | auto | `docker`, `git`, or `zip`. Any other explicit value is `unknown`. Unset, a `/.dockerenv` or `/run/.containerenv` file means docker, a `.git` at the app root means git, and a `package.json` means zip. |
| `NERDGRAM_STRICT_INSTANCE` | unset | `1` refuses to start when another live instance holds `<data>/.meta/instance-lock.json`. Unset, NerdGram starts. A second install on a shared folder is noted, and background sync, the update checker, and diagram sightings pause. Two processes with the same instance id are a warning. |
| `NERDGRAM_INSTANCE_FILE` | `~/.nerdgram/instance.json` | This install's instance id, instance name, saved `NERDGRAM_DATA_DIR`, and saved Host. It is not in the diagram folder. Docker, and a home directory on `/tmp`, use `/tmp/.nerdgram/instance.json` instead. Set this variable only to put that file somewhere else. An older `<data>/.meta/instance.json` is copied once into this file and then left unchanged. It does not choose which folder the diagrams are in, and it does not choose the bind address by itself. |
| `NERDGRAM_COMMIT` | git `HEAD` on a git install, otherwise unset | Hex SHA of 7 to 40 characters baked into an image. Docker does not run git to find one. |
| `NERDGRAM_GITHUB_CLIENT_ID` | unset | OAuth client ID. Not a secret. |
| `NERDGRAM_GITHUB_TOKEN` | unset | Access token. When set, it is used instead of `.meta/github-token` and is not copied to disk. |
| `NERDGRAM_GITHUB_CLIENT_SECRET` | unset | Revokes the OAuth grant on disconnect when set. Also sent when refreshing a token that did not come from the device flow. Device flow refresh does not need it. Never stored. |
| `NERDGRAM_GITHUB_WEB` | `https://github.com` | GitHub website. Leave unset for github.com. |
| `NERDGRAM_GITHUB_API` | `https://api.github.com` | GitHub API. Leave unset for github.com. |
| `NERDGRAM_GITHUB_TIMEOUT_MS` | `20000` | GitHub HTTP timeout, clamped from 100 to 120000. |
| `NERDGRAM_SYNC_IDLE_MS` | `20000` | Quiet time before an edit becomes a commit, clamped from 0 to 600000. |
| `NERDGRAM_SYNC_RECONCILE_MS` | `60000` | How often a change from another program is picked up. `0` turns the timer off. Clamped to 86400000. |
| `NERDGRAM_SYNC_RETRY_MS` | `30000` | Retry delay, clamped from 5000 to 600000. |
| `NERDGRAM_SYNC_WATCH` | on | `0` turns the file watcher off. |
| `NERDGRAM_SYNC_MIRROR` | `<data>/.nerdgram-git` | Absolute path of the git working copy. It cannot be the data directory itself. |
| `NERDGRAM_UPDATE_CHECK` | on | `false`, `0`, `off`, or `no` blocks automatic and manual checks, and **Update now**. |
| `NERDGRAM_UPDATE_INTERVAL_MS` | `86400000` | Cache lifetime and automatic check interval, clamped from 1000 to 7 days. |
| `NERDGRAM_UPDATE_INCLUDE_PRERELEASE` | off | `true`, `1`, `yes`, or `on` includes prereleases even when the About checkbox is clear. |
| `NERDGRAM_BASELINE_CAP` | `20` | How many named baselines each diagram keeps. They are not dropped by the 20-revision limit. A whole number from 1 to 200. Anything else uses 20. |
| `PUPPETEER_EXECUTABLE_PATH` | unset | Browser Puppeteer launches for SVG and PNG. Unset uses the downloaded chrome-headless-shell. The linux/arm64 image sets this to `/usr/lib/chromium/chromium`, the Debian chromium binary. |
| `NERDGRAM_CHROME_ARGS` | unset | Extra browser flags, separated by spaces. The arm64 CI smoke sets `--no-zygote --single-process` because QEMU cannot fork Chromium's zygote. Leave this unset on real hardware. |
| `NERDGRAM_CHROME_DUMPIO` | unset | `1` copies the browser's own log to the server log. |
| `NERDGRAM_RENDER_LAUNCH_TIMEOUT_MS` | `30000` | How long Puppeteer waits for the browser to start. A whole number from 1000 to 600000. Anything else uses 30000. |
| `NERDGRAM_RENDER_TIMEOUT_MS` | `20000` | Page timeout for one SVG or PNG. A whole number from 1000 to 600000. Anything else uses 20000. |

`NERDGRAM_VERSION` is a Docker build argument, not a runtime variable. It has to match the root `package.json`, and the image label `org.opencontainers.image.version` records it. `NERDGRAM_CODENAME` is the code name for that version's milestone. The image sets it in the environment and as `org.opencontainers.image.codename`. The running app still reads the code name from the `codenames` map in `package.json`.

The update tests also read `NERDGRAM_UPDATE_FIXTURE`, `NERDGRAM_UPDATE_SIMULATE`, `NERDGRAM_UPDATE_ALLOW_EXEC`, and `NERDGRAM_UPDATE_CHECK_IN_TEST`. Leave those unset.

A custom data directory on macOS or Linux:

```bash
export NERDGRAM_DATA_DIR="$HOME/Documents/nerdgram-diagrams"
npm run dev
```

One command, without exporting, is `NERDGRAM_DATA_DIR="$HOME/Documents/nerdgram-diagrams" npm run dev`. That folder is `/Users/you/Documents/nerdgram-diagrams` on macOS and `/home/you/Documents/nerdgram-diagrams` on Linux. Command Prompt: `set NERDGRAM_DATA_DIR=C:\Users\you\Documents\nerdgram-diagrams`. PowerShell: `$env:NERDGRAM_DATA_DIR = "C:\Users\you\Documents\nerdgram-diagrams"`. A concrete default folder is `/Users/you/Projects/NerdGram1337/diagrams` on macOS, `/home/you/Projects/NerdGram1337/diagrams` on Linux, and `C:\Users\you\Projects\NerdGram1337\diagrams` on Windows. Use `NerdGram1337-main` if you installed from the ZIP. The log line `Data directory:` is the path the server resolved. Bookmarks are `diagrams/.meta/favorites.json` (or `<data>/.meta/favorites.json`). Style presets are `<data>/.meta/style-presets.json`. User templates are `<data>/.templates/`. Syntax-reference notes are `diagrams/.meta/syntax-overrides.json`.

An empty custom directory is seeded once with the sample diagrams, including the linked WAN and Atlanta pair. Any existing entry, including a hidden one, means the directory is left alone. The same path as the repo `diagrams/` folder is not copied onto itself.

`HOST=127.0.0.1 npm start` listens on IPv4 loopback only (Command Prompt: `set HOST=127.0.0.1` then `npm start`; PowerShell: `$env:HOST = "127.0.0.1"`). `HOST=::1` listens on IPv6 loopback only. If `http://localhost:8787` does not open, use `http://127.0.0.1:8787`. The same variable applies to `npm run dev`. `npm start` does not set `NODE_ENV`. Set `NODE_ENV=development` or `NODE_ENV=production` only when you need to override the mode NerdGram infers from the entry file.

**Host setting.** Settings has a Host box. It is stored in the instance startup config (`~/.nerdgram/instance.json`, or `NERDGRAM_INSTANCE_FILE`), the same file as the instance id and the Diagram folder, and it is read on the next start. It is not stored in the diagram folder. Two installs that share a folder keep their own Host. A valid `<data>/.meta/listen-host.json` from an older version is copied into that config once, when the config has no Host yet. The old file is left in place and then ignored, so removing it is not required and would matter only for an install that has not started since the copy. The box defaults to `127.0.0.1`. That saved value, and a missing Host, keep the default pair `127.0.0.1` and `::1`. It is not the same as `HOST=127.0.0.1`, which is IPv4 only. A machine IP listens on that interface only and is accepted in the `Host` header, including `IP:port` on the API port. `0.0.0.0` or `::` listens on every interface of that family. Those two values are not `Host` names. At startup NerdGram allows the machine's non-loopback interface addresses instead, so a caller can use any of those IPs. Loopback names (`localhost`, `127.0.0.1`, `::1`) always stay allowed. A saved or effective Host that is another loopback address, such as `127.0.0.2`, is an allowed origin for browser edits on the API port. A different loopback address is not. `NERDGRAM_ALLOWED_HOSTS` is merged in, not replaced. The UI accepts an IPv4 or IPv6 address only. A DNS name belongs in `NERDGRAM_ALLOWED_HOSTS`. Saving Host and Diagram folder, then restarting once, applies both. The Host value does not stay behind in the previous diagram folder.

`HOST` wins when it is set. The settings page shows the override and does not pretend the saved value is the bind. NerdGram never restarts itself. The restart note appears only while the saved host differs from the address this process started with. After a restart that is already listening on the saved address, the note is gone, including when that address is not `127.0.0.1`. Saving `127.0.0.1` again, while the process is already on the default loopback pair, leaves the note hidden.

**Diagram folder.** Settings has a Diagram folder box next to Host. It sets `NERDGRAM_DATA_DIR`. The value is stored in the instance startup config (`~/.nerdgram/instance.json`, or `NERDGRAM_INSTANCE_FILE`) and `getDataRoot()` reads it at the next start through `NERDGRAM_DATA_DIR`. A process cannot change its own shell environment for later runs, so the file is what startup reads. When `NERDGRAM_DATA_DIR` is already set in the shell, a service file, or Docker, the box shows that value read-only and says where it came from. There is one source of truth. In Docker the box is read-only: change the volume mount. The field is disabled while GitHub sync is on. The path has to be a writable folder, or a path whose parent exists so the folder can be created. The restart note uses the same rule as Host: it shows only while the saved folder differs from the folder this process started with.

In Docker the image sets `HOST=0.0.0.0`, so the box is read-only. Change the published port, not the setting. `127.0.0.1:8787:8787` keeps the tool port on the host loopback. `<lan-ip>:8787:8787` publishes that address. Add the host address to `NERDGRAM_ALLOWED_HOSTS`, because the process discovers the container's interfaces, not the host's. Browser saves from that same address also need `NERDGRAM_CORS_ORIGINS` set to `http://<lan-ip>:8787`. The Host list does not add an origin. The steps are [Publish on a LAN](install.md#publish-on-a-lan). A token call from `curl` does not send `Origin`, so the Host allow-list is the check that matters for it.

## See also

- [Install](install.md)
- [Security model](security.md)
- [Team use](team-use.md)
- [GitHub sync](github-sync.md)
