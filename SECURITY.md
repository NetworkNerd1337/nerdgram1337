# Security policy

NerdGram handles API tokens, GitHub sync credentials, and network inventory on your machine. Report a vulnerability in private. Do not open a public issue, and do not send real credentials.

## Supported versions

The latest minor release line gets fixes. That line is 1.7.x, code name Navigator. Older lines are not updated. The version list is [Versioning and releases](docs/releases.md).

| Version | Supported |
| --- | --- |
| 1.7.x | Yes |
| 1.6.x | No |
| 1.5.x | No |
| 1.0.x through 1.4.x | No |

## How to report

Use GitHub private vulnerability reporting. Open the Security tab of this repository, then choose **Report a vulnerability**. Do not open a public issue for a security report.

The maintainer turns private vulnerability reporting on in the repository settings. This file is the policy those reports follow.

## What to include

- The version, from the About screen, and whether you installed with Docker, npm, or from source.
- What you expected, what happened, and the steps that show it.
- The smallest diagram or request that demonstrates it. Remove tokens, passwords, and private addresses you do not want the maintainer to see.

Never send a real API token, a GitHub token, or a client secret. A redacted excerpt is enough.

## Response

This is a single-maintainer project. A report is read and answered on a best-effort basis. There is no promised response time.

## Security model

How the app binds to `127.0.0.1`, how the Host check works, and how tokens are stored is in [Security model](docs/security.md).
