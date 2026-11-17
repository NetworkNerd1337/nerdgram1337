# GitHub sync

GitHub sync is optional.

[Back to the documentation index](README.md)

Paths in this document use two placeholders, always in code formatting so GitHub does not treat the angle brackets as HTML tags. `<data>` is the data directory: `NERDGRAM_DATA_DIR` when that variable is set, and `diagrams/` inside the project when it is not. `<repo>` is the project folder, the git clone or the extracted ZIP.

GitHub sync is optional. The folder on this computer stays the copy NerdGram edits. A separate hidden folder, `<data>/.nerdgram-git`, is the git working copy. NerdGram does not turn the data directory into a git repository, and it does not need a git binary. Sync uses `isomorphic-git` inside the server. Turning sync off deletes that hidden folder and the saved authorization. The repository on GitHub stays in your account.

NerdGram does not ship a client ID or a client secret. You register an OAuth app in your own GitHub account. There is no operating-system keychain in a typical container. The token file mode `0600` is the stored secret.

**What is copied.** Synced files are the `.mmd` diagrams, the `.csv`, `.json`, `.network.json`, `.cdp`, and `.lldp` data files stored next to a generated diagram, and the folders that contain them. The commit also includes a short README, `.gitignore`, and `.gitattributes` so the GitHub repository can be read on its own. A one-file commit is `Update Network/Core.mmd`.

These stay on this computer and are not pushed:

- `.meta` (bookmarks, syntax overrides, trash, version history, editor locks, thumbnails, the search index, the update cache, and the GitHub token)
- any other hidden path, including `<data>/.templates/` (templates you saved with **Create as template**)
- `templates/` and `reference/`, which live outside the data directory

Empty folders are not stored, because git does not keep empty directories. A folder appears once it contains a diagram.

Edits wait until the workspace has been idle for 20 seconds (`NERDGRAM_SYNC_IDLE_MS`) and then become one commit. Autosave still writes the file about 500 ms after you type. That does not create a commit per keystroke. Renames, moves, deletes, imports, and restores commit after about a second. A change made in another program is picked up by a reconciliation scan about once a minute (`NERDGRAM_SYNC_RECONCILE_MS`), or when you choose **Sync now**.

If GitHub has commits that this computer does not, NerdGram does not force-push. **Pull** brings those changes into the local folder through the normal save path, including a local revision snapshot. An open editor is not overwritten. When both copies changed, you choose **Keep local**, **Keep both**, or **Use GitHub copy**.

Connected sync resumes when the server starts again.

**1. Register an OAuth app**

