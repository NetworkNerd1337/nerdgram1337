export type ExportWarningItem = {
  path?: string;
  message: string;
};

/**
 * Note shown after a lab or automation download. Null when the export
 * returned no warnings, so a clean file adds nothing to the editor.
 */
export function labExportNotice(
  name: string,
  warnings: readonly ExportWarningItem[] | null | undefined,
): { title: string; items: string[] } | null {
  const list = (warnings ?? []).filter((item) => item.message.trim().length > 0);
  if (list.length === 0) return null;
  const review = list.length === 1 ? "1 thing to review" : `${list.length} things to review`;
  return {
    title: `Exported ${name}, ${review}`,
    items: list.map((item) => {
      const path = item.path?.trim();
      return path ? `${path}: ${item.message}` : item.message;
    }),
  };
}
