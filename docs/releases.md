# Versioning and releases

Releases are semantic versions: `vX.Y.Z`, three numbers with no prerelease suffix.

[Back to the documentation index](README.md)

## Contents

- [Version numbers and code names](#version-numbers-and-code-names)
- [Where the version is shown](#where-the-version-is-shown)
- [Pin a version or move to another](#pin-a-version-or-move-to-another)
- [What the update check offers](#what-the-update-check-offers)
- [Cutting a release](#cutting-a-release)

Releases are semantic versions: `vX.Y.Z`, three numbers with no prerelease suffix. `X` is the major line, `Y` is the maintenance line, and `Z` is the patch. The root `package.json` `version` is the version of the tree you have. A GitHub Release and its git tag use the same numbers with a leading `v`.

This tree is v1.4.5, code name Atlas. v1.0.5 was the first release on this line, and v1.0.6 was the patch after it. Each published tag has a GitHub Release and a container image. Both are listed on the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases). Later 1.x.y releases stay Atlas. The image for this tree is `ghcr.io/networknerd1337/nerdgram1337:v1.4.5` once the `v1.4.5` tag is pushed.

## Version numbers and code names

Each major number has one code name for as long as that line is published. Maintenance releases keep the code name and change `Y` or `Z`.

| Major line | Code name | First release on that line |
| --- | --- | --- |
| 1 | Atlas | v1.0.5 |
| 2 | Meridian | v2.0.0 |

v1.0.5 was the first release. Every later 1.x.y release is still Atlas. v1.4.5 is the version of this tree. Meridian begins at v2.0.0 and is the name of every 2.x.y release after that.

Which number moves:

- **Patch (`Z`).** A small fix. The code name stays, and only the third number changes.
- **Minor (`Y`).** A larger maintenance change on the same major line. The second number increases, the third goes back to 0, and the code name stays.
- **Major (`X`).** A new line and a new code name. The one after Atlas is v2.0.0, Meridian.

The running app shows the version and the code name together. A 1.x.y build is Atlas. A 2.x.y build is Meridian. The `codenames` map in the root `package.json` is the source of truth (`"1"` is Atlas, `"2"` is Meridian). A major version with no entry fails `npm run version:check`. The GitHub Release title for a tag is `vX.Y.Z "Code name"`.

## Where the version is shown

- The bottom of the sidebar is **About** and the version with its code name, written `v1.4.5 "Atlas"`.
- **About NerdGram1337** in the command palette opens the same panel: that same version line, commit when there is one, and the install kind (git clone, Docker, ZIP, or unknown). It also links to the author, the issues page, this README, the MIT license, and Ko-fi. The header **Support** button opens Ko-fi in a new tab and is hidden during presentation.
- `GET /api/version` returns `name`, `version`, `codename`, `commit`, and `installKind`.
- `GET /api/health` returns those fields plus `"ok": true` and `dataDir`.
- When a newer release is available, the update banner and the release dialog show that release's code name, from the major number of the release tag. The update check still parses the tag for the version. It does not parse the release title as the version.

`commit` is a SHA baked in with `NERDGRAM_COMMIT`, or the git `HEAD` of a git install. Docker does not run git to find one. A Compose build that omits `NERDGRAM_COMMIT` reports `commit` as null.

## Pin a version or move to another

The Docker `pull` and `run` commands use `v1.4.5`, the Atlas tag for this tree, so they can be copied. Use the current tag on the [Releases page](https://github.com/NetworkNerd1337/NerdGram1337/releases) when you want a different release. Git and ZIP examples in this section still write the tag as `vX.Y.Z`. Substitute the release you want. `:latest` is not a version. It is the newest full release the image workflow has pushed.

**Docker, stay on one release.** Use the immutable tag `ghcr.io/networknerd1337/nerdgram1337:v1.4.5` in `docker run` and as the `image:` line in `compose.yaml`. `docker pull` of that tag gets that release again. Recreate the container on the same `nerdgram-data` volume when you change tags. The steps are [Update a Docker install](upgrading.md#update-a-docker-install). The workflow also pushes `sha-<commit>` for that build. Pin the `sha-` tag when you need that exact image rather than the version tag.

**Docker, take each full release.** Set the image to `ghcr.io/networknerd1337/nerdgram1337:latest`. When a new full release is published, `docker pull` of `:latest` moves, and you recreate the container on the same volume. `:latest` follows full releases. It is not a prerelease. `compose.yaml` as shipped pins `v1.4.5`, which matches `package.json`, not `:latest`. Change that pin when you want a different release, then `docker compose pull` and `docker compose up -d`.

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

## Cutting a release

This is the maintainer path. It is not part of installing the app. v1.0.5, code name Atlas, was the first release and is already tagged. A later release keeps the code name for the major and moves `Y` or `Z`. Do not invent a second numbering scheme for the image. Do not mark the GitHub Release as a prerelease. The update check offers full releases and reads the version from the tag.

1. Set the root `package.json` `version` to `X.Y.Z`. The `codenames` map in that file names each major (`"1"` is Atlas, `"2"` is Meridian). The current major has to have an entry. A major with no code name fails the check.
2. Run `npm run version:sync`. That copies the version into `client/package.json`, `server/package.json`, `cli/package.json`, the root version fields of the three lockfiles, the `ARG NERDGRAM_VERSION` lines in the Dockerfile, and the published image tag in `compose.yaml`. The local build args live in `compose.build.yaml`, tagged `nerdgram1337:local`. It also writes `ARG NERDGRAM_CODENAME` and the `NERDGRAM_CODENAME` build arg from the map. It does not rewrite this README. Update every real image tag in the README and the docs to the new version, including the Docker `pull` and `run` examples, the published image in [Data and backups](data-and-backups.md#data-and-backups), and the pin under [Pin a version or move to another](#pin-a-version-or-move-to-another). `npm run version:check` requires an image pin written out as `ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` with real numbers, or a `nerdgram1337@` example, to match `package.json`. The names v1.0.5, v1.0.6, and v2.0.0 are allowed in this section.
3. Run `npm run version:check`. It fails when those files disagree, when the current major has no code name, when `CHANGELOG.md` has no section for this version, and when a link in the README or the docs does not resolve. It also fails when `cli/package.json` drifts from the root version, when that package is not the public package `nerdgram1337` with the `nerdgram` command, or when `cli/LICENSE` does not match [`LICENSE`](../LICENSE).
4. Add a `CHANGELOG.md` section headed `## X.Y.Z "Code name" - YYYY-MM-DD`. The quoted code name has to match the map. The section body is the GitHub Release notes. The notes script also accepts `## X.Y.Z` and `## [X.Y.Z]`, with an optional code name and date, but `version:check` requires the code name on the heading. The release title is not taken from the heading. It is `vX.Y.Z "Code name"` from the tag and the map.
5. Commit and merge to `main`. Then, from `main`, tag the matching version and push the tag. `vX.Y.Z` is that version:

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

6. [`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes the GitHub Release when that tag is pushed. The title is `vX.Y.Z "Code name"`. The body is the changelog section. `node scripts/changelog-notes.mjs --title vX.Y.Z` prints the title. `node scripts/changelog-notes.mjs vX.Y.Z` prints the body.
7. [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) pushes `ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z`, `:latest`, and a `sha-<commit>` tag for `linux/amd64` and `linux/arm64`. It runs only for that tag. Pull requests do not push. The image is labeled with `org.opencontainers.image.version` and `org.opencontainers.image.codename`. The workflow then tries to mark the GHCR package public. If that call fails, the job warns and stays green. Set **Public** once in the [package settings](https://github.com/users/NetworkNerd1337/packages/container/nerdgram1337/settings) if the package is still private. Anonymous pulls already work once it is public.
8. [`.github/workflows/release.yml`](../.github/workflows/release.yml) also publishes the npm package `nerdgram1337` from `cli/`. The tag has to match `cli/package.json`. The job refuses to publish when it does not. It uses the `NPM_TOKEN` repository secret and `npm publish --provenance`. Provenance needs the workflow's `id-token: write` permission, which that job sets. If `NPM_TOKEN` is not set, the job prints a warning and does not fail the GitHub Release. Create the secret from an npm token that can publish `nerdgram1337` for the npm user `networknerd1337`. The package is public (`publishConfig.access` is `public`). Pull requests do not publish.

After the tag is pushed, check the release and the image:

- The GitHub Release title is `vX.Y.Z "Code name"`, and the body is that version's section of `CHANGELOG.md`, with no extra "What's Changed" list appended.
- `GET /api/version` on a build of that tag returns the same `version` and `codename`.
- `docker pull ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` succeeds. If the package is private, set it to **Public** once and pull again.
- `docker image inspect ghcr.io/networknerd1337/nerdgram1337:vX.Y.Z` shows `org.opencontainers.image.version` and `org.opencontainers.image.codename` for that release. A new container's `/api/health` returns the same version and code name, and an empty volume has `/data/Welcome.mmd`.
- `npm view nerdgram1337 version` prints that release once `NPM_TOKEN` is set. `npx nerdgram1337 --help` then prints the command list. If the secret was missing, the release log has a warning and this view does not show the new version yet.

## See also

- [Upgrading](upgrading.md)
- [Developing](developing.md)
- [Roadmap](roadmap.md)
