import { useEffect } from "react";

/** Sets the browser tab. A null title leaves the current one alone. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    document.title = title;
  }, [title]);
}