1. Open [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) and choose **New OAuth App**.
2. **Application name:** `NerdGram1337` (or any name you will recognize).
3. **Homepage URL:** `http://127.0.0.1:8787`
4. **Authorization callback URL:** `http://127.0.0.1:8787` (Device flow does not open this URL. GitHub's form still requires one.)
5. Register the app, then open it and enable **Device flow**.
6. Uncheck **Expire user access tokens**. GitHub turns this on for a new OAuth app. Leave it unchecked so the sign-in does not expire.
7. Copy the **Client ID**. You do not need the client secret for Device flow. Do not commit a client secret or put one in the NerdGram image.

If **Expire user access tokens** stays checked, GitHub issues an access token that lasts about 8 hours and a refresh token. NerdGram stores the access token, the refresh token, and both expiry times in `<data>/.meta/github-token` with mode `0600`. They are not written to `github-sync.json`. [GitHub's OAuth app documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token) says the refresh grant needs `client_secret` unless the token was created with the device flow. NerdGram signs in with the device flow, so it refreshes that token without a client secret. It refreshes before the access token expires, and one more time after a GitHub 401. A refresh token that did not come from the device flow is refreshed only when `NERDGRAM_GITHUB_CLIENT_SECRET` is set. Otherwise NerdGram stops and the status says the authorization expired and to connect again. A failed refresh does the same. Unchecking the box avoids that.

The Device flow requests the `repo` scope. That is the smallest classic OAuth scope that can create a private repository and read and write its contents. It is broader than a single-file permission because GitHub does not offer a contents-only OAuth scope that can also create the repository.

If the repository already exists, you can skip Device flow and set `NERDGRAM_GITHUB_TOKEN` to a fine-grained personal access token with **Contents: Read and write** on that one repository. No other repository permission is required. A GitHub App installed on that same repository can use the same limit: **Contents** read and write, and **Metadata** read. Put an installation or user token in `NERDGRAM_GITHUB_TOKEN`. NerdGram's Device flow itself is for an OAuth app, which is the flow above.

**2. Connect**

Open **GitHub sync** in the app (the page is `/settings`), or run **GitHub sync status** from the command palette. Paste the client ID and choose **Connect to GitHub**. The page shows a code and a link to [https://github.com/login/device](https://github.com/login/device). Approve the app there. Then create the repository. The default name is `nerdgram-diagrams` and it is private. If that name already has commits, NerdGram asks before adding your diagrams on top. It does not erase the existing history and it does not force-push.

You can set the client ID in the environment instead of the form. On macOS or Linux, `NERDGRAM_GITHUB_CLIENT_ID=Iv1.yourClientId` before the command. On a container, pass the same variable and keep the data directory on a volume. The token file is under that directory's `.meta` folder, so it survives a new container. See the [environment table](configuration.md#configuration) for the other shells.

Leave the client ID box empty and choose **Save client ID** to clear a client ID stored on this computer. An empty value is accepted. A value that is not a client ID is still rejected. `POST /api/sync/connect` before any GitHub account is connected answers **401** with code `not_connected`. Nothing was authorized, so the code is not `auth_revoked`. `auth_revoked` is reserved for a token GitHub has rejected.

**3. Where the token is stored**

| What | Where |
| --- | --- |
| Access token | `<data>/.meta/github-token`, mode `0600`, or `NERDGRAM_GITHUB_TOKEN` if that variable is set. The variable is not copied into the file. An older file is the token on one line. A newer file is JSON in the same path when GitHub also returned a refresh token. |
| Refresh token and expiry times | The same `github-token` file, mode `0600`. Never `github-sync.json`. |
| Sync settings (account, repository URL, no token) | `<data>/.meta/github-sync.json`, mode `0600` |
| Git working copy | `<data>/.nerdgram-git` (hidden; the app cannot open it as a diagram) |

The token is not returned to the browser, not written into the git remote URL or `.git/config`, not put in a commit, and not written to the log. Git pushes send it as HTTP Basic, username `x-access-token` and password the access token. The REST API sends it as `Authorization: Bearer`. Neither request puts the token in the URL. Update checks do not use this token. GitHub sync and update checks both call GitHub from the NerdGram process. In Docker that process is inside the container. A proxy that re-signs HTTPS is [Corporate TLS inspection](troubleshooting.md#corporate-tls-inspection).

`NERDGRAM_GITHUB_CLIENT_SECRET` is read from the environment only and is never stored. When it is set, NerdGram uses it to revoke the OAuth grant on disconnect, and sends it with a refresh for a token that did not come from the device flow. Device flow refresh does not need it. Without the secret, disconnect still deletes the local token. Revoke the grant yourself at [GitHub → Settings → Applications](https://github.com/settings/apps/authorizations). Delete the OAuth app from Developer settings when you want the app registration gone too. Disconnect does not delete the repository.

**4. Disconnect**

**Disconnect** asks you to confirm. The dialog states that the GitHub repository stays in your account. NerdGram then stops syncing, deletes `.nerdgram-git`, and deletes the saved token and sync settings. Diagrams in the data directory stay where they are.

## See also

- [Configuration](configuration.md)
- [Team use](team-use.md)
- [Security model](security.md)
- [Troubleshooting](troubleshooting.md)
