/**
 * One exporter is one file. The registry discovers it. The CLI and the
 * export routes never name a target.
 *
 * The text is whatever the target wants. YAML, JSON, and XML are all
 * ordinary strings. A target that needs several files (a Nornir inventory)
 * returns one entry per file. The framework does not assume a format.
 */

import type { NetworkDocument } from "../network/types.js";

export type ExportWarning = {
  /** JSON pointer into the network document. Empty when the warning is about the whole file. */
  path: string;
  message: string;
};

/** One file in the export. `name` is a relative path using forward slashes. */
export type ExportFile = {
  name: string;
  text: string;
};

export type ExportResult = {
  files: ExportFile[];
  warnings: ExportWarning[];
};

/**
 * Operator rows from a mapping file. Keys are target-defined
 * (`platform`, `role`, `kind`, `os`, and so on). The framework does not
 * interpret them.
 */
export type MappingRow = Record<string, string>;

export type ExportContext = {
  /** Diagram stem, or `nerdgram` when the input is a bare network file or stdin. */
  label: string;
  /** Rows for this target only. Null when the operator did not supply a file. */
  mapping: MappingRow[] | null;
};

/**
 * Installed exporter. `id` is the CLI name and the `/export/<id>` segment.
 * `extension` has no leading dot and may contain a dot (`clab.yml`).
 * An empty extension means the file names live entirely in `files`.
 */
export type ExporterModule = {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  description: string;
  export: (document: NetworkDocument, context: ExportContext) => ExportResult;
};

export type ExporterInfo = {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  description: string;
};
