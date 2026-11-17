import fs from "node:fs/promises";

/**
 * Diagram text reads go through this object so a test can inject one read error
 * without replacing the filesystem for every other call.
 */
export const textFiles = {
  read(abs: string): Promise<string> {
    return fs.readFile(abs, "utf8");
  },
};
