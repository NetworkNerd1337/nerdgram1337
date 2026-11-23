import { createContext, useCallback, useContext, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";

const STORAGE_KEY = "nerdgram.settingsCards";

type CardsContext = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  setAll: (ids: readonly string[], open: boolean) => void;
  activeId: string | null;
  activate: (id: string | null) => void;
  spyId: string | null;
  setSpy: (id: string | null) => void;
};

const SettingsCardsContext = createContext<CardsContext | null>(null);

function readStored(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function writeStored(value: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The cards still open and close for this visit.
  }
}

/** Appearance starts open. Every other card starts collapsed until this browser remembers a choice. */
export function defaultCardOpen(id: string, stored: Record<string, boolean>): boolean {
  if (id in stored) return stored[id] === true;
  return id === "appearance";
}

export function SettingsCardsProvider({
  ids,
  initialHash = "",
  children,
}: {
  ids: readonly string[];
  initialHash?: string;
  children: ReactNode;
}) {
  const [stored, setStored] = useState<Record<string, boolean>>(readStored);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [spyId, setSpyId] = useState<string | null>(null);

  const persist = useCallback((next: Record<string, boolean>) => {
    setStored(next);
    writeStored(next);
  }, []);

  const expand = useCallback(
    (id: string) => {
      persist({ ...stored, [id]: true });
      setActiveId(id);
    },
    [persist, stored],
  );

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".settings-card, .settings-nav")) return;
      setActiveId(null);
    };
    document.addEventListener("click", onPointer);
    return () => document.removeEventListener("click", onPointer);
  }, []);

  useEffect(() => {
    const id = initialHash.replace(/^#/, "");
    if (!id || !ids.includes(id)) return;
    setStored((current) => {
      const next = { ...current, [id]: true };
      writeStored(next);
      return next;
    });
    setActiveId(id);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ids, initialHash]);

  useEffect(() => {
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);
    if (nodes.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          visible.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        setSpyId(best && best[1] > 0 ? best[0] : null);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.6] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [ids, stored]);

  const value = useMemo<CardsContext>(
    () => ({
      isOpen: (id) => defaultCardOpen(id, stored),
      toggle: (id) => persist({ ...stored, [id]: !defaultCardOpen(id, stored) }),
      setAll: (nextIds, open) => {
        const next = { ...stored };
        for (const id of nextIds) next[id] = open;
        persist(next);
      },
      expand,
      activeId,
      activate: setActiveId,
      spyId,
      setSpy: setSpyId,
    }),
    [activeId, expand, persist, spyId, stored],
  );

  return <SettingsCardsContext.Provider value={value}>{children}</SettingsCardsContext.Provider>;
}

export function useSettingsCards(): CardsContext | null {
  return useContext(SettingsCardsContext);
}

export function SettingsCard({
  id,
  title,
  summary,
  badge,
  className = "",
  children,
  onDragOver,
  onDrop,
}: {
  id: string;
  title: string;
  summary: string;
  badge?: string | null;
  className?: string;
  children: ReactNode;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  const cards = useSettingsCards();
  const open = cards ? cards.isOpen(id) : true;
  const active = cards?.activeId === id;
  const panelId = `${id}-panel`;
  return (
    <section
      className={`sync-card settings-card${open ? "" : " is-collapsed"}${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      id={id}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => cards?.activate(id)}
    >
      <h2 className="settings-card-heading">
        <button
          type="button"
          className="settings-card-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={(event) => {
            event.stopPropagation();
            if (!cards) return;
            cards.toggle(id);
            cards.activate(id);
          }}
        >
          <span className="settings-card-chevron" data-open={open ? "true" : "false"} aria-hidden="true" />
          <span className="settings-card-title">{title}</span>
          {badge ? <span className="settings-card-badge">{badge}</span> : null}
          <span className="settings-card-summary">{summary}</span>
        </button>
      </h2>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
