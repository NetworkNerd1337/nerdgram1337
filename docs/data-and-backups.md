# Data and backups

By default, diagrams live in `diagrams/` inside the project.

[Back to the documentation index](README.md)

By default, diagrams live in `diagrams/` inside the project. The server creates that directory on startup if it is missing and prints the absolute path as `Data directory:`.

In Docker, the named volume `nerdgram-data` mounted at `/data` is the whole workspace: `.mmd` files, `.meta` (trash, version history, locks, thumbnails, the search index, style presets, `updates.json`, syntax overrides, a synced reference, and the GitHub token), and `.nerdgram-git`. An older volume may still contain `.meta/listen-host.json`. That file is not the Host setting. The Host setting lives in the instance file, which in Docker is `/tmp/.nerdgram/instance.json` unless `NERDGRAM_INSTANCE_FILE` is set, and it stays off the volume. Copy the whole volume, including those hidden directories. One volume is one workspace. The image's `HOST=0.0.0.0` still overrides the saved Host setting.

Stop the container, then copy the volume out. `tar` is in the image. The entrypoint is the server, so replace it, and use the image you actually run. A checkout build is `nerdgram1337:local`. The published image is `ghcr.io/networknerd1337/nerdgram1337:v2.1.7` (the tag [`compose.yaml`](../compose.yaml) pins; use the current [Releases](https://github.com/NetworkNerd1337/NerdGram1337/releases) tag, or `:latest`, when that differs). The process runs as uid 1001, so the folder that receives the archive has to be writable by that user.

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

Published image. Same command, with `ghcr.io/networknerd1337/nerdgram1337:v2.1.7` in place of `nerdgram1337:local`:

```bash
docker stop nerdgram1337
mkdir -p nerdgram-backup
sudo chown 1001:1001 nerdgram-backup
docker run --rm --entrypoint tar \
  -v nerdgram-data:/data:ro \
  -v "$PWD/nerdgram-backup":/backup \
  ghcr.io/networknerd1337/nerdgram1337:v2.1.7 \
  -C /data -czf /backup/nerdgram-data.tgz .
sudo chown "$(id -u):$(id -g)" nerdgram-backup/nerdgram-data.tgz
```

The archive is the whole `/data` tree, including hidden `.meta` and, when sync has been connected, `.nerdgram-git`. A bind mount is a normal directory. Copy that directory the same way, including those hidden folders.

On a Node install, copy the `diagrams/` folder, or the directory `NERDGRAM_DATA_DIR` points at, the same way you copy any other personal folder. Include the hidden `.meta` directory. The in-app folder tree hides `.meta`. The `.mmd` files themselves stay plain text.

`git` ignores extra files under `diagrams/` and ignores `diagrams/.meta/`. The sample diagrams, including `WAN.mmd` and `Sites/Atlanta.mmd`, are tracked. A custom `NERDGRAM_DATA_DIR` outside the repo is not part of the git checkout.

Do not run `docker volume rm` on a volume you still want.

## See also

- [Install](install.md)
- [Upgrading](upgrading.md)
- [Configuration](configuration.md)
