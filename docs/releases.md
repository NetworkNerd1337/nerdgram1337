# Versioning and releases

Releases are semantic versions: `vX.Y.Z`, three numbers with no prerelease suffix.

[Back to the documentation index](README.md)

## Contents

- [Version numbers and code names](#version-numbers-and-code-names)
- [Supported versions](#supported-versions)
- [Where the version is shown](#where-the-version-is-shown)
- [Pin a version or move to another](#pin-a-version-or-move-to-another)
- [What the update check offers](#what-the-update-check-offers)
- [Release policy](#release-policy)
- [Cutting a release](#cutting-a-release)

Releases are semantic versions: `vX.Y.Z`, three numbers with no prerelease suffix. `X` is the major line, `Y` is the maintenance line, and `Z` is the patch. The root `package.json` `version` is the version of the tree you have. A GitHub Release and its git tag use the same numbers with a leading `v`.

This tree is v2.1.26, code name Azimuth. v1.0.5 was the first release, code name Atlas, and v1.0.6 was the patch after it. Each published tag has a GitHub Release, listed on the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases). GHCR keeps `v2.1.26` and `:latest`. The previous release stays published for 30 days after it is deprecated. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. The image for this tree is `ghcr.io/networknerd1337/nerdgram1337:v2.1.26`.

## Version numbers and code names

A code name belongs to a milestone. The key in the map is the major and the minor where that name starts. The name covers every patch of that minor until a later patch key. It also covers later minors of the same major until the next key. The last key of a major covers only its own minor, so a later minor stays unnamed until it has a key. A minor before the first key of that major stays unnamed. A patch stays on the name of its minor unless a patch key starts a new name.

| Versions | Code name | First release |
| --- | --- | --- |
| 1.0.y through 1.4.y | Atlas | v1.0.5 |
| 1.5.y | Compass | 1.5.0 |
| 1.6.y | Galileo | 1.6.0 |
| 1.7.y, including 1.7.0 and 1.7.5 | Navigator | 1.7.0 |
| 1.8.y, including 1.8.0 and 1.8.5 | Meridian | 1.8.0 |
| 2.1.0 through 2.1.4 | Zenith | 2.1.0 |
| 2.1.5 and later 2.1.y | Azimuth | 2.1.5 |

v1.0.5 was the first release, code name Atlas. 1.4.8 is the last Atlas release. This tree is v2.1.26, code name Azimuth. There was no separate 1.8.0 tag. 1.8.5 ships milestone 1.8.0 and milestone 1.8.5. Compass is the name of every 1.5.y release. Galileo is every 1.6.y release. Navigator is every 1.7.y release, including 1.7.0 and 1.7.5. Meridian is every 1.8.y release, including 1.8.0 and 1.8.5. 1.9 is not named. 2.0 is not named. 2.1.0 through 2.1.4 are Zenith. 2.1.5 and later 2.1 patches are Azimuth. 2.1.0 is the first Zenith release. 2.1.5 is the first Azimuth release.

Which number moves:

- **Patch (`Z`).** A small fix. The code name stays, and only the third number changes.
- **Minor (`Y`).** A larger change on the same major line. The second number increases and the third goes back to 0. The code name changes when that minor has its own entry in the map.
- **Major (`X`).** A new line. It starts at minor 0. 2.0 is not named. 2.1.0 through 2.1.4 are Zenith. 2.1.5 is Azimuth.

The running app shows the version and the code name together. A 1.0.y through 1.4.y build is Atlas. A 1.5.y build is Compass. A 1.6.y build is Galileo. A 1.7.y build is Navigator. A 1.8.y build is Meridian. A 2.1.0 through 2.1.4 build is Zenith. A 2.1.5 or later 2.1 patch is Azimuth. 2.0.y is not named. The `codenames` map in the root `package.json` is the source of truth (`"1.0"` is Atlas, `"1.5"` is Compass, `"1.6"` is Galileo, `"1.7"` is Navigator, `"1.8"` is Meridian, `"2.1"` is Zenith, `"2.1.5"` is Azimuth). The key is the major and the minor where the name starts, or a later patch when the name changes inside that minor. A release whose minor has no entry fails `npm run version:check`. 1.9 and 2.0 have no entry. A later 2.y has no entry until it is added. The GitHub Release title for a tag is `vX.Y.Z Code name`.

## Supported versions

Support covers the life of a major.minor line. Every 2.1.x patch is supported until the next minor or major release, for example 2.2.0 or 3.0.0. After that release, 2.1.x gets no support and no fixes. Within a line, only the newest patch is published. That patch is 2.1.26. Security fixes land there. 2.1.26 is published to npm, Docker and GHCR, and the GitHub Release. 2.1.25 is the previous release. It was deprecated on 2026-11-24, and its npm version and GHCR tag stay through 2026-12-24. 2.1.22, 2.1.23, and 2.1.24 were Docker and GHCR only and were never published to npm. Pull `ghcr.io/networknerd1337/nerdgram1337:latest` for this release. Versions below 2.1 are not supported. When a milestone release is published, the previous release is deprecated immediately and loses support that same day. `npm deprecate` marks it with an "upgrade to latest" message when npm publishing is on. Its npm version and GHCR version tag stay published for 30 days, so pinned installs keep working while people upgrade. After 30 days, that GHCR version tag is removed. Only the previous release gets that grace period. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Git tags stay for a checkout. The table is in the [security policy](../SECURITY.md#supported-versions).

## Where the version is shown

- **About** is in the top-right header, next to **Support**. Its tooltip is the version with its code name, written `v2.1.26 Azimuth`. The sidebar does not have an About row. On a narrow dashboard, About and Support stay in a bar above the sidebar.
- **About NerdGram1337** in the command palette opens the same panel: that same version line, **latest** or **upgrade available** when a check confirms it, the Mermaid engine version when the build recorded one, commit when there is one, and the install kind (git clone, Docker, ZIP, or unknown). Engine reads **Mermaid** and that version, and links to the matching mermaid-js release. The row is left out when the build did not record a version. It also links to the author, the issues page, this README, the MIT license, and Ko-fi. The header **Support** button opens Ko-fi in a new tab and is hidden during presentation.
- `GET /api/version` returns `name`, `version`, `codename`, `commit`, and `installKind`.
- `GET /api/health` returns those fields plus `"ok": true` and `dataDir`.
- When a newer release is available, the update banner and the release dialog show that release's code name, from the milestone key for that tag. The update check still parses the tag for the version. It does not parse the release title as the version.

`commit` is a SHA baked in with `NERDGRAM_COMMIT`, or the git `HEAD` of a git install. Docker does not run git to find one. A Compose build that omits `NERDGRAM_COMMIT` reports `commit` as null.

## Pin a version or move to another

The Docker `pull` and `run` commands use `v2.1.26`, the Azimuth tag for this tree, so they can be copied. GHCR keeps that tag and `:latest`. The previous release stays published for 30 days after it is deprecated, then its tag is removed. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Git and ZIP examples in this section still write the tag as `vX.Y.Z`. Those Git tags stay. Substitute the release you want for a git or ZIP checkout. `:latest` is not a version. It is the newest full release the image workflow has pushed.

**Docker, stay on one release.** Use the immutable tag `ghcr.io/networknerd1337/nerdgram1337:v2.1.26` in `docker run` and as the `image:` line in `compose.yaml`. `docker pull` of that tag gets that release again. Recreate the container on the same `nerdgram-data` volume when you change tags. The steps are [Update a Docker install](upgrading.md#update-a-docker-install). The workflow also pushes `sha-<commit>` for that build. GHCR keeps `v2.1.26` and `:latest`. The previous release's tag stays for 30 days after it is deprecated, then it is removed. An older GHCR tag, including an older `sha-` tag, has been removed. npm versions older than 2.1.21 are deprecated and are not supported.

**Docker, take each full release.** Set the image to `ghcr.io/networknerd1337/nerdgram1337:latest`. When a new full release is published, `docker pull` of `:latest` moves, and you recreate the container on the same volume. `:latest` follows full releases. It is not a prerelease. `compose.yaml` as shipped pins `v2.1.26`, which matches `package.json`, not `:latest`. Change that pin to `:latest` when you want each new full release, then `docker compose pull` and `docker compose up -d`. Do not pin an image tag older than the previous release. Only that release stays for 30 days. Pinning an older version is not supported long term.

**Git, track `main`.** Check out `main` and pull. You get the commits on `main`. That history can contain commits the latest release tag does not. The update check's **ahead** state compares the `version` in this tree's `package.json` with the latest stable release tag. It is not a count of extra commits. **Update now** runs only when this is a clean checkout of the official origin, on `main` or a detached release tag, and the release tag is a fast-forward. On `main` it merges that tag with `--ff-only`, then runs `npm ci` and `npm run build`. You are still on `main` afterwards. If the tag is not a fast-forward from this checkout, **Update now** refuses it as not a fast-forward and does not reset you back to the tag.

**Git, stay on a release tag.** Fetch the tag and check it out. Git detaches `HEAD`. There is no branch to move.

```bash
git fetch origin tag vX.Y.Z
git checkout vX.Y.Z
npm run install:all
npm run build
npm start
```

**Update now** on that detached checkout checks out the newer stable tag, still detached, and only when the new tag is a fast-forward from the commit you have. It does not create a branch and it does not merge into `main`. Leave **Update now** alone when you want to remain on the tag you checked out. To move on purpose, fetch and `git checkout` the other tag, then `npm run install:all` again. To go back to development, `git checkout main`.

**Update now** does not run on any other branch. The message tells you to check out `main`. It also does not run when the tree is dirty, when `origin` is not this repository, or when the release is not a fast-forward. The recovery if `npm ci` dies in the middle is in [In-app updates](upgrading.md#in-app-updates).

**ZIP.** Download the archive for a published tag:

`https://github.com/NetworkNerd1337/NerdGram1337/archive/refs/tags/vX.Y.Z.zip`

There is no **Update now**. Extract it, run `npm run install:all`, and keep your `diagrams/` folder or the same `NERDGRAM_DATA_DIR`, as in [Update a ZIP copy](upgrading.md#update-a-zip-copy). An archive of `main` is not a release.

## What the update check offers

With the default settings the check asks GitHub for the latest full release and ignores prereleases. **Update now** and **Show upgrade steps** accept only a stable `vX.Y.Z` tag. A tag with a prerelease suffix is not applied. About has an **Include prereleases** checkbox, and `NERDGRAM_UPDATE_INCLUDE_PRERELEASE=true` (also `1`, `yes`, or `on`) includes prereleases in the lookup. Leave both off. They do not make **Update now** install a prerelease.

## Release policy

Changes merge to `main` through issues and pull requests. A pull request does not bump the version or set a code name. It adds a note under `## Unreleased` in `CHANGELOG.md`.

Those notes are on `main` as soon as the pull request merges. Anyone who runs NerdGram from a cloned repository on `main` gets them. They are not in the npm package or the GHCR images until the next milestone release.

The version bump, the code name, the git tag, the npm publish, and the GHCR image happen only at a milestone release. That path is [Cutting a release](#cutting-a-release). The repository variable `NPM_PUBLISH_ENABLED` gates the npm job. It is set to `true`. Unset it to skip npm. The tag still creates the GitHub Release and the GHCR image.

When that milestone is published, the previous release is deprecated immediately and loses support that same day. `npm deprecate` marks that npm release with an "upgrade to latest" message. 2.1.22, 2.1.23, and 2.1.24 were Docker and GHCR only and were never published to npm. 2.1.25 and 2.1.26 publish to npm. 2.1.25 is the previous release and was deprecated on 2026-11-24. Its npm version and GHCR version tag stay published for 30 days, so pinned installs keep working while people upgrade. After 30 days, that GHCR version tag is removed. Only the previous release gets that grace period. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. Pinning an older version is not supported long term. Install or upgrade to the latest release. Git tags stay, so a checkout of an old tag still works.

Support lasts for one major.minor line. Every 2.1.x patch is supported until the next minor or major release, for example 2.2.0 or 3.0.0. From then on, 2.1.x gets no support and no fixes. Inside the line, only the newest patch is published. The details are under [Supported versions](#supported-versions).

## Cutting a release

This is the maintainer path for a milestone release. A normal pull request does not do these steps. It is not part of installing the app. v1.0.5, code name Atlas, was the first release and is already tagged. A later release keeps the code name of its minor when that minor is already named, and moves `Y` or `Z`. A minor with its own map entry takes that name. Do not invent a second numbering scheme for the image. Do not mark the GitHub Release as a prerelease. The update check offers full releases and reads the version from the tag.

1. Set the root `package.json` `version` to `X.Y.Z`. The `codenames` map in that file names each milestone (`"1.0"` is Atlas, `"1.5"` is Compass, `"1.6"` is Galileo, `"1.7"` is Navigator, `"1.8"` is Meridian, `"2.1"` is Zenith, `"2.1.5"` is Azimuth). The current minor has to have an entry, or be covered by an earlier key in that major until the next one. A minor with no code name fails the check when it is the version you are cutting. 1.9 and 2.0 are not named. 2.1.0 through 2.1.4 are Zenith. 2.1.5 is Azimuth.
2. Run `npm run version:sync`. That copies the version into `client/package.json`, `server/package.json`, `cli/package.json`, the root version fields of the three lockfiles, the `ARG NERDGRAM_VERSION` lines in the Dockerfile, and the published image tag in `compose.yaml`. It also cuts `CHANGELOG.md` as described in step 4. The local build args live in `compose.build.yaml`, tagged `nerdgram1337:local`. It also writes `ARG NERDGRAM_CODENAME` and the `NERDGRAM_CODENAME` build arg from the map. It does not rewrite this README. Update every real image tag in the README and the docs to the new version, including the Docker `pull` and `run` examples, the published image in [Data and backups](data-and-backups.md#data-and-backups), and the pin under [Pin a version or move to another](#pin-a-version-or-move-to-another). `npm run version:check` requires an image pin written out as `ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` with real numbers, or a `nerdgram1337@` example, to match `package.json`. The names v1.0.5, v1.0.6, and v2.0.0 are allowed in this section.
3. Run `npm run version:check`. It fails when those files disagree, when the current minor has no code name, when `CHANGELOG.md` has no section for this version, when `## Unreleased` is missing or blank, and when a link in the README or the docs does not resolve. It also fails when `cli/package.json` drifts from the root version, when that package is not the public package `nerdgram1337` with the `nerdgram` command, or when `cli/LICENSE` does not match [`LICENSE`](../LICENSE).
4. Keep pending notes under `## Unreleased`, above the numbered releases. When nothing is pending, that section is the line `_No unreleased items._`. A blank Unreleased heading is not allowed: it looks like the heading for the release below it, and `npm run version:check` fails. `npm run version:sync` is what cuts the release notes. If this version does not have a section yet and Unreleased has real notes, it moves those notes under `## X.Y.Z "Code name" - YYYY-MM-DD` (the date is the UTC day the command runs) and sets Unreleased back to `_No unreleased items._`. If the version section is already there, it does not copy the notes a second time. Notes that are still only under Unreleased stay there for the next release. You can edit the new section after that. The quoted code name has to match the map. The section body is the GitHub Release notes. `_No unreleased items._` is not part of that body. The notes script also accepts `## X.Y.Z` and `## [X.Y.Z]`, with an optional code name and date, but `version:check` requires the code name on the heading. The release title is not taken from the heading. It is `vX.Y.Z "Code name"` from the tag and the map.
5. Commit and merge to `main`. Then, from `main`, tag the matching version and push the tag. `vX.Y.Z` is that version:

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

6. [`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes the GitHub Release when that tag is pushed. The title is `vX.Y.Z Code name`. The body is the changelog section. `node scripts/changelog-notes.mjs --title vX.Y.Z` prints the title. `node scripts/changelog-notes.mjs vX.Y.Z` prints the changelog body.
7. [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) pushes `ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z`, `:latest`, and a `sha-<commit>` tag for `linux/amd64` and `linux/arm64`. It runs only for that tag. Pull requests do not push. The image is labeled with `org.opencontainers.image.version` and `org.opencontainers.image.codename`. The workflow then tries to mark the GHCR package public. If that call fails, the job warns and stays green. Set **Public** once in the [package settings](https://github.com/users/NetworkNerd1337/packages/container/nerdgram1337/settings) if the package is still private. Anonymous pulls already work once it is public.
8. [`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes the npm package `nerdgram1337` from `cli/`. The repository variable `NPM_PUBLISH_ENABLED` is set to `true`, so the npm job runs. Unset it to skip npm. The GitHub Release and the GHCR image still go out. The tag has to match `cli/package.json`. The job refuses to publish when it does not. It tries trusted publishing first, then the `NPM_TOKEN` repository secret, and both paths use `npm publish --provenance`. Provenance needs the workflow's `id-token: write` permission, which that job sets. If trusted publishing fails and `NPM_TOKEN` is not set, the npm job fails. The GitHub Release is a separate job and still goes out. Keep `NPM_TOKEN` until a trusted publish succeeds. Create it from an npm token that can publish `nerdgram1337` for the npm user `networknerd1337`. The package is public (`publishConfig.access` is `public`). Pull requests do not publish.

After the tag is pushed, check the release and the image:

- The GitHub Release title is `vX.Y.Z Code name`, and the body is that version's section of `CHANGELOG.md`, with no extra "What's Changed" list appended.
- `GET /api/version` on a build of that tag returns the same `version` and `codename`.
- `docker pull ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` succeeds. If the package is private, set it to **Public** once and pull again.
- `docker image inspect ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` shows `org.opencontainers.image.version` and `org.opencontainers.image.codename` for that release. A new container's `/api/health` returns the same version and code name, and an empty volume has `/data/Welcome.mmd`.
- `npm view nerdgram1337 version` prints that release. `npx nerdgram1337 --help` then prints the command list.

## See also

- [Upgrading](upgrading.md)
- [Developing](developing.md)
- [Roadmap](roadmap.md)
