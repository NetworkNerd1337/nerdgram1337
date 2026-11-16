# Developing

The project folders, the npm scripts, and what CI runs.

[Back to the documentation index](README.md)

```
NerdGram1337/                  (or NerdGram1337-main/ from the ZIP)
├── package.json               install:all, dev, build, start, lint, test, version:check, version:sync
├── compose.yaml               published image, loopback publish, read-only root, nerdgram-data
├── compose.build.yaml         local build, tagged nerdgram1337:local
├── Dockerfile                 Node 22 bookworm-slim image, uid 1001, HOST=0.0.0.0 inside
├── client/                    React + Vite UI
├── server/                    Express API
├── cli/                       npm package nerdgram1337, command name nerdgram
├── diagrams/                  samples, including WAN and Sites/Atlanta
├── templates/                 six bundled starters
├── reference/                 offline Mermaid syntax pages
├── scripts/                   version check, version sync, changelog notes, docker smoke, CLI pack smoke
├── docs/demo.gif              animated README demo
├── docs/images/               README screenshots
├── docs/README.md             documentation index
├── screenshots/               earlier captures and the full-quality recording
└── .github/workflows/         ci.yml, release.yml, docker-publish.yml
```

`npm install` adds `node_modules/` at the root, in `client/`, and in `server/`. Leave those folders in place.

| Command | What it does |
| --- | --- |
| `npm run install:all` | Install root, client, and server dependencies. |
| `npm run dev` | API on 127.0.0.1:8787 and Vite on localhost:5173. |
| `npm run build` | Client `dist/` and server `dist/`. |
| `npm start` | Production server. |
| `npm test` | Server Vitest, then client Vitest. |
| `npm run lint` | Oxlint in `client/`. |
| `npm run version:check` | Versions, the `nerdgram1337` package name, Dockerfile, compose.yaml, the README, and the docs. |
| `npm run version:sync` | Copy the root version into the client, server, cli, Dockerfile, compose.yaml, and compose.build.yaml. |
| `npm run sync:reference` | Refresh the offline syntax mirror. |

Server tests set `fileParallelism: false` in `server/vitest.config.ts` because they share `NERDGRAM_DATA_DIR`. Client tests set the same flag in `client/vite.config.ts`. Client lint is oxlint. `react/rules-of-hooks` is an error. The current tree also reports known warnings: `react(set-state-in-effect)` in the workspace, editor, settings, and reference pages, and `eslint(no-useless-escape)` in the Mermaid completion pattern. `react/only-export-components` is set to warn in `client/.oxlintrc.json`.

CI (`.github/workflows/ci.yml`) has two jobs. **verify** checks out the repo, uses Node 20, runs `node scripts/check-version.mjs`, which checks versions and Markdown links, `npm ci` for the root, client, and server, then fails if `git status --porcelain` is not empty, so a lockfile cannot drift from its `package.json`. It then runs lint, build, and test. It then runs `bash scripts/pack-cli-smoke.sh`, which dry-runs `npm pack` in `cli/` to validate the file list, then packs for real, installs that tarball in a clean directory, and runs `nerdgram --help`, a local `lint`, and `npx` from the tarball. **docker** uses Node 22, runs the version check, builds the image with `push` left false, and runs `bash scripts/docker-smoke.sh`. That script starts the image on `127.0.0.1:8787` with a read-only root and `tmpfs` on `/tmp`, checks health, templates, the syntax reference, a JSON write, uid 1001, mode `0600` on a token file, the absence of a git binary, and that a diagram is still there after `docker stop` and `docker start`. A root-owned bind mount must fail. A bind mount owned by `1001:1001` must accept a write. The script removes only the containers, volume, and temp directories it created.

## See also

- [Install](install.md)
- [Versioning and releases](releases.md)
- [Troubleshooting](troubleshooting.md)
