import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMetaPath } from "../src/paths.js";
import { authenticateToken, createToken, listTokens } from "../src/tokens.js";
import { makeTempDataDir } from "./helpers.js";

describe("automation tokens", () => {
  let cleanup = async () => {};

  afterEach(async () => {
    await cleanup();
  });

  it("keeps every token when creates and authentications overlap", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createToken({ name: `token ${index}`, scope: index % 2 === 0 ? "read" : "read-write" })),
    );
    const authed = await Promise.all(created.map((item) => authenticateToken(item.token)));
    expect(authed.every((token) => token !== null)).toBe(true);
    const again = await Promise.all(created.map((item) => authenticateToken(item.token)));
    expect(again.every((token) => token !== null)).toBe(true);
  });

  it("rejects a new token name over 40 and still lists a longer stored name", async () => {
    const temp = await makeTempDataDir();
    cleanup = temp.cleanup;
    await expect(createToken({ name: "T".repeat(41), scope: "read" })).rejects.toThrow(/1 to 40/);
    const long = "L".repeat(50);
    await fs.mkdir(getMetaPath(), { recursive: true });
    await fs.writeFile(
      path.join(getMetaPath(), "api-tokens.json"),
      JSON.stringify({
        version: 1,
        tokens: [
          {
            id: "a".repeat(18),
            name: long,
            prefix: "ng_legacy1",
            scope: "read",
            hash: "ab".repeat(32),
            createdAt: "2026-01-01T00:00:00.000Z",
            lastUsedAt: null,
            revokedAt: null,
          },
        ],
      }),
    );
    expect((await listTokens()).map((token) => token.name)).toEqual([long]);
  });
});
