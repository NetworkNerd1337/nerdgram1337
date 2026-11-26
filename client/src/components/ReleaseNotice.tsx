import { useContext } from "react";
import type { UpdateStatus } from "../types";
import { UpdateContext } from "./updateContext";

/** The tag to show beside the notice. Empty when this install is not strictly behind. */
export function releaseNoticeVersion(status: UpdateStatus | null | undefined): string | null {
  if (!status || status.error || status.phase !== "available" || !status.latest) return null;
  const tag = status.latest.tag.trim();
  if (!tag) return null;
  return tag.startsWith("v") ? tag : `v${status.latest.version}`;
}

/** The bottom toast repeats the chip. Hide it while the side pane is showing the notice. */
export function updateToastVisible(
  status: UpdateStatus | null | undefined,
  hidden: boolean,
): boolean {
  if (hidden || releaseNoticeVersion(status)) return false;
  return Boolean(status?.updateAvailable && !status.dismissed && !status.skipped);
}

/** Small cue at the top of the side pane. Uses the update status About already loaded. */
export function ReleaseNotice() {
  const update = useContext(UpdateContext);
  if (!update) return null;
  const version = releaseNoticeVersion(update.status);
  if (!version) return null;
  const open = () => update.openAbout();
  return (
    <button
      type="button"
      className="release-notice"
      aria-label={`New release available! ${version}. Opens About.`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
    >
      <span className="release-notice-title">New release available!</span>
      <span className="release-notice-version">{version}</span>
    </button>
  );
}
