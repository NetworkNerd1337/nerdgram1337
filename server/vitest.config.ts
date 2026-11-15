import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const instanceFile = path.join(os.tmpdir(), `nerdgram-vitest-instance-${process.pid}.json`);

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: {
      NERDGRAM_INSTANCE_FILE: instanceFile,
    },
    // The data directory is process.env.NERDGRAM_DATA_DIR. Keep files sequential.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
