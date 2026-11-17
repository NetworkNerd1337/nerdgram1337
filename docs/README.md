# Documentation

Guides for installing NerdGram1337, using it, and working on it.

[Back to the README](../README.md)

## Pages

- [Install](install.md). Run NerdGram with Docker, or with Node.js on the machine.
- [Features](features.md). The dashboard lists folders and diagrams in a tree, with search and grid or list view.
- [Generate from data](generate-from-data.md). A CSV, JSON, or network JSON file can build the diagram.
- [GitHub sync](github-sync.md). GitHub sync is optional.
- [Configuration](configuration.md). Set a variable in the same terminal before `npm run dev` or `npm start`, so the process inherits it.
- [Team use](team-use.md). NerdGram has no accounts and no roles.
- [Automation API](api.md). `/api/v1` is for scripts, CI, and other tools.
- [Command-line tool](cli.md). `nerdgram` is the command-line client for NerdGram1337.
- [Security model](security.md). NerdGram1337 is a local, single-user personal tool.
- [Data and backups](data-and-backups.md). By default, diagrams live in `diagrams/` inside the project.
- [Upgrading](upgrading.md). Stop the app before you replace it.
- [Versioning and releases](releases.md). Releases are semantic versions: `vX.Y.Z`, three numbers with no prerelease suffix.
- [Roadmap](roadmap.md). Planned work after v1.4.4, still on the Atlas line.
- [Troubleshooting](troubleshooting.md). If the API port is taken, the server exits and prints the listen error.
- [Developing](developing.md). The project folders, the npm scripts, and what CI runs.

## Adding documentation

A new feature gets a section in the right page, or a new page when it is a whole topic, and a link from this index. The README only gets a one-line feature bullet and a link, never the reference detail.

### Page template

Every page starts with an H1 and a one-line summary, then a link back to this index. A page with more than about four sections has a Contents list. Sections are H2. Subsections are H3. The page ends with See also, a list of related pages. This index links back to the README. The other pages link here. Keep the heading marks, code fences, tables, and wording already used in these pages. Do not add front matter or HTML wrappers.

```text
# Title

One sentence that says what the page is.

[Back to the documentation index](README.md)

## Contents

- [Section](#section)

## Section

### Subsection

## See also

- [Related page](related.md)
```

Leave out Contents when the page has fewer than about four sections. See also stays.

### Where a new topic goes

Put the section on the page a reader would open for that topic. Install steps go in [Install](install.md). Something you do in the editor or on the dashboard goes in [Features](features.md). A whole topic, the way [Generate from data](generate-from-data.md) and [GitHub sync](github-sync.md) are, gets its own page and a line in Pages above. The README feature list gets one line and a link. It does not get the tables, the flags, or the steps.

## See also

- [NerdGram1337](../README.md)
- [License](../LICENSE)
