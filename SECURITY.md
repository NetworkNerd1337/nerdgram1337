# Security policy

NerdGram handles API tokens, GitHub sync credentials, and network inventory on your machine. Report a vulnerability in private. Do not open a public issue, and do not send real credentials.

## Supported versions

Support covers the life of a major.minor line. The supported line is 2.1. Every 2.1.x patch is supported until the next minor or major release, for example 2.2.0 or 3.0.0. After that release, 2.1.x gets no support and no fixes. Within the line, only the newest patch is published. That patch is 2.1.24. Security fixes land there. 2.1.24 is on Docker and GHCR. npm resumes with the next release. 2.1.22, 2.1.23, and 2.1.24 were Docker and GHCR only. npm latest stays 2.1.21 until that release publishes, and 2.1.21 is not deprecated. Pull `ghcr.io/networknerd1337/nerdgram1337:latest` for this release. When a milestone release is published, the previous release is deprecated immediately and loses support that same day. Its GHCR version tag stays published for 30 days. After 30 days, that GHCR version tag is removed. Only the previous release gets that grace period. npm versions older than 2.1.21 are deprecated and are not supported. Their GHCR tags have been removed. 2.1.23 is the previous Docker image and GitHub Release. It was superseded on 2026-11-24, when 2.1.24 was published. Its GHCR tag stays through 2026-12-24. 2.1.23 was never published to npm. npm latest stays 2.1.21 until the next release publishes, and 2.1.21 is not deprecated. Pinning an older version is not supported long term. 2.1.0 through 2.1.4 are Zenith. 2.1.5 and later 2.1 patches are Azimuth. Git tags stay for history. The version list is [Versioning and releases](docs/releases.md). How Actions and npm publishing are pinned is in [Repository supply chain](docs/security.md#repository-supply-chain).

| Version | Supported |
| --- | --- |
| 2.1.x | Yes |
| Everything below 2.1 | No |

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
