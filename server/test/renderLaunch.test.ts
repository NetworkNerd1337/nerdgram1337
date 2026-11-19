import { afterEach, describe, expect, it, vi } from "vitest";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));

vi.mock("puppeteer", () => ({
  default: { launch },
}));

import { closeRenderer, renderDiagram } from "../src/renderDiagram.js";

const SOURCE = "flowchart LR\n  A-->B\n";

function fakeBrowser() {
  return {
    connected: true,
    newPage: vi.fn(async () => {
      throw new Error("stop after launch");
    }),
    close: vi.fn(async () => undefined),
  };
}

const ENV_KEYS = ["PUPPETEER_EXECUTABLE_PATH", "NERDGRAM_INSTALL", "NERDGRAM_RENDER_LAUNCH_TIMEOUT_MS"] as const;

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("renderer launch", () => {
  afterEach(async () => {
    launch.mockReset();
    await closeRenderer();
  });

  it("uses chrome-headless-shell when no executable is configured", async () => {
    const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.NERDGRAM_INSTALL;
    delete process.env.NERDGRAM_RENDER_LAUNCH_TIMEOUT_MS;
    launch.mockResolvedValue(fakeBrowser());
    try {
      await renderDiagram({ source: SOURCE, format: "svg" }).catch(() => undefined);
      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch.mock.calls[0][0]).toMatchObject({ headless: "shell", timeout: 30_000 });
      expect(launch.mock.calls[0][0].executablePath).toBeUndefined();
    } finally {
      restoreEnv(saved);
    }
  });

  it("launches PUPPETEER_EXECUTABLE_PATH as full Chromium", async () => {
    const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.PUPPETEER_EXECUTABLE_PATH = "  /usr/bin/chromium  ";
    process.env.NERDGRAM_RENDER_LAUNCH_TIMEOUT_MS = "120000";
    delete process.env.NERDGRAM_INSTALL;
    launch.mockResolvedValue(fakeBrowser());
    try {
      await renderDiagram({ source: SOURCE, format: "svg" }).catch(() => undefined);
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          executablePath: "/usr/bin/chromium",
          timeout: 120_000,
        }),
      );
    } finally {
      restoreEnv(saved);
    }
  });

  it("logs a renderer launch failure with the cause", async () => {
    const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.NERDGRAM_INSTALL;
    launch.mockRejectedValue(new Error("rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(renderDiagram({ source: SOURCE, format: "svg" })).rejects.toMatchObject({
        status: 503,
        code: "renderer",
        message: "The diagram renderer could not start.",
      });
      expect(launch).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toContain("Diagram renderer failed to start:");
      expect(logged).toContain("rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2");
    } finally {
      spy.mockRestore();
      restoreEnv(saved);
    }
  });
});
