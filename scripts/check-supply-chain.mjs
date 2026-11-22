import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shaPin = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const installHooks = ["preinstall", "install", "postinstall"];

function workflowFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...workflowFiles(full));
    else if (name.endsWith(".yml") || name.endsWith(".yaml")) files.push(full);
  }
  return files;
}

function packageFiles(dir, found = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) packageFiles(full, found);
    else if (name === "package.json") found.push(full);
  }
  return found;
}

export function unpinnedUses(text) {
  const problems = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^\s*-?\s*uses:\s*([^#\s]+)/.exec(line);
    if (!match) continue;
    const uses = match[1];
    if (uses.startsWith("./") || uses.startsWith("docker://")) continue;
    if (!shaPin.test(uses)) problems.push({ line: index + 1, uses });
  }
  return problems;
}

export function installScriptProblems(pkg) {
  const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  return installHooks.filter((name) => Object.prototype.hasOwnProperty.call(scripts, name));
}

function checkRepo(repoRoot) {
  const problems = [];
  const workflowDir = join(repoRoot, ".github", "workflows");
  for (const file of workflowFiles(workflowDir)) {
    const text = readFileSync(file, "utf8");
    for (const item of unpinnedUses(text)) {
      problems.push(`${relative(repoRoot, file)}:${item.line} uses ${item.uses} is not a 40-character SHA pin.`);
    }
  }
  for (const file of packageFiles(repoRoot)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      problems.push(`${relative(repoRoot, file)} is not valid JSON.`);
      continue;
    }
    const hooks = installScriptProblems(pkg);
    if (hooks.length > 0) {
      problems.push(`${relative(repoRoot, file)} must not define ${hooks.join(", ")}.`);
    }
  }
  return problems;
}

function selfCheck() {
  const bad = unpinnedUses("      - uses: actions/checkout@v4\n");
  if (bad.length !== 1) throw new Error("self-check missed a tag pin");
  const good = unpinnedUses("      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4.4.0\n");
  if (good.length !== 0) throw new Error("self-check rejected a SHA pin");
  const local = unpinnedUses("      - uses: ./.github/actions/local\n");
  if (local.length !== 0) throw new Error("self-check rejected a local action");
  if (!installScriptProblems({ scripts: { postinstall: "node x" } }).includes("postinstall")) {
    throw new Error("self-check missed postinstall");
  }
  if (installScriptProblems({ scripts: { test: "vitest" } }).length !== 0) {
    throw new Error("self-check flagged an ordinary script");
  }
}

const invoked = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invoked) {
  selfCheck();
  const problems = checkRepo(root);
  if (problems.length > 0) {
    console.error("Supply-chain check failed:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log("Workflow actions are SHA-pinned and no package.json install hook was added.");
}
