/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeLockHandoff,
  editorSessionId,
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

describe("editor session id", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("uses getRandomValues when randomUUID is missing", () => {
    const random = vi.spyOn(Math, "random");
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = editorSessionId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(random).not.toHaveBeenCalled();
      expect(editorSessionId()).toBe(id);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
      random.mockRestore();
    }
  });

  it("keeps randomUUID when it is available", () => {
    const random = vi.spyOn(Math, "random");
    try {
      const id = editorSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(random).not.toHaveBeenCalled();
      expect(editorSessionId()).toBe(id);
    } finally {
      random.mockRestore();
    }
  });
});
