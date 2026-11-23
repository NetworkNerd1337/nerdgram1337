import { afterEach, describe, expect, it } from "vitest";
import { authenticateToken, createToken } from "../src/tokens.js";
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
});
