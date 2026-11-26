# Upgrading

Stop the app before you replace it.

[Back to the documentation index](README.md)

## Contents

- [Upgrading to 2.1.27](#upgrading-to-2127)
- [Upgrading to 2.1.26](#upgrading-to-2126)
- [Check the data folder](#check-the-data-folder)
- [Pin a version](#pin-a-version)
- [Update a Docker install](#update-a-docker-install)
- [Update a git clone](#update-a-git-clone)
- [Update a ZIP copy](#update-a-zip-copy)
- [In-app updates](#in-app-updates)
- [Network diagrams](#network-diagrams)
- [Flowchart labels](#flowchart-labels)
- [Public schema routes](#public-schema-routes)
- [Translators](#translators)

Paths in this document use two placeholders, always in code formatting so GitHub does not treat the angle brackets as HTML tags. `<data>` is the data directory: `NERDGRAM_DATA_DIR` when that variable is set, and `diagrams/` inside the project when it is not. `<repo>` is the project folder, the git clone or the extracted ZIP.

Stop the app before you replace it. Diagrams stay where they are when you keep the same data directory or the same volume. Do not run `docker volume rm` on a volume you still want. There is no updater inside the container.

## Upgrading to 2.1.27

2.1.27 is a patch on Azimuth. Diagrams stay where they are.

The side pane shows "New release available!" when this install is behind the latest GitHub release. The bottom update toast stays hidden while that notice is showing. About and Check for updates are unchanged.

A Docker restart of the same container can edit an open diagram again immediately. Recreating the container on the same volume still waits until the heartbeat is 90 seconds old. A second live boot that shares the instance id still holds its lock until then.

## Upgrading to 2.1.26

2.1.26 is a patch on Azimuth. Diagrams stay where they are.

On Docker, the instance id this process uses moves off the data volume to `/tmp/.nerdgram/instance.json` unless `NERDGRAM_INSTANCE_FILE` is set. The saved name is kept. The copy at `/data/.meta/instance.json` is left alone. Recreating the only container still shows that name.

A second NerdGram on a shared folder is a note, not a warning. The note says another install is using the folder, and that background sync, the update checker, and diagram sightings stay paused. Two processes with the same instance id are still a warning.

A lock file that cannot be read is treated as held. It is not quarantined and it is not taken. Stop every NerdGram, then delete that lock file if no editor has the diagram open.

exFAT and FAT are not supported for shared locking. Use ext4, NTFS, or APFS behind SMB or NFS.

## Check the data folder

Run the doctor before you upgrade. It reads the data folder on this computer and does not change diagrams.

```bash
nerdgram doctor
```

Inside a running container:

```bash
docker exec nerdgram1337 nerdgram doctor
```

Exit 0 means the folder is fine. Exit 1 is a warning. Exit 2 means the folder is not writable or the check is degraded. Running doctor while the app is up does not by itself report a second instance. `--repair` and `--restore` refuse until that server stops. `--json` prints the report. The in-app update dialog and the Docker upgrade steps list the same blockers before the commands: the folder is not writable, free space is low, two copies of the same install share the folder, another install is using a shared folder, or one of NerdGram's own settings or history files was written by a newer NerdGram.

Fix a blocker before you upgrade. `nerdgram doctor --repair` quarantines bad settings and history files, restores fresh copies, removes old temp files, and runs migrations. It copies those files to `.meta/backups` first. It does not modify, move, or delete `*.mmd` files. `nerdgram doctor --restore <ts>` puts one quarantine set back. A file whose `schemaVersion` is newer than this build is left unchanged.

`NERDGRAM_STRICT_INSTANCE=1` refuses to start when another live instance already holds `.meta/instance-lock.json`. Leave it unset unless you want that. Two processes with the same instance id are a warning. Another install on a shared folder is a note. In both cases background sync, the update checker, and diagram sightings pause.

The 2.1 line is supported until the next minor or major release. Only the newest patch is published. That patch is 2.1.27. Security fixes land there. 2.1.27 is published to npm, Docker and GHCR, and the GitHub Release. 2.1.26 is the previous release. It was deprecated on 2026-11-26. Its npm version and GHCR tag stay through 2026-12-26. 2.1.22, 2.1.23, and 2.1.24 were Docker and GHCR only and were never published to npm. Pull `ghcr.io/networknerd1337/nerdgram1337:latest` for this release. When a milestone release is published, the previous release is deprecated immediately and loses support that same day. `npm deprecate` marks that npm release with an "upgrade to latest" message. Its npm version and GHCR version tag stay published for 30 days, so pinned installs and lockfiles keep working while people upgrade. After 30 days, that version is unpublished from npm where npm allows it, and its GHCR version tag is removed. Only the previous release gets that grace period. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Git tags stay. The table is in the [security policy](../SECURITY.md#supported-versions).

## Pin a version

The install examples and `compose.yaml` use `ghcr.io/networknerd1337/nerdgram1337:latest`. That tag follows the newest full release.

Pin `:vX.Y.Z` when the tag should stay put. Use it when every instance on a shared folder should run the same version, and when you want to choose when an upgrade happens. The example is `v2.1.27`. Put the release you want in place of that tag.

```bash
docker pull ghcr.io/networknerd1337/nerdgram1337:v2.1.27
```

In `compose.yaml`:

```yaml
image: ghcr.io/networknerd1337/nerdgram1337:v2.1.27
```

`:latest` is cached. `docker pull ghcr.io/networknerd1337/nerdgram1337:latest`, or `docker compose pull` when the file uses that tag, is what moves it. Then recreate the container on the same volume.

## Update a Docker install

The in-app **Show upgrade steps** dialog uses the release tag, the container name `nerdgram1337`, the volume `nerdgram-data`, and `127.0.0.1:8787:8787`. The examples below use `:latest`. A cached `:latest` moves when you pull. To stay on one release, see [Pin a version](#pin-a-version). The previous release stays for 30 days after it is deprecated, then its tag is removed. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. If your names differ, keep the names you already use.

1. Pull the new image.

```bash
docker pull ghcr.io/networknerd1337/nerdgram1337:latest
```

2. Stop the old container. `docker stop` asks the process to finish the write it is in and any GitHub sync already running.

```bash
docker stop nerdgram1337
```

3. Remove the old container. The volume stays.

```bash
docker rm nerdgram1337
```

4. Start it again on the same volume and the same loopback port.

```bash
docker run -d \
  --name nerdgram1337 \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e NERDGRAM_DATA_DIR=/data \
  -e NERDGRAM_INSTALL=docker \
  -v nerdgram-data:/data \
  ghcr.io/networknerd1337/nerdgram1337:latest
```

5. Open [http://127.0.0.1:8787](http://127.0.0.1:8787) and choose **Check again** in About. The dialog says whether the running version matches that release.

These `docker run` lines use the same container name, volume, and port as the in-app steps. They do not set a read-only root or a `tmpfs` on `/tmp`. `compose.yaml` does, and it ships `:latest`. The in-app dialog prints the release tag. To pin that tag yourself, see [Pin a version](#pin-a-version). If `compose.yaml` already says `:latest`, pull and up are enough. Then:

```bash
docker compose pull
docker compose up -d
```

Keep the volume mounted on `/data`.

## Update a git clone

From the project root, with the app stopped (Ctrl+C):

1. Pull tracked files. Diagrams you created under `diagrams/` stay put, because git ignores those extra files and ignores `diagrams/.meta/`. The sample diagrams are tracked. If you edited one of them, including `diagrams/WAN.mmd` or `diagrams/Sites/Atlanta.mmd`, git may stop and ask you to handle those local edits before the pull can finish.

```bash
git pull
```

2. Install again. The pull can change lockfiles.

```bash
npm run install:all
```

3. Start the same way you were running it: `npm run dev`, or `npm run build` and then `npm start`.

A clean git clone whose `origin` is this repository can do the same fetch, fast-forward, `npm ci`, and build from **Update now** in About. You still restart afterwards. See [In-app updates](#in-app-updates). `npm ci` replaces `node_modules` under the running process. If the process dies in the middle, the error names the previous commit and the recovery is `git reset --keep <previous>` from the project root, then the three `npm ci` commands and `npm run build` again. Diagrams are untouched.

## Update a ZIP copy

There is no **Update now** for a ZIP. About shows the hand steps.

1. Download a fresh ZIP from [main.zip](https://github.com/NetworkNerd1337/NerdGram1337/archive/refs/heads/main.zip) or from the release page, and extract it to a new folder. GitHub names a `main` archive `NerdGram1337-main`.
2. `cd` into that folder and run `npm run install:all`. The ZIP does not include `node_modules`.
3. If your diagrams are still in the old project's `diagrams/` folder, copy that folder into the new project, including the hidden `.meta` directory. If you set `NERDGRAM_DATA_DIR`, point the new copy at the same path and leave the files where they are.
4. Start with `npm run dev`, or `npm run build` and `npm start`.


## In-app updates

The running version is the **About** button in the top-right header, next to **Support**, and **About NerdGram1337** in the command palette. Both show the version and its code name, for example `v2.1.27 Azimuth`. The header button puts that string in its tooltip. The dialog also shows how this copy was installed, the Mermaid engine version when the build recorded one, the commit when one is known, and links to the author, the issues page, this README, the MIT license, and Ko-fi. The header **Support** button opens Ko-fi directly. `GET /api/version` returns `name`, `version`, `codename`, `commit`, and `installKind`. `GET /api/health` returns those fields plus `"ok": true` and `dataDir`. `installKind` is `git`, `docker`, `zip`, or `unknown`. `commit` is a SHA when the build or the git checkout has one, and null otherwise. Docker never shells out to git to discover a commit. Set `NERDGRAM_COMMIT` at image build time when you want one. When a newer release is available, the side pane shows **New release available!** with that version, and the banner and the release dialog show that release's code name. The side pane notice opens About. It stays hidden when this install matches or is ahead of the latest release, and when the check fails. The version still comes from the tag. The code name comes from the milestone key for that tag. 1.5.y is Compass. Later minors use the name in the `codenames` map.

The server asks GitHub, with no token, whether `NetworkNerd1337/NerdGram1337` has a newer full release. That request uses the public Releases API for the latest stable release. It does not offer a prerelease. It does not use the GitHub sync token or `NERDGRAM_GITHUB_TOKEN`, and it does not send telemetry. The answer is cached for about 24 hours in `<data>/.meta/updates.json`. If GitHub is offline, rate-limits the check, or has not published a release yet, the automatic check stays quiet. **Check for updates** says which of those it was: GitHub could not be reached, GitHub rate-limited the check, or a proxy or TLS inspection on this network is likely intercepting HTTPS. The TLS message links to [Corporate TLS inspection](troubleshooting.md#corporate-tls-inspection). **Check for updates** has no keyboard shortcut. Every click shows that it is checking, then the result or the error, including when the error is the same as the last one. How a checkout of `main` differs from a checkout of a release tag is under [Pin a version or move to another](releases.md#pin-a-version-or-move-to-another).

`NERDGRAM_UPDATE_CHECK=false` (also `0`, `off`, or `no`) turns checks off, including **Check for updates** and **Update now**. Clearing **Check for updates automatically** in About stops only the automatic check. The checkbox is stored in `updates.json`. **Include prereleases** in About opts in to prereleases. `NERDGRAM_UPDATE_INCLUDE_PRERELEASE=true` (also `1`, `yes`, or `on`) opts in from the environment even when the checkbox is clear.

**Git clone.** On a clean checkout of this repository whose `origin` is `https://github.com/NetworkNerd1337/NerdGram1337` (or the matching `git@github.com:` / `ssh://git@github.com/` URL), on `main` or a detached release tag, **Update now** fetches the tag, fast-forwards only, runs `npm ci` in the root, `client/`, and `server/`, then `npm run build`, and tells you to restart. It stops if the tree is dirty, if `origin` is some other repository, if the branch is not `main` and not detached, or if the release is not a fast-forward. It does not force, reset away uncommitted work, or modify `NERDGRAM_DATA_DIR`. Extra diagrams under the data folder are ignored by git and are not a reason to stop when the rest of the tree is clean.

`npm ci` replaces `node_modules` under the process that is running the update. If install or build fails, NerdGram tries to return to the previous commit with `git reset --keep` (or a detached checkout of that commit). That reset refuses to discard uncommitted work. If the process dies in the middle, automatic rollback may not run. The error names the previous commit. From the project root, when the working tree is still clean:

```bash
git reset --keep <previous>
```

Then run `npm ci`, `npm ci --prefix client`, `npm ci --prefix server`, and `npm run build` again. Your diagrams are untouched.

After a successful update, stop the process and start it again (`npm run dev`, or `npm start` for a production build), then reload the page.

**Docker.** The app does not update itself inside the container. **Show upgrade steps** copies the pull, stop, remove, and run commands. See [Upgrading](#upgrading). **Check again** after you recreate the container says whether the running version matches that release.

**ZIP or an unknown copy.** You can read the release notes. There is no **Update now**. Download the new ZIP and keep your `diagrams` folder, or the same `NERDGRAM_DATA_DIR`.

## Network diagrams

Refreshing a diagram after 1.5.0 draws `device.platform` on the device and `interface.description` on the Layer 2 link when the network file already set those fields. That is the intended drawing of data the file already had. A file that omits them draws the same diagram as before.

## Flowchart labels

A file that does not set `flowchart.wrappingWidth` now wraps node labels at 480px. Nodes with long labels can be wider than they were on 1.5.0. A file that already sets that width keeps it, and a style preset still does not change it.

## Public schema routes

`GET /api/v1/openapi.json`, `GET /api/v1/schema/network.json`, and `GET /api/v1/schema/graph.json` do not require a token. Host checks still apply. The network route serves the same document as `docs/schema/network.schema.json`. The repository file keeps `$id` `http://127.0.0.1:8787/api/v1/schema/network.json`. The served copy sets `$id` from the request host and port. On the default port, with Host `127.0.0.1:8787`, the bytes still match. No network fields were added, so a file that validated on 1.5.1 still validates.

## Translators

1.7.5 is the first Navigator release. It includes the 1.7.0 translator framework. There was no separate 1.7.0 release. `nerdgram convert` and `POST /api/v1/convert/<source>` turn a saved export into canonical network JSON. The translators store no credentials and make no outbound calls. Diagrams you already have are left as they are.

A link can set optional `inferred`. `true` draws a dashed edge. A file that omits `inferred` stays on `schemaVersion` 1 and draws the same solid edges as before. The translator list and the per-source notes are in [Translators](translators.md).

## Design exports

1.8.5 is the first Meridian release. It includes the 1.8.0 export framework. There was no separate 1.8.0 release. **Export as** can write a lab or inventory file from a diagram that has network JSON beside it. The exporters store no credentials and do not connect to a device. Diagrams you already have are left as they are.

## See also

- [Versioning and releases](releases.md)
- [Translators](translators.md)
- [Install](install.md)
- [Data and backups](data-and-backups.md)
- [Troubleshooting](troubleshooting.md)
