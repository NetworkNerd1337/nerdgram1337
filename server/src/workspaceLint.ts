import type { LintDiagnostic } from "./diagramLint.js";
import { lintDiagramSource } from "./mermaidSyntax.js";
import { reportUnreadable, type UnreadableDiagram } from "./readError.js";

export type WorkspaceLintResult = {
  checked: number;
  diagrams: { path: string; diagnostics: LintDiagnostic[] }[];
  unreadable: UnreadableDiagram[];
};

/**
 * Read and check each diagram on its own. A file that cannot be read is listed
 * and the loop continues, so one placeholder does not hide every other finding.
 */
export async function lintWorkspaceFiles(
  files: readonly { path: string }[],
  read: (filePath: string) => Promise<{ content: string }>,
): Promise<WorkspaceLintResult> {
  const diagramPaths = files.map((file) => file.path);
  const diagrams: { path: string; diagnostics: LintDiagnostic[] }[] = [];
  const unreadable: UnreadableDiagram[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = (await read(file.path)).content;
    } catch (err) {
      unreadable.push(reportUnreadable(file.path, err));
      continue;
    }
    const diagnostics = await lintDiagramSource(content, { diagramPaths, sourcePath: file.path });
    if (diagnostics.length > 0) diagrams.push({ path: file.path, diagnostics });
  }
  return { checked: files.length, diagrams, unreadable };
}
