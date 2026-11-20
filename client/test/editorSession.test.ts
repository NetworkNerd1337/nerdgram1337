/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeLockHandoff,
  handoffStoredLock,
  readStoredLock,
} from "../src/lib/editorSession";

describe("editor lock handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("moves the stored lock to the new path and skips one release of the old path", () => {
    handoffStoredLock("Notes.mmd", "Renamed.mmd", "token-1", "tab-one");
    expect(readStoredLock("Notes.mmd")).toBeNull();
    expect(readStoredLock("Renamed.mmd")).toEqual({ token: "token-1", sessionId: "tab-one" });
    expect(consumeLockHandoff("Notes.mmd", "token-1")).toBe(true);
    expect(consumeLockHandoff("Notes.mmd", "token-1")).toBe(false);
    expect(consumeLockHandoff("Renamed.mmd", "token-1")).toBe(false);
  });
});
