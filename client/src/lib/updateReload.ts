import { confirmChoice } from "./confirmChoice";

/**
 * A reload after an update has to warn before it interrupts a presentation
 * or throws away unsaved editor text.
 */
export function reloadWarning(flags: { presenting: boolean; unsaved: boolean }): string | null {
  const parts: string[] = [];
  if (flags.presenting) {
    parts.push("A presentation is open. Reloading will close it.");
  }
  if (flags.unsaved) {
    parts.push("This diagram has unsaved edits. Reloading can discard them.");
  }
  if (parts.length === 0) return null;
  return `${parts.join(" ")} Reload now?`;
}

export async function requestUpdateReload(): Promise<void> {
  const message = reloadWarning({
    presenting: document.body.dataset.presenting === "true",
    unsaved: document.body.dataset.unsaved === "true",
  });
  if (message) {
    const ok = await confirmChoice({
      title: "Reload now?",
      message,
      confirmLabel: "Reload",
      danger: false,
    });
    if (!ok) return;
  }
  window.location.reload();
}
