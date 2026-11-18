/**
 * Files in `server/src/exporters/` that are not exporters.
 * A new target is any other `*.ts` file. Do not give an exporter one of these names.
 */
export const EXPORTER_INFRA = [
  "bundled",
  "helpers",
  "index",
  "infra",
  "limits",
  "registry",
  "request",
  "resolve",
  "run",
  "types",
] as const;
