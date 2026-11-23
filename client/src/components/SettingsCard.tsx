import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

const STORAGE_KEY = "nerdgram.settingsCards";

type CardsContext = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  focus: (id: string) => void;
  setAll: (ids: readonly string[], open: boolean) => void;
  activeId: string | null;
  activate: (id: string | null) => void;
  spyId: string | null;
  setSpy: (id: string | null) => void;
};

export type SpyCard = { id: string; top: number };

/**
 * The section in view is the card whose header is closest to, and at or above,
 * a line just under the sticky bar. Tops are visual, so two columns stay in
 * reading order. The first card wins at the top of the page, and the last card
 * wins when the page cannot scroll any further.
 */
export function chooseSpySection(
  cards: readonly SpyCard[],
  probe: number,
  scroll: { top: number; max: number },
): string | null {
  if (cards.length === 0) return null;
  if (scroll.top <= 1) return cards[0]?.id ?? null;
  if (scroll.max > 8 && scroll.top >= scroll.max - 1) return cards[cards.length - 1]?.id ?? null;
  let best: SpyCard | null = null;
  for (const card of cards) {
    if (card.top <= probe + 0.5 && (best == null || card.top >= best.top)) best = card;
  }
  return (best ?? cards[0])?.id ?? null;
}

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
  const hashId = initialHash.replace(/^#/, "");
  const [spyId, setSpyId] = useState<string | null>(ids.includes(hashId) ? hashId : (ids[0] ?? null));
  const lockUntil = useRef(0);

  const persist = useCallback((next: Record<string, boolean>) => {
    setStored(next);
    writeStored(next);
  }, []);

  const mark = useCallback((id: string) => {
    setActiveId(id);
    setSpyId(id);
  }, []);

  const expand = useCallback(
    (id: string) => {
      persist({ ...stored, [id]: true });
      mark(id);
    },
    [mark, persist, stored],
  );

  const focus = useCallback(
    (id: string) => {
      persist({ ...stored, [id]: true });
      mark(id);
      lockUntil.current = performance.now() + 800;
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [mark, persist, stored],
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
    mark(id);
    lockUntil.current = performance.now() + 800;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ids, initialHash, mark]);

  useEffect(() => {
    const update = () => {
      if (performance.now() < lockUntil.current) return;
      const bar = document.querySelector(".settings-nav");
      const probe = (bar?.getBoundingClientRect().bottom ?? 0) + 12;
      const cards = ids.flatMap((id) => {
        const node = document.getElementById(id);
        const header = node?.querySelector(".settings-card-heading") ?? node;
        if (!(header instanceof HTMLElement)) return [];
        return [{ id, top: header.getBoundingClientRect().top }];
      });
      const scrolling = document.scrollingElement ?? document.documentElement;
      const top = window.scrollY || scrolling.scrollTop;
      const max = Math.max(0, scrolling.scrollHeight - window.innerHeight);
      const next = chooseSpySection(cards, probe, { top, max });
      if (next) setSpyId(next);
    };
    const release = () => {
      lockUntil.current = 0;
      update();
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("scrollend", release);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scrollend", release);
    };
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
      focus,
      activeId,
      activate: (id) => {
        setActiveId(id);
        if (!id) return;
        setSpyId(id);
        lockUntil.current = performance.now() + 800;
      },
      spyId,
      setSpy: setSpyId,
    }),
    [activeId, expand, focus, persist, spyId, stored],
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
