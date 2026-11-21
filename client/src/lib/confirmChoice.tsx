import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog, type ConfirmOptions } from "../components/ConfirmDialog";

export type { ConfirmOptions };

let queue: Promise<unknown> = Promise.resolve();

/** One confirm at a time. The next waits until this one closes. */
export function confirmChoice(options: ConfirmOptions): Promise<boolean> {
  const run = queue.then(
    () => mountConfirm(options),
    () => mountConfirm(options),
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mountConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<ConfirmDialog {...options} onConfirm={() => finish(true)} onCancel={() => finish(false)} />);
  });
}
