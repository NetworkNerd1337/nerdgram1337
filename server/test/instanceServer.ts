import type { AddressInfo } from "node:net";
import { startServer } from "../src/listen.js";

const fixedBind = process.env.NERDGRAM_TEST_FIXED_BIND !== "0";
const servers = await startServer({
  port: 0,
  mode: "production",
  ...(fixedBind ? { hosts: ["127.0.0.1"] } : {}),
});
const address = servers[0]?.address();
if (!address || typeof address === "string") {
  console.error("NerdGram test instance failed to bind");
  process.exit(1);
}
process.stdout.write(`READY ${(address as AddressInfo).port}\n`);
