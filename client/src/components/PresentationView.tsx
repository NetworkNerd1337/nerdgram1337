import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { DrillTrail } from "./DrillTrail";
import { NodeFindBar } from "./NodeFindBar";
import { RenderProgress } from "./RenderProgress";
import { useDiagramView } from "../hooks/useDiagramView";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStageSize } from "../hooks/useStageSize";
import { useViewGestures } from "../hooks/useViewGestures";
import { actionForClickTarget, clickTargetOnElement, openExternalLink } from "../lib/diagramClicks";
import { sessionJump, sessionOpen, sessionStart, sessionSyncRoot, type DrillSession } from "../lib/drillSession";
import { diagramHeading, FALLBACK_THEME, parseDiagram } from "../lib/frontMatter";
import { presentTitle } from "../lib/pageTitle";
import { PRESENTATION_NARROW_QUERY, ROTATE_HINT_KEY } from "../lib/presentationLayout";
import { settingsBlockTooltip } from "../lib/problemText";
import { renderMermaid } from "../lib/mermaidRender";
import { countDiagramNodes, renderGuarded } from "../lib/renderWait";
import {
  flowchartNodes,
  matchNodes,
  nodeFindKey,
  nodeFindShortcut,
  nodePointInDiagram,
  stepMatch,
} from "../lib/nodeFind";
import { useNodeMeta } from "../hooks/useNodeMeta";
import {
  currentFullscreen,
  exitPresentationFullscreen,
  PRESENTATION_ROOT_ID,
  requestPresentationFullscreen,
} from "../lib/presentationFullscreen";
import {
  isCodeEditorTarget,
  isFormField,
  keyEventFrom,
  presentationAction,
  type PresentationAction,
} from "../lib/presentationKeys";
import { readSvgSize } from "../lib/svgBox";
import { backgroundFromSvg, themeBackground } from "../lib/svgBackground";
import { cssTransform, fitModeLabel, shouldSuggestRotate, ZOOM_STEP, type Size } from "../lib/viewTransform";

const CONTROL_IDLE_MS = 2500;

export type PresentationViewProps = {
  /** Null while a file read is still in flight. */
  source: string | null;
  path: string;
  /** Colour key for a read-only revision diff. The source is the preview, not the file. */
  diffLegend?: boolean;
  fileError?: string | null;
  onExit: () => void;
  /** Cancel a long render and leave Present. The editor shows the cancelled message. */
  onRenderCancelled?: () => void;
};

function slideFor(path: string, source: string | null, error: string | null) {
  const title = diagramHeading(source ? parseDiagram(source).title : null, path || "diagram");
  return { path, title, source, error };
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea")];
}

