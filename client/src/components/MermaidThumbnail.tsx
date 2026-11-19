import { Component, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { FALLBACK_THEME, thumbnailCacheKey } from "../lib/frontMatter";
import { renderMermaid } from "../lib/mermaidRender";
import { readFailureMessage } from "../lib/readError";
import { unreadableMessage } from "../../../server/src/readError.ts";
import { lookupThumbnailRecord, rememberThumbnail, scheduleThumbnail } from "../lib/thumbnailCache";
import { svgForImage } from "../../../server/src/svgImage.ts";

export type ThumbnailStatus = "pending" | "ready" | "empty" | "failed" | "unreadable";

type MermaidThumbnailProps = {
  path: string;
  mtimeMs: number;
  cacheKey?: string | null;
  /** Shown when the file's header is already known to be broken. */
  frontMatter?: boolean;
  /** Reports preview status so the card can match a parse error without a second check. */
  onStatus?: (status: ThumbnailStatus) => void;
};

type Status = ThumbnailStatus;

type LoadedThumb = {
  token: string;
  svg: string | null;
  status: Status;
  message?: string;
};

class ThumbnailBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="card-thumb">
          <span className="empty">Preview unavailable</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function ThumbnailBody({ path, mtimeMs, cacheKey, frontMatter = false, onStatus }: MermaidThumbnailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState<LoadedThumb | null>(null);
  const [attempt, setAttempt] = useState(0);
  const token = `${path}\0${mtimeMs}\0${cacheKey ?? ""}`;
  const memory = lookupThumbnailRecord(path, mtimeMs, cacheKey);
  const shown =
    loaded?.token === token
      ? loaded
      : {
          token,
          svg: memory?.status === "ready" ? memory.svg : null,
          status: (memory ? memory.status : "pending") as Status,
        };

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cached = lookupThumbnailRecord(path, mtimeMs, cacheKey);
    if (cached) return;
    if (!visible) return;

    const controller = new AbortController();
    let cancelled = false;
    const requestToken = `${path}\0${mtimeMs}\0${cacheKey ?? ""}`;

    void scheduleThumbnail(async () => {
      if (cancelled || controller.signal.aborted) return;
      try {
        const server = await api.thumbnail(path);
        if (cancelled) return;
        if (server.hit && server.svg) {
          rememberThumbnail({
            path,
            cacheKey: server.cacheKey,
            mtimeMs: server.mtimeMs,
            svg: server.svg,
            status: "ready",
          });
          if (!cancelled) setLoaded({ token: requestToken, svg: server.svg, status: "ready" });
          return;
        }
      } catch (err) {
        if (cancelled) return;
        const failure = readFailureMessage(path, err);
        if (failure) {
          setLoaded({ token: requestToken, svg: null, status: "unreadable", message: failure });
          return;
        }
        if (!(err instanceof ApiError)) {
          setLoaded({ token: requestToken, svg: null, status: "failed" });
          return;
        }
      }

      let file;
      try {
        file = await api.readFile(path);
      } catch (err) {
        if (cancelled) return;
        setLoaded({
          token: requestToken,
          svg: null,
          status: "unreadable",
          message: readFailureMessage(path, err) ?? unreadableMessage(path, ""),
        });
        return;
      }
      if (cancelled) return;

      try {
        const key = thumbnailCacheKey(file.content);
        if (!file.content.trim()) {
          rememberThumbnail({
            path,
            cacheKey: key,
            mtimeMs: file.mtimeMs,
            svg: null,
            status: "empty",
          });
          setLoaded({ token: requestToken, svg: null, status: "empty" });
          return;
        }
        const warmed = lookupThumbnailRecord(path, file.mtimeMs, key);
        if (warmed) {
          setLoaded({
            token: requestToken,
            svg: warmed.status === "ready" ? warmed.svg : null,
            status: warmed.status,
          });
          return;
        }
        const rendered = await renderMermaid(file.content, FALLBACK_THEME);
        if (cancelled) return;
        rememberThumbnail({
          path,
          cacheKey: key,
          mtimeMs: file.mtimeMs,
          svg: rendered.svg,
          status: "ready",
        });
        setLoaded({ token: requestToken, svg: rendered.svg, status: "ready" });
        void api.saveThumbnail(path, key, rendered.svg).catch(() => undefined);
      } catch {
        if (cancelled) return;
        const key = cacheKey ?? "";
        if (key) {
          rememberThumbnail({
            path,
            cacheKey: key,
            mtimeMs,
            svg: null,
            status: "failed",
          });
        }
        setLoaded({ token: requestToken, svg: null, status: "failed" });
      }
    }, controller.signal).catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, path, mtimeMs, cacheKey, attempt]);

  useEffect(() => {
    onStatus?.(shown.status);
  }, [shown.status, onStatus]);

  const retry = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLoaded({ token, svg: null, status: "pending" });
    setAttempt((value) => value + 1);
  };

  const message =
    shown.status === "unreadable"
      ? shown.message || "The file could not be read."
      : shown.status === "failed"
        ? "Preview unavailable"
        : shown.status === "empty"
          ? "Empty diagram"
          : "";
  const badge =
    shown.status === "unreadable" ? "Can't read file" : shown.status === "failed" ? "Parse error" : frontMatter ? "Front matter" : null;

  return (
    <div
      className={`card-thumb${shown.status === "unreadable" ? " is-unreadable" : ""}`}
      ref={rootRef}
      aria-busy={shown.status === "pending"}
      data-status={shown.status}
    >
      {badge ? (
        <span
          className={`thumb-badge${shown.status === "unreadable" ? " is-read" : ""}${shown.status === "failed" ? " is-parse" : ""}`}
          title={badge}
          aria-label={badge}
        >
          {badge}
        </span>
      ) : null}
      {shown.svg ? <SanitizedSvg svg={shown.svg} /> : <span className="empty">{inlineCode(message)}</span>}
      {shown.status === "unreadable" ? (
        <button type="button" className="btn btn-ghost thumb-retry" onClick={retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** File names in the server sentence are wrapped in backticks. */
function inlineCode(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
  );
}

function SanitizedSvg({ svg }: { svg: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const url = URL.createObjectURL(new Blob([svgForImage(svg)], { type: "image/svg+xml" }));
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
      image.removeAttribute("src");
    };
  }, [svg]);
  return <img ref={imageRef} alt="" />;
}

function SourceThumbnailBody({
  id,
  source,
  cacheKey,
}: {
  id: string;
  source: string;
  cacheKey: string;
}) {
  const cachePath = `\u0000template:${id}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState<{
    token: string;
    svg: string | null;
    status: Status;
  } | null>(null);
  const token = `${cachePath}\0${cacheKey}`;
  const memory = lookupThumbnailRecord(cachePath, 0, cacheKey);
  const shown =
    loaded?.token === token
      ? loaded
      : {
          token,
          svg: memory?.status === "ready" ? memory.svg : null,
          status: (memory ? memory.status : "pending") as Status,
        };

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (lookupThumbnailRecord(cachePath, 0, cacheKey)) return;
    const controller = new AbortController();
    let cancelled = false;
    const requestToken = token;

    void scheduleThumbnail(async () => {
      if (cancelled || controller.signal.aborted) return;
      if (!source.trim()) {
        rememberThumbnail({ path: cachePath, cacheKey, mtimeMs: 0, svg: null, status: "empty" });
        setLoaded({ token: requestToken, svg: null, status: "empty" });
        return;
      }
      try {
        const rendered = await renderMermaid(source);
        if (cancelled) return;
        rememberThumbnail({
          path: cachePath,
          cacheKey,
          mtimeMs: 0,
          svg: rendered.svg,
          status: "ready",
        });
        setLoaded({ token: requestToken, svg: rendered.svg, status: "ready" });
      } catch {
        if (cancelled) return;
        rememberThumbnail({ path: cachePath, cacheKey, mtimeMs: 0, svg: null, status: "failed" });
        setLoaded({ token: requestToken, svg: null, status: "failed" });
      }
    }, controller.signal).catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, cachePath, cacheKey, source, token]);

  const message =
    shown.status === "failed" ? "Preview unavailable" : shown.status === "empty" ? "Empty diagram" : "";

  return (
    <div className="card-thumb" ref={rootRef} aria-busy={shown.status === "pending"}>
      {shown.svg ? <SanitizedSvg svg={shown.svg} /> : <span className="empty">{message}</span>}
    </div>
  );
}

/** Preview a bundled template from its source. The theme comes from the file. */
export function SourceThumbnail({
  id,
  source,
  cacheKey,
}: {
  id: string;
  source: string;
  cacheKey: string;
}) {
  return (
    <ThumbnailBoundary>
      <SourceThumbnailBody id={id} source={source} cacheKey={cacheKey} />
    </ThumbnailBoundary>
  );
}

export function MermaidThumbnail(props: MermaidThumbnailProps) {
  return (
    <ThumbnailBoundary>
      <ThumbnailBody {...props} />
    </ThumbnailBoundary>
  );
}
