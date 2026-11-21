/** Extensions stored next to a generated diagram and copied by GitHub sync. */
/** `.network.json` is listed before `.json` so a network file is not treated as a table. */
export const DATA_FILE_EXTENSIONS = [".network.json", ".csv", ".json", ".cdp", ".lldp", ".route"] as const;

export type DataFileExtension = (typeof DATA_FILE_EXTENSIONS)[number];

export function dataFileExtension(name: string): DataFileExtension | "" {
  const lower = name.toLowerCase();
  return DATA_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? "";
}

export function isDataFileName(name: string): boolean {
  return dataFileExtension(name) !== "";
}

export function extensionForFormat(format: string): "csv" | "json" | "cdp" | "lldp" | "network.json" | "route" {
  if (format === "network") return "network.json";
  if (format === "json" || format === "cdp" || format === "lldp" || format === "route") return format;
  return "csv";
}
