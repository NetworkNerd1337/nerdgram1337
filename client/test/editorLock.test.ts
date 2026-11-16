import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import { EditorLockBanner, TakeoverDialog } from "../src/components/EditorLockBanner";
import {
  OTHER_WINDOW_NOTE,
  lockReleaseBeaconBody,
  releaseEditorLock,
  remoteLockAlert,
  remoteLockAlertWhileHeld,
  remoteLockSentence,
} from "../src/lib/editorLock";

describe("editor lock release", () => {
  it("queues application/json with sendBeacon so navigation cannot abort the release", async () => {
    const blob = lockReleaseBeaconBody("Notes.mmd", "token-1");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({ path: "Notes.mmd", token: "token-1" });

    const sent: { url: string; body: Blob }[] = [];
    const queued = releaseEditorLock("Notes.mmd", "token-1", {
      sendBeacon: (url, body) => {
        sent.push({ url, body });
        return true;
      },
      keepaliveRelease: () => {
        throw new Error("keepalive fetch should not run when beacon accepts the body");
      },
    });
    expect(queued).toBe(true);
    expect(sent[0]?.url).toBe("/api/lock/release");
    expect(sent[0]?.body.type).toBe("application/json");
    expect(JSON.parse(await sent[0].body.text())).toEqual({ path: "Notes.mmd", token: "token-1" });
  });

  it("falls back to a keepalive release when sendBeacon is unavailable", () => {
    const calls: { path: string; token: string }[] = [];
    const queued = releaseEditorLock("Notes.mmd", "token-1", {
      sendBeacon: () => false,
      keepaliveRelease: (path, token) => {
        calls.push({ path, token });
      },
    });
    expect(queued).toBe(false);
    expect(calls).toEqual([{ path: "Notes.mmd", token: "token-1" }]);
  });
});

describe("stale lock takeover", () => {
  it("posts takeover and accepts a lock the server reports as stale", async () => {
    const calls: { url: string; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          path: "Notes.mmd",
          token: "new-token",
          sessionId: "tab-two",
          heartbeatAt: new Date().toISOString(),
          acquiredAt: new Date(Date.now() - 120_000).toISOString(),
          heartbeatEveryMs: 15_000,
          staleAfterMs: 90_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const lock = await api.takeoverLock("Notes.mmd", "tab-two");
      expect(calls[0]?.url).toBe("/api/lock/takeover");
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ path: "Notes.mmd", sessionId: "tab-two" });
      expect(lock.token).toBe("new-token");
      expect(lock.staleAfterMs).toBe(90_000);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("keeps the diagram read-only when the other window still holds a fresh lock", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "This diagram is open in another window.",
          code: "locked",
          lock: { heartbeatAt: new Date().toISOString(), staleAfterMs: 90_000 },
        }),
        { status: 423, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      await expect(api.takeoverLock("Notes.mmd", "tab-two")).rejects.toMatchObject({
        status: 423,
        code: "locked",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("editor lock banner", () => {
  it("offers Take over editing on the read-only banner and explains the confirmation", () => {
    const banner = renderToStaticMarkup(
      createElement(EditorLockBanner, {
        note: OTHER_WINDOW_NOTE,
        readOnly: true,
        dirty: true,
        copyNote: null,
        onTakeOver: () => undefined,
        onSaveCopy: () => undefined,
      }),
    );
    expect(banner).toContain(OTHER_WINDOW_NOTE);
    expect(banner).toContain("Take over editing");
    expect(banner).toContain("Save a copy");

    const dialog = renderToStaticMarkup(
      createElement(TakeoverDialog, { onClose: () => undefined, onConfirm: () => undefined }),
    );
    expect(dialog).toContain("Take over editing?");
    expect(dialog).toContain("stopped refreshing");
    expect(dialog).toContain("still editing keeps the lock");
  });

  it("says another window on this computer for a lock held on this instance", () => {
    expect(OTHER_WINDOW_NOTE).toMatch(/another window on this computer/);
    expect(remoteLockAlert("Network Core", { sameInstance: true, instanceName: "Ryan's laptop", hostname: "RYAN-LAPTOP", acquiredAt: "2026-11-15T15:42:00.000Z", heartbeatAt: null, staleAfterMs: 90000, instanceId: "same" })).toBeNull();
    const banner = renderToStaticMarkup(
      createElement(EditorLockBanner, {
        note: OTHER_WINDOW_NOTE,
        remote: null,
        readOnly: true,
        dirty: false,
        copyNote: null,
        onTakeOver: () => undefined,
        onSaveCopy: () => undefined,
      }),
    );
    expect(banner).toContain("another window on this computer");
    expect(banner).not.toContain("instance-lock-alert");
  });

  it("names the other instance, the hostname when it differs, and how long the diagram has been open", () => {
    const acquiredAt = "2026-11-15T15:42:00.000Z";
    const remote = remoteLockAlert("Network Core", {
      sameInstance: false,
      instanceName: "Ryan's laptop",
      hostname: "RYAN-LAPTOP",
      acquiredAt,
      heartbeatAt: acquiredAt,
      staleAfterMs: 90_000,
      instanceId: "other",
    });
    expect(remote?.hostname).toBe("RYAN-LAPTOP");
    expect(remoteLockSentence(remote!)).toBe(
      `Network Core is open on Ryan's laptop (RYAN-LAPTOP) since ${remote?.since}. Try again when it's closed.`,
    );
    const banner = renderToStaticMarkup(
      createElement(EditorLockBanner, {
        note: "",
        remote,
        readOnly: true,
        dirty: true,
        copyNote: null,
        onTakeOver: () => undefined,
        onSaveCopy: () => undefined,
      }),
    );
    expect(banner).toContain('data-testid="instance-lock-alert"');
    expect(banner).toContain('role="alert"');
    expect(banner).toContain("<strong>Network Core</strong>");
    expect(banner).toContain("<strong>Ryan&#x27;s laptop</strong>");
    expect(banner).toContain("(RYAN-LAPTOP)");
    expect(banner).toContain(`since ${remote?.since}`);
    expect(banner).toContain("Try again when it&#x27;s closed.");
    expect(banner).toContain("Take over editing");
    expect(banner).toContain("Save a copy");

    const sameName = remoteLockAlert("Network Core", {
      sameInstance: false,
      instanceName: "RYAN-LAPTOP",
      hostname: "RYAN-LAPTOP",
      acquiredAt,
      heartbeatAt: acquiredAt,
      staleAfterMs: 90_000,
      instanceId: "other",
    });
    expect(sameName?.hostname).toBeNull();
    expect(remoteLockSentence(sameName!)).not.toContain("(RYAN-LAPTOP)");
    expect(remoteLockAlertWhileHeld(remote, false)).toBe(remote);
    expect(remoteLockAlertWhileHeld(remote, true)).toBeNull();
  });
});
