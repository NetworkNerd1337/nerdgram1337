import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { CONVERT_MAX_INPUT_BYTES } from "../../src/translators/limits.js";
import { REPO_ROOT } from "../../src/paths.js";
import { assertCanonical } from "../translatorHarness.js";

function capture() {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (chunk: string) => {
        out += chunk;
      },
      stderr: (chunk: string) => {
        err += chunk;
      },
      env: {} as NodeJS.ProcessEnv,
    },
    read: () => ({ out, err }),
  };
}

describe("nerdgram convert", () => {
  it("converts a file with the server down", async () => {
    const cap = capture();
    const file = path.join(REPO_ROOT, "docs/samples/translators/netbox/devices-only.json");
    const code = await main(["convert", "netbox", file], cap.io);
    const text = cap.read();
    expect(code, text.err).toBe(0);
    const document = JSON.parse(text.out) as unknown;
    assertCanonical(document);
    expect(text.err).toContain("No links");
    expect(text.out).not.toContain("No links");
  });

  it("reads stdin and writes a schema-valid file", async () => {
    const cap = capture();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-convert-"));
    const output = path.join(dir, "out.network.json");
    const raw = await fs.readFile(path.join(REPO_ROOT, "docs/samples/translators/librenms/devices-only.json"), "utf8");
    const code = await main(["convert", "librenms", "-o", output], { ...cap.io, stdin: raw });
    expect(code, cap.read().err).toBe(0);
    const document = JSON.parse(await fs.readFile(output, "utf8")) as unknown;
    assertCanonical(document);
    expect(cap.read().out).toContain(output);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports an unknown source and a file over 4 MiB", async () => {
    const unknown = capture();
    expect(await main(["convert", "missing", "--json"], { ...unknown.io, stdin: "{}" })).toBe(1);
    expect(unknown.read().out).toContain("Unknown translator");
    expect(unknown.read().out).toContain("netbox");

    const huge = capture();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-convert-size-"));
    const file = path.join(dir, "big.json");
    await fs.writeFile(file, "x".repeat(CONVERT_MAX_INPUT_BYTES + 1));
    expect(await main(["convert", "netbox", file], huge.io)).toBe(1);
    expect(huge.read().err).toContain("4 MiB");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
