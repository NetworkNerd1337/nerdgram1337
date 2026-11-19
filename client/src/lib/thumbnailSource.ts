import { parseDiagram } from "./frontMatter";

/**
 * Diagram text to draw on a card. A broken YAML header is left out so the
 * body can still be drawn. A header Mermaid can read stays, so its theme
 * still applies. An empty body keeps the original text.
 */
export function sourceForThumbnail(content: string): string {
  const parsed = parseDiagram(content);
  if (!parsed.malformed) return content;
  const body = parsed.body.trim();
  return body ? parsed.body : content;
}
