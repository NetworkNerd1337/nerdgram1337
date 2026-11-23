import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

const STORAGE_KEY = "nerdgram.settingsCards";

type CardsContext = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  focus: (id: string) => void;
  pin: (id: string) => void;
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
  scroll: { top: number; max: number; focus?: string | null },
): string | null {
  if (scroll.focus) return scroll.focus;
  if (cards.length === 0) return null;
  if (scroll.top <= 1) return cards[0]?.id ?? null;
  if (scroll.max > 8 && scroll.top >= scroll.max - 1) return cards[cards.length - 1]?.id ?? null;
  let best: SpyCard | null = null;
  for (const card of cards) {
    if (card.top <= probe + 0.5 && (best == null || card.top >= best.top)) best = card;
  }
  return (best ?? cards[0])?.id ?? null;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Scroll offset that puts the header on the sticky bar's bottom edge, clamped to the page. */
export function headerScrollTop(input: { scrollTop: number; headerTop: number; barBottom: number; maxScroll: number }): number {
  const desired = input.scrollTop + (input.headerTop - input.barBottom);
  const max = Math.max(0, input.maxScroll);
  return Math.min(max, Math.max(0, desired));
}

export type AlignSample = { headerTop: number; barBottom: number };

/** True once two samples in a row report the same header and bar. */
export function alignSampleSettled(previous: AlignSample | null, next: AlignSample): boolean {
  if (!previous) return false;
  return previous.headerTop === next.headerTop && previous.barBottom === next.barBottom;
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
  const pinned = useRef<string | null>(ids.includes(hashId) ? hashId : null);
  const alignGen = useRef(0);

  const persist = useCallback((next: Record<string, boolean>) => {
    setStored(next);
    writeStored(next);
  }, []);

  const mark = useCallback((id: string) => {
    pinned.current = id;
    setActiveId(id);
    setSpyId(id);
  }, []);

  const alignHeader = useCallback((id: string) => {
    if (pinned.current !== id) return false;
    const bar = document.querySelector(".settings-nav");
    const header = document.getElementById(id)?.querySelector(".settings-card-heading");
    if (!(header instanceof HTMLElement)) return false;
    const barHeight = bar instanceof HTMLElement ? bar.getBoundingClientRect().height : 0;
    const barBottom = bar instanceof HTMLElement ? bar.getBoundingClientRect().bottom : 0;
    document.documentElement.style.setProperty("--settings-nav-height", `${Math.ceil(barHeight) + 8}px`);
    const scrolling = document.scrollingElement ?? document.documentElement;
    const scrollTop = window.scrollY || scrolling.scrollTop;
    const maxScroll = Math.max(0, scrolling.scrollHeight - window.innerHeight);
    const top = headerScrollTop({ scrollTop, headerTop: header.getBoundingClientRect().top, barBottom, maxScroll });
    if (Math.abs(top - scrollTop) < 2) return false;
    window.scrollTo({ top, behavior: "smooth" });
    return true;
  }, []);

  const reveal = useCallback(
    (id: string) => {
      mark(id);
      setStored((current) => {
        if (current[id] === true) return current;
        const next = { ...current, [id]: true };
        writeStored(next);
        return next;
      });
      const gen = ++alignGen.current;
      let previous: AlignSample | null = null;
      let stableFrames = 0;
      const read = (): AlignSample | null => {
        const bar = document.querySelector(".settings-nav");
        const header = document.getElementById(id)?.querySelector(".settings-card-heading");
        if (!(header instanceof HTMLElement)) return null;
        return {
          headerTop: header.getBoundingClientRect().top,
          barBottom: bar instanceof HTMLElement ? bar.getBoundingClientRect().bottom : 0,
        };
      };
      const tick = () => {
        if (gen !== alignGen.current || pinned.current !== id) return;
        const next = read();
        if (next && alignSampleSettled(previous, next)) stableFrames += 1;
        else stableFrames = 0;
        previous = next;
        if (stableFrames >= 1) {
          alignHeader(id);
          return;
        }
        requestAnimationFrame(tick);
      };
      const card = document.getElementById(id);
      const bar = document.querySelector(".settings-nav");
      if (typeof ResizeObserver !== "undefined" && card instanceof HTMLElement) {
        const observer = new ResizeObserver(() => {
          if (gen !== alignGen.current || pinned.current !== id) {
            observer.disconnect();
            return;
          }
          previous = null;
          stableFrames = 0;
          requestAnimationFrame(tick);
        });
        observer.observe(card);
        if (bar instanceof HTMLElement) observer.observe(bar);
      }
      requestAnimationFrame(tick);
    },
    [alignHeader, mark],
  );

  const expand = useCallback(
    (id: string) => {
      persist({ ...stored, [id]: true });
      mark(id);
    },
    [mark, persist, stored],
  );

  const focus = useCallback(
    (id: string) => {
      reveal(id);
    },
    [reveal],
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
    reveal(id);
  }, [ids, initialHash, reveal]);

  useEffect(() => {
    const bar = document.querySelector(".settings-nav");
    if (!(bar instanceof HTMLElement) || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height) + 8;
      document.documentElement.style.setProperty("--settings-nav-height", `${height}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const measure = () => {
      if (pinned.current) return;
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
      if (!pinned.current) return;
      pinned.current = null;
      measure();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      release();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".settings-card, .settings-nav, input, textarea, select")) return;
      const scroller = document.scrollingElement ?? document.documentElement;
      if (target !== scroller && target !== document.documentElement && target !== document.body) return;
      release();
    };
    const onScrollEnd = () => {
      const id = pinned.current;
      if (!id) return;
      alignHeader(id);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [alignHeader, ids, stored]);

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
      pin: mark,
      activeId,
      activate: (id) => {
        if (!id) {
          setActiveId(null);
          return;
        }
        reveal(id);
      },
      spyId,
      setSpy: setSpyId,
    }),
    [activeId, expand, focus, mark, persist, reveal, spyId, stored],
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
            if (cards.isOpen(id)) {
              cards.toggle(id);
              cards.pin(id);
              return;
            }
            cards.focus(id);
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