export function PresentationView({
  source,
  path,
  fileError = null,
  onExit,
  diffLegend = false,
  onRenderCancelled,
}: PresentationViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const engaged = useRef(false);
  const overBar = useRef(false);
  const activityRef = useRef<(() => void) | null>(null);
  const gestureClickRef = useRef<((info: { target: EventTarget | null }) => void) | null>(null);
  const idleTimer = useRef(0);
  const barVisibleRef = useRef(true);
  const idleRef = useRef(false);
  const hadSvg = useRef(false);
  const handledPress = useRef(false);

  const [session, setSession] = useState<DrillSession>(() => sessionStart(slideFor(path, source, fileError)));
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [knownPaths, setKnownPaths] = useState<string[] | null>(null);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderOverlay, setRenderOverlay] = useState<string | null>(null);
  const [nodeQuery, setNodeQuery] = useState<string | null>(null);
  const [nodeIndex, setNodeIndex] = useState(0);
  const nodeQueryRef = useRef<string | null>(null);
  const nodeCountRef = useRef(0);
  const renderDrop = useRef(false);
  const setNodeQueryNow = (value: string | null) => {
    nodeQueryRef.current = value;
    setNodeQuery(value);
  };
  const [content, setContent] = useState<Size | null>(null);
  const [titleOn, setTitleOn] = useState(true);
  const [barVisible, setBarVisible] = useState(true);
  const [idle, setIdle] = useState(false);
  const [nativeFs, setNativeFs] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const compact = useMediaQuery(PRESENTATION_NARROW_QUERY);
  const [rotateHintDismissed, setRotateHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(ROTATE_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const viewport = useStageSize(stageRef);
  const camera = useDiagramView(viewport, content);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  onExitRef.current = onExit;
  const gestures = useViewGestures({
    stageRef,
    wheelTargetRef: rootRef,
    camera,
    rotate: true,
    doubleTap: true,
    activityRef,
    onClickRef: gestureClickRef,
  });

  const frame = session.slides[session.index] ?? session.slides[0] ?? slideFor(path, source, fileError);
  const nodeMeta = useNodeMeta(frame.source);
  const nodeMatches = useMemo(
    () => matchNodes(flowchartNodes(frame.source ?? ""), nodeQuery ?? "", nodeMeta),
    [frame.source, nodeMeta, nodeQuery],
  );
  useEffect(() => {
    nodeCountRef.current = nodeMatches.length;
  }, [nodeMatches.length]);

  useEffect(() => {
    if (nodeQuery === null) return;
    const match = nodeMatches[nodeIndex];
    const root = stageRef.current;
    if (!root || !match || !content) return;
    root.querySelectorAll(".node.is-found").forEach((node) => node.classList.remove("is-found"));
    const node = [...root.querySelectorAll<SVGGElement>(".node")].find((item) =>
      item.id.includes(`flowchart-${match.id}-`),
    );
    if (!node) return;
    node.classList.add("is-found");
    const moved = node.getAttribute("transform")?.match(/translate\(\s*([-0-9.]+)[,\s]+([-0-9.]+)/);
    if (!moved) return;
    camera.centerOn(
      nodePointInDiagram({ x: Number(moved[1]), y: Number(moved[2]) }, content),
      1.5,
    );
  }, [camera, content, nodeIndex, nodeMatches, nodeQuery]);
  const parsed = useMemo(() => (frame.source == null ? null : parseDiagram(frame.source)), [frame.source]);
  const heading = frame.title || diagramHeading(parsed?.title, frame.path || "diagram");
  const effectiveTheme = parsed?.malformed ? FALLBACK_THEME : (parsed?.theme ?? FALLBACK_THEME);
  const background =
    backgroundFromSvg(svg) ??
    themeBackground(effectiveTheme, parsed?.themeVariables ?? null) ??
    themeBackground(FALLBACK_THEME) ??
    "#333333";

  const settingsTitle = parsed?.malformed
    ? settingsBlockTooltip(parsed.errorLine, null, parsed.error)
    : "";
  const notices: string[] = [];
  if (frame.error) notices.push(frame.error);
  if (linkMessage) notices.push(linkMessage);
  if (parsed?.malformed) notices.push("Settings error");
  if (renderError && !parsed?.malformed) notices.push(renderError);
  if (frame.source != null && !frame.source.trim() && !frame.error) notices.push("This diagram has nothing to show.");
  const notice = notices.join(" ");

  useEffect(() => {
    const previous = document.title;
    document.title = presentTitle(heading);
    return () => {
      document.title = previous;
    };
  }, [heading]);

  useEffect(() => {
    if (!compact || idle) setMoreOpen(false);
  }, [compact, idle]);

  useEffect(() => {
    setSession((current) => sessionSyncRoot(current, slideFor(path, source, fileError)));
  }, [path, source, fileError]);

  useEffect(() => {
    let cancelled = false;
    void api.tree().then(
      (result) => {
        if (!cancelled) setKnownPaths(diagramPathsIn(result.tree));
      },
      () => {
        if (!cancelled) setKnownPaths(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    hadSvg.current = false;
    setSvg("");
    setRenderError(null);
    setContent(null);
    setLinkMessage(null);
  }, [frame.path]);

  useEffect(() => {
    const currentSource = frame.source;
    if (currentSource == null) return;
    let alive = true;
    renderDrop.current = false;
    const delay = hadSvg.current ? 280 : 0;
    const timer = window.setTimeout(() => {
      const parsedSource = parseDiagram(currentSource);
      const text = parsedSource.malformed ? parsedSource.body : currentSource;
      if (!text.trim()) {
        if (alive) setRenderError(null);
        return;
      }
      void renderGuarded({
        nodeCount: countDiagramNodes(text),
        showOverlay: (label) => {
          if (alive) setRenderOverlay(label);
        },
        hideOverlay: () => {
          if (alive) setRenderOverlay(null);
        },
        cancelled: () => !alive || renderDrop.current,
        run: () => renderMermaid(text, FALLBACK_THEME),
      }).then(
        (outcome) => {
          if (!alive || renderDrop.current || !outcome.ok) return;
          hadSvg.current = true;
          setSvg(outcome.value.svg);
          setRenderError(null);
        },
        (err: unknown) => {
          if (!alive || renderDrop.current) return;
          setRenderError(err instanceof Error ? err.message : "Could not render this diagram");
        },
      );
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      setRenderOverlay(null);
    };
  }, [frame.source]);

  useLayoutEffect(() => {
    const node = canvasRef.current?.querySelector("svg");
    if (!(node instanceof SVGSVGElement)) return;
    const next = readSvgSize(node);
    if (!next) return;
    setContent((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [svg]);

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      previous?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.dataset.presenting = "true";
    document.body.style.overflow = "hidden";
    return () => {
      delete document.body.dataset.presenting;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let cancelled = false;
    const onChange = () => {
      if (cancelled) return;
      const active = currentFullscreen() === element && element.isConnected;
      setNativeFs(active);
      if (engaged.current && element.isConnected && currentFullscreen() !== element) {
        engaged.current = false;
        onExitRef.current();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    void requestPresentationFullscreen().then((ok) => {
      if (cancelled) return;
      engaged.current = ok && currentFullscreen() === element;
      setNativeFs(engaged.current);
    });
    return () => {
      cancelled = true;
      engaged.current = false;
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const revealBar = () => {
    window.clearTimeout(idleTimer.current);
    if (!barVisibleRef.current || idleRef.current) {
      barVisibleRef.current = true;
      idleRef.current = false;
      setBarVisible(true);
      setIdle(false);
    }
    idleTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const keep =
        gestures.isDragging() ||
        overBar.current ||
        (active instanceof Node && Boolean(barRef.current?.contains(active)));
      if (keep) {
        revealBar();
        return;
      }
      barVisibleRef.current = false;
      idleRef.current = true;
      setBarVisible(false);
      setIdle(true);
    }, CONTROL_IDLE_MS);
  };
  activityRef.current = revealBar;

  useEffect(() => {
    revealBar();
    return () => window.clearTimeout(idleTimer.current);
    // The idle clock starts once. Later pointer and key handlers call revealBar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const findAction = nodeFindKey(event, nodeQueryRef.current !== null);
      if (findAction === "close") {
        event.preventDefault();
        event.stopPropagation();
        nodeQueryRef.current = null;
        setNodeQuery(null);
        return;
      }
      if (findAction === "next" || findAction === "prev") {
        event.preventDefault();
        event.stopPropagation();
        const delta = findAction === "next" ? 1 : -1;
        setNodeIndex((current) => stepMatch(current, delta, nodeCountRef.current));
        return;
      }
      if (nodeFindShortcut(event, isCodeEditorTarget(event.target) || isFormField(event.target)) === "open") {
        event.preventDefault();
        nodeQueryRef.current = nodeQueryRef.current ?? "";
        setNodeQuery((current) => current ?? "");
        setNodeIndex(0);
        revealBar();
        return;
      }
      const action = presentationAction(keyEventFrom(event), {
        presenting: true,
        available: true,
        formField: isFormField(event.target),
        codeEditor: isCodeEditorTarget(event.target),
        atFit: cameraRef.current.isAtFit(),
      });
      if (action.type === "ignore") return;
      if (action.type === "exit") {
        event.preventDefault();
        event.stopPropagation();
        leave();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      applyAction(action);
      revealBar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // leave and applyAction close over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyAction(action: PresentationAction) {
    const api = cameraRef.current;
    if (action.type === "pan") api.pan(action.dx, action.dy);
    else if (action.type === "zoom") api.zoomAtPoint(gestures.focalRef.current, action.factor);
    else if (action.type === "rotate") api.rotate(action.degrees);
    else if (action.type === "reset") api.reset();
  }

  function leave() {
    engaged.current = false;
    void exitPresentationFullscreen();
    onExitRef.current();
  }

  function enterFullscreen() {
    void requestPresentationFullscreen({ force: true }).then((ok) => {
      const element = rootRef.current;
      engaged.current = ok && element != null && currentFullscreen() === element;
      setNativeFs(engaged.current);
    });
  }

  async function openTarget(raw: string) {
    const action = actionForClickTarget(raw, frame.path, knownPaths);
    if (action.type === "ignore") return;
    if (action.type === "external") {
      setLinkMessage(null);
      openExternalLink(action.url);
      return;
    }
    if (action.type === "broken") {
      setLinkMessage(action.message);
      revealBar();
      return;
    }
    if (action.path === frame.path) return;
    setLinkMessage(null);
    try {
      const file = await api.readFile(action.path);
      const next = slideFor(file.path, file.content, null);
      setSession((current) => sessionOpen(current, next));
    } catch (err) {
      const message = err instanceof Error ? err.message : `No diagram at ${action.path}.`;
      setLinkMessage(`${message} This diagram stayed open.`);
      revealBar();
    }
  }

  gestureClickRef.current = ({ target }) => {
    handledPress.current = false;
    const raw = frame.source ? clickTargetOnElement(frame.source, target) : null;
    if (!raw) return;
    handledPress.current = true;
    void openTarget(raw);
  };

  function onTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = rootRef.current;
    if (!root) return;
    const items = focusable(root);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    const next =
      index < 0
        ? event.shiftKey
          ? items[items.length - 1]
          : items[0]
        : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length];
    next?.focus();
    revealBar();
  }

  const showRotateHint =
    compact &&
    !rotateHintDismissed &&
    viewport != null &&
    content != null &&
    shouldSuggestRotate(viewport, content);

  function dismissRotateHint() {
    try {
      sessionStorage.setItem(ROTATE_HINT_KEY, "1");
    } catch {
      // Private mode can reject storage. The hint still closes for this view.
    }
    setRotateHintDismissed(true);
  }

  const pct = Math.round(camera.view.scale * 100);
  const revealed =
    content != null &&
    viewport != null &&
    (camera.atFit || camera.view.x !== 0 || camera.view.y !== 0 || camera.view.rotation !== 0 || camera.view.scale !== 1);
  const showStatus = !svg && !notice && !renderOverlay;
  const status = frame.source == null ? "Loading diagram…" : "Rendering diagram…";
  const presentationTrail = {
    crumbs: session.slides.map((slide) => ({ path: slide.path, title: slide.title })),
    index: session.index,
  };

  return createPortal(
    <div
      id={PRESENTATION_ROOT_ID}
      ref={rootRef}
      className={`presentation${idle ? " is-idle" : ""}${nativeFs ? " is-fullscreen" : " is-overlay"}${compact ? " is-compact" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Presentation: ${heading}`}
      tabIndex={-1}
      style={{ background }}
      onKeyDown={onTab}
    >
      <DrillTrail
        className={`presentation-trail${barVisible ? " is-visible" : ""}`}
        trail={presentationTrail}
        onBack={() => {
          setLinkMessage(null);
          setSession((current) => sessionJump(current, current.index - 1));
        }}
        onForward={() => {
          setLinkMessage(null);
          setSession((current) => sessionJump(current, current.index + 1));
        }}
        onSelect={(index) => {
          setLinkMessage(null);
          setSession((current) => sessionJump(current, index));
        }}
      />
      {nodeQuery !== null ? (
        <NodeFindBar
          floating
          query={nodeQuery}
          onQuery={(value) => {
            nodeQueryRef.current = value;
            setNodeQuery(value);
            setNodeIndex(0);
          }}
          index={Math.min(nodeIndex, Math.max(0, nodeMatches.length - 1))}
          count={nodeMatches.length}
          onStep={(delta) => setNodeIndex((current) => stepMatch(current, delta, nodeMatches.length))}
          onClose={() => setNodeQueryNow(null)}
        />
      ) : null}
      <div
        ref={stageRef}
        className={`presentation-stage${gestures.panning ? " is-panning" : ""}`}
        onClick={(event) => {
          const anchor = event.target instanceof Element ? event.target.closest("a") : null;
          if (anchor) event.preventDefault();
          if (handledPress.current) {
            handledPress.current = false;
            return;
          }
          if (gestures.dragged()) return;
          const raw = frame.source ? clickTargetOnElement(frame.source, event.target) : null;
          if (!raw) return;
          event.preventDefault();
          event.stopPropagation();
          void openTarget(raw);
        }}
        onPointerDown={(event) => {
          handledPress.current = false;
          gestures.onPointerDown(event);
        }}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
      >
        {renderOverlay ? (
          <RenderProgress
            text={renderOverlay}
            onCancel={() => {
              renderDrop.current = true;
              setRenderOverlay(null);
              if (onRenderCancelled) onRenderCancelled();
              else onExit();
            }}
          />
        ) : null}
        {svg ? (
          <div
            ref={canvasRef}
            className="presentation-canvas"
            style={
              content
                ? {
                    width: content.width,
                    height: content.height,
                    transform: cssTransform(camera.view, content),
                    visibility: revealed ? "visible" : "hidden",
                  }
                : { visibility: "hidden" }
            }
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
        {titleOn ? <div className="presentation-title">{heading}</div> : null}
        {diffLegend ? (
          <ul className="presentation-legend" aria-label="Diff legend">
            <li>
              <i className="diff-swatch added" /> Added
            </li>
            <li>
              <i className="diff-swatch removed" /> Removed
            </li>
            <li>
              <i className="diff-swatch changed" /> Changed
            </li>
            <li>
              <i className="diff-swatch same" /> Unchanged
            </li>
          </ul>
        ) : null}
        {notice ? (
          <div className={`presentation-banner${svg ? "" : " is-only"}`} role="alert" title={settingsTitle || undefined}>
            {notice}
          </div>
        ) : null}
        {showStatus ? <div className="presentation-status">{status}</div> : null}
      </div>
      {showRotateHint ? (
        <div className="presentation-rotate-hint" role="status">
          <span>This diagram is wide. Turn the phone, or use Fit height and pan sideways.</span>
          <button type="button" className="btn" aria-label="Dismiss rotate hint" onClick={dismissRotateHint}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div
        ref={barRef}
        className={`presentation-bar${barVisible ? " is-visible" : ""}`}
        onPointerEnter={() => {
          overBar.current = true;
          revealBar();
        }}
        onPointerLeave={() => {
          overBar.current = false;
          revealBar();
        }}
        onFocus={() => revealBar()}
      >
        <button type="button" className="btn" aria-label="Zoom out" onClick={() => camera.zoomAtPoint(gestures.focalRef.current, 1 / ZOOM_STEP)}>
          −
        </button>
        <span className="presentation-zoom" aria-label={`Zoom ${pct}%`}>
          {pct}%
        </span>
        <button type="button" className="btn" aria-label="Zoom in" onClick={() => camera.zoomAtPoint(gestures.focalRef.current, ZOOM_STEP)}>
          +
        </button>
        {compact ? null : (
          <>
            <button type="button" className="btn" aria-label="Rotate left" onClick={() => camera.rotate(-90)}>
              ↺
            </button>
            <button type="button" className="btn" aria-label="Rotate right" onClick={() => camera.rotate(90)}>
              ↻
            </button>
          </>
        )}
        <button
          type="button"
          className="btn"
          aria-label={fitModeLabel(camera.fitMode)}
          title={`${fitModeLabel(camera.fitMode)}. Click to change how the diagram fits.`}
          onClick={() => camera.cycleFit()}
        >
          Fit
        </button>
        {compact ? null : (
          <button
            type="button"
            className="btn"
            aria-pressed={titleOn}
            aria-label={titleOn ? "Hide title" : "Show title"}
            onClick={() => setTitleOn((current) => !current)}
          >
            Title
          </button>
        )}
        {compact || nativeFs ? null : (
          <button type="button" className="btn" aria-label="Enter full screen" onClick={() => void enterFullscreen()}>
            Full screen
          </button>
        )}
        {compact ? (
          <>
            <button
              type="button"
              className="btn presentation-more-toggle"
              aria-expanded={moreOpen}
              aria-controls="presentation-more"
              onClick={() => setMoreOpen((current) => !current)}
            >
              More
            </button>
            {moreOpen ? (
              <div id="presentation-more" className="presentation-more-menu" role="group" aria-label="More presentation controls">
                <button type="button" className="btn" aria-label="Rotate left" onClick={() => camera.rotate(-90)}>
                  ↺ Rotate left
                </button>
                <button type="button" className="btn" aria-label="Rotate right" onClick={() => camera.rotate(90)}>
                  ↻ Rotate right
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={titleOn}
                  aria-label={titleOn ? "Hide title" : "Show title"}
                  onClick={() => setTitleOn((current) => !current)}
                >
                  Title
                </button>
                {nativeFs ? null : (
                  <button type="button" className="btn" aria-label="Enter full screen" onClick={() => void enterFullscreen()}>
                    Full screen
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
        <button type="button" className="btn" aria-label="Exit presentation" onClick={leave}>
          Exit
        </button>
      </div>
    </div>,
    document.body,
  );
}

function diagramPathsIn(nodes: readonly { path: string; type: string; children?: unknown }[]): string[] {
  const paths: string[] = [];
  const walk = (list: readonly { path: string; type: string; children?: unknown }[]) => {
    for (const node of list) {
      if (node.type === "file") paths.push(node.path);
      else if (Array.isArray(node.children)) {
        walk(node.children as { path: string; type: string; children?: unknown }[]);
      }
    }
  };
  walk(nodes);
  return paths;
}
