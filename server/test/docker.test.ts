import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codenameForVersion, readCodenames } from "../src/updates/codename.js";
import { isDockerIgnored } from "../src/dockerContext.js";
import { bundledSampleFiles } from "../src/seed.js";
import { REPO_ROOT } from "../src/paths.js";

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, relative), "utf8");
}

describe("docker packaging", () => {
  it("publishes loopback only and pins the image tag to the package version", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const dockerfile = await read("Dockerfile");
    const compose = await read("compose.yaml");
    const ignore = await read(".dockerignore");
    const publish = await read(".github/workflows/docker-publish.yml");
    const ci = await read(".github/workflows/ci.yml");
    const release = await read(".github/workflows/release.yml");

    const codename = codenameForVersion(version, readCodenames());
    expect(dockerfile).toContain(`ARG NERDGRAM_VERSION=${version}`);
    expect(dockerfile).toContain(`ARG NERDGRAM_CODENAME=${codename}`);
    expect(dockerfile).toContain('org.opencontainers.image.codename="${NERDGRAM_CODENAME}"');
    expect(dockerfile).toContain("NERDGRAM_CODENAME=${NERDGRAM_CODENAME}");
    expect(dockerfile).toContain("HOST=0.0.0.0");
    expect(dockerfile).toContain("NERDGRAM_DATA_DIR=/data");
    expect(dockerfile).toContain("NERDGRAM_INSTALL=docker");
    expect(dockerfile).toContain("NERDGRAM_COMMIT");
    expect(dockerfile).toContain("COPY Dockerfile compose.yaml compose.build.yaml");
    expect(dockerfile).toContain("/api/health");
    expect(dockerfile).toContain("--uid 1001");
    expect(dockerfile).toContain("org.opencontainers.image.source");
    expect(dockerfile).toContain("org.opencontainers.image.revision");
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bgit\b/);

    expect(compose).toContain(`ghcr.io/networknerd1337/nerdgram1337:v${version}`);
    expect(compose).not.toMatch(/^\s*build\s*:/m);
    const buildCompose = await read("compose.build.yaml");
    expect(buildCompose).toContain("image: nerdgram1337:local");
    expect(buildCompose).toContain(`NERDGRAM_VERSION: "${version}"`);
    expect(buildCompose).toContain(`NERDGRAM_CODENAME: "${codename}"`);
    expect(compose).toContain("127.0.0.1:8787:8787");
    expect(compose).toContain("container_name: nerdgram1337");
    expect(compose).toContain("name: nerdgram-data");
    expect(compose).toContain("unless-stopped");
    expect(compose).not.toMatch(/(^|[\s"'])8787:8787/);
    expect(dockerfile).not.toMatch(/(^|[\s"'])8787:8787/);

    for (const needle of ["node_modules", ".git", ".meta", "github-token"]) {
      expect(ignore).toContain(needle);
    }

    expect(publish).toContain("packages: write");
    expect(publish).toContain("contents: read");
    expect(publish).not.toContain("pull_request");
    expect(publish).toContain("linux/amd64,linux/arm64");
    expect(publish).toContain("scripts/check-version.mjs");
    expect(publish).toContain("org.opencontainers.image.codename");
    expect(publish).toContain("NERDGRAM_CODENAME=${{ env.codename }}");
    expect(release).toContain("changelog-notes.mjs --title");
    expect(release).toContain("name: ${{ steps.notes.outputs.title }}");
    expect(release).toContain("id-token: write");
    expect(release).toContain("NPM_TOKEN");
    expect(release).toContain("--provenance");
    expect(release).toContain("cli/package.json");
    expect(release).toContain("Published nerdgram1337 with npm trusted publishing (OIDC).");
    expect(release).toContain("Falling back to NPM_TOKEN.");
    expect(ci).toContain("scripts/pack-cli-smoke.sh");
    expect(ci).toContain("scripts/check-supply-chain.mjs");
    expect(ci).toContain("persist-credentials: false");
    expect(publish).toContain('tags:\n      - "v*.*.*"');
    expect(release).toContain('tags:\n      - "v*.*.*"');
    expect(ci).toContain("scripts/docker-smoke.sh");
    expect(ci).toContain("push: false");
  });

  it("skips npm publishing unless NPM_PUBLISH_ENABLED is true", async () => {
    const release = await read(".github/workflows/release.yml");
    const publish = await read(".github/workflows/docker-publish.yml");
    const pause =
      "npm publishing is temporarily paused; this release is available via Docker (ghcr.io/networknerd1337/nerdgram1337) and from source. npm stays at the last published version.";
    const releaseJob = release.slice(0, release.indexOf("\n  npm:"));
    const npmJob = release.slice(release.indexOf("\n  npm:"));

    expect(releaseJob).toContain("Require a stable tag that matches package.json");
    expect(releaseJob).toContain("Publish GitHub Release");
    expect(releaseJob).toContain("generate_release_notes: false");
    expect(releaseJob).toContain(pause);
    expect(releaseJob).toContain("vars.NPM_PUBLISH_ENABLED != 'true'");
    expect(releaseJob).not.toContain("needs:");
    expect(npmJob.startsWith("\n  npm:")).toBe(true);
    expect(npmJob.split("vars.NPM_PUBLISH_ENABLED == 'true'").length - 1).toBe(5);
    expect(npmJob).toContain("if: ${{ vars.NPM_PUBLISH_ENABLED == 'true' }}");
    expect(npmJob).toContain("npm publish --provenance --access public");
    expect(npmJob).toContain("NPM_TOKEN");
    expect(npmJob).toContain("id-token: write");
    expect(npmJob).not.toContain("needs:");
    expect(npmJob).not.toContain("npm view");
    expect(npmJob).not.toContain("npm deprecate");
    expect(npmJob).not.toContain("dist-tag");
    expect(publish).toContain("push: true");
    expect(publish).toContain("type=raw,value=latest");
    expect(publish).toContain('tags:\n      - "v*.*.*"');
    expect(publish).not.toContain("NPM_PUBLISH_ENABLED");
    expect(publish).not.toContain("needs:");
  });

  it("ships every bundled sample, including ones added under diagrams/", async () => {
    const ignore = await read(".dockerignore");
    const samples = await bundledSampleFiles();
    expect(samples).toEqual(
      expect.arrayContaining(["Welcome.mmd", "NetworkMap.mmd", "Examples/Sequence.mmd", "WAN.mmd", "Sites/Atlanta.mmd"]),
    );
    const excluded = samples.filter((file) => isDockerIgnored(ignore, `diagrams/${file}`));
    expect(excluded).toEqual([]);

    const oldIgnore = [
      "diagrams/**",
      "!diagrams/Welcome.mmd",
      "!diagrams/NetworkMap.mmd",
      "!diagrams/Examples/",
      "!diagrams/Examples/Sequence.mmd",
    ].join("\n");
    expect(isDockerIgnored(oldIgnore, "diagrams/Welcome.mmd")).toBe(false);
    expect(isDockerIgnored(oldIgnore, "diagrams/WAN.mmd")).toBe(true);
    expect(isDockerIgnored(oldIgnore, "diagrams/Sites/Atlanta.mmd")).toBe(true);
  });
});
