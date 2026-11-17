export const FONT_PRESETS = [
  { id: "system-ui", label: "System UI", value: "system-ui, sans-serif" },
  { id: "sans", label: "Sans-serif", value: "Arial, Helvetica, sans-serif" },
  { id: "serif", label: "Serif", value: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", value: "ui-monospace, Consolas, monospace" },
] as const;

export type FontSelection = { preset: "" | "custom" | (typeof FONT_PRESETS)[number]["value"]; custom: string };

/** Default clears `config.fontFamily`. A stored value that matches a preset selects that preset. */
export function fontSelection(value: string | null | undefined): FontSelection {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { preset: "", custom: "" };
  const match = FONT_PRESETS.find((preset) => preset.value === trimmed);
  if (match) return { preset: match.value, custom: "" };
  return { preset: "custom", custom: trimmed };
}
