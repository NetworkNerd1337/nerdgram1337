import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep this list equal to TRANSLATOR_INFRA in server/src/translators/infra.ts. */
const TRANSLATOR_INFRA = ["bundled", "helpers", "index", "infra", "limits", "registry", "request", "run", "types"];

/** Keep this list equal to EXPORTER_INFRA in server/src/exporters/infra.ts. */
const EXPORTER_INFRA = ["bundled", "helpers", "index", "infra", "limits", "registry", "request", "resolve", "run", "types"];

function moduleBundlePlugin(repoRoot, folder, infra, exportName, predicate) {
  const dir = join(repoRoot, folder);
  const filePattern = new RegExp(`[\\\\/]${folder.split("/").pop()}[\\\\/]bundled\\.ts$`);
  return {
    name: `nerdgram-${folder.split("/").pop()}`,
    setup(build) {
      build.onLoad({ filter: filePattern }, () => {
        const bases = readdirSync(dir)
          .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
          .map((name) => name.slice(0, -".ts".length))
          .filter((base) => !infra.includes(base))
          .sort();
        const imports = bases.map((base, index) => `import * as m${index} from ${JSON.stringify(`./${base}.ts`)};`);
        const taken = bases.map((base, index) => `take(m${index}, ${JSON.stringify(`${base}.ts`)})`);
        const contents = `${imports.join("\n")}
function take(mod, file) {
  const value = mod.default;
  if (!value || typeof value !== "object" || !(${predicate}) || typeof value.id !== "string") {
    throw new Error(file + " must default-export a module.");
  }
  return value;
}
export const ${exportName} = [${taken.join(", ")}];
`;
        return { contents, loader: "js", resolveDir: dir };
      });
    },
  };
}

function translatorBundlePlugin(repoRoot) {
  return moduleBundlePlugin(
    repoRoot,
    "server/src/translators",
    TRANSLATOR_INFRA,
    "bundledTranslators",
    "typeof value.convert === \"function\"",
  );
}

function exporterBundlePlugin(repoRoot) {
  return moduleBundlePlugin(
    repoRoot,
    "server/src/exporters",
    EXPORTER_INFRA,
    "bundledExporters",
    "typeof value.export === \"function\"",
  );
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "cli", "dist");

let esbuild;
try {
  esbuild = (await import("esbuild")).default;
} catch {
  console.error("esbuild is not installed. From the repository root, run npm ci, then pack the CLI again.");
  process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: { cli: "server/src/cli.ts" },
  plugins: [translatorBundlePlugin(root), exporterBundlePlugin(root)],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir,
  chunkNames: "chunk-[hash]",
  packages: "external",
  sourcemap: false,
  legalComments: "none",
  logOverride: { "empty-glob": "silent" },
});

const entry = readFileSync(join(outdir, "cli.js"), "utf8");
const startup = ["puppeteer", "mermaid", "cheerio", "yaml"];
const leaked = startup.filter((name) => new RegExp(`from ["']${name}["']`).test(entry));
if (leaked.length > 0) {
  console.error(`cli/dist/cli.js imports ${leaked.join(", ")} at startup. nerdgram --help has to run before those load.`);
  process.exit(1);
}

console.error("Built cli/dist from server/src/cli.ts.");
