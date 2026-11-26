import { randomUUID } from "node:crypto";

/** One id for this process. A container restart is a new boot, even when the instance id is kept. */
const processBootId = randomUUID();

export function currentBootId(): string {
  return processBootId;
}
