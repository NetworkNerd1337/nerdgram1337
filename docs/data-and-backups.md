# Data and backups

By default, diagrams live in `diagrams/` inside the project.

[Back to the documentation index](README.md)

By default, diagrams live in `diagrams/` inside the project. The server creates that directory on startup if it is missing and prints the absolute path as `Data directory:`.

In Docker, the named volume `nerdgram-data` mounted at `/data` is the whole workspace: `.mmd` files, `.meta` (trash, version history, locks, thumbnails, the search index, style presets, `updates.json`, syntax overrides, a synced reference, and the GitHub token), and `.nerdgram-git`. An older volume may still contain `.meta/listen-host.json`. That file is not the Host setting. The Host setting lives in the instance file, which in Docker is `/tmp/.nerdgram/instance.json` unless `NERDGRAM_INSTANCE_FILE` is set, and it stays off the volume. Copy the whole volume, including those hidden directories. One volume is one workspace. Use that volume, or a local folder, and do not share the same cloud-synced folder across machines. [Install](install.md#docker) has the note. Startup checks the folder and records problems in `GET /api/doctor`. A bad app-state file is copied to `.meta/quarantine` and replaced with defaults. Diagrams are not part of that copy. In Docker the instance file is `.meta/instance.json` on this volume. The image's `HOST=0.0.0.0` still overrides the saved Host setting.

Stop the container, then copy the volume out. `tar` is in the image. The entrypoint is the server, so replace it, and use the image you actually run. A checkout build is `nerdgram1337:local`. The published image is `ghcr.io/networknerd1337/nerdgram1337:v2.1.22` (the tag [`compose.yaml`](../compose.yaml) pins; use `:latest` or `v2.1.22`. The previous release's tag stays for 30 days after it is deprecated, then it is removed. Older npm versions are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term). The process runs as uid 1001, so the folder that receives the archive has to be writable by that user.

Local build:

```bash
docker stop nerdgram1337
mkdir -p nerdgram-backup
sudo chown 1001:1001 nerdgram-backup
docker run --rm --entrypoint tar \
  -v nerdgram-data:/data:ro \
  -v "$PWD/nerdgram-backup":/backup \
  nerdgram1337:local \
  -C /data -czf /backup/nerdgram-data.tgz .
sudo chown "$(id -u):$(id -g)" nerdgram-backup/nerdgram-data.tgz
```

Published image. Same command, with `ghcr.io/networknerd1337/nerdgram1337:v2.1.22` in place of `nerdgram1337:local`:

```bash
docker stop nerdgram1337
mkdir -p nerdgram-backup
sudo chown 1001:1001 nerdgram-backup
docker run --rm --entrypoint tar \
  -v nerdgram-data:/data:ro \
  -v "$PWD/nerdgram-backup":/backup \
  ghcr.io/networknerd1337/nerdgram1337:v2.1.22 \
  -C /data -czf /backup/nerdgram-data.tgz .
sudo chown "$(id -u):$(id -g)" nerdgram-backup/nerdgram-data.tgz
```

The archive is the whole `/data` tree, including hidden `.meta` and, when sync has been connected, `.nerdgram-git`. A bind mount is a normal directory. Copy that directory the same way, including those hidden folders.

On a Node install, copy the `diagrams/` folder, or the directory `NERDGRAM_DATA_DIR` points at, the same way you copy any other personal folder. Include the hidden `.meta` directory. The in-app folder tree hides `.meta`. The `.mmd` files themselves stay plain text.

`git` ignores extra files under `diagrams/` and ignores `diagrams/.meta/`. The sample diagrams, including `WAN.mmd` and `Sites/Atlanta.mmd`, are tracked. A custom `NERDGRAM_DATA_DIR` outside the repo is not part of the git checkout.

Do not run `docker volume rm` on a volume you still want.

App-state files under `.meta` carry `schemaVersion`. A file from an older build is migrated in place after a copy is written to `.meta/backups/<fromVersion>-<time>/`. The last 3 of those backups are kept. A file from a newer build is not overwritten. NerdGram serves its defaults and asks you to upgrade or restore. `.meta/instance-lock.json` is the heartbeat for this process. A second live server on the same folder is a warning. `nerdgram doctor` does not take that lock. Quarantine copies stay under `.meta/quarantine/<time>/`. Settings and the data-folder dialog can restore one of the 10 most recent sets. `nerdgram doctor --restore <time>` does the same. None of these paths modify, move, or delete a diagram.

## See also

- [Install](install.md)
- [Upgrading](upgrading.md)
- [Configuration](configuration.md)
