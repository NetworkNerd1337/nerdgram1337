/**
 * The blocking head script that sets the theme before first paint.
 * Vite injects it. It must stay free of DOM types so the Node tsconfig
 * can import it from vite.config.ts.
 */

export const APPEARANCE_KEY = "nerdgram.appearance";

/**
 * Blocking head script. It only sets data-theme from localStorage and the
 * system preference. Keep the branches aligned with `resolveTheme`.
 */
export function appearanceBootScript(): string {
  const key = JSON.stringify(APPEARANCE_KEY);
  return `(function(){try{var stored=localStorage.getItem(${key});var preference=stored==="light"||stored==="dark"||stored==="system"?stored:"system";var systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;var dark=preference==="dark"||(preference!=="light"&&systemDark);var theme=dark?"dark":"light";var root=document.documentElement;root.dataset.theme=theme;root.dataset.appearance=preference;root.style.colorScheme=theme;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.appearance="system";document.documentElement.style.colorScheme="light";}})();`;
}

/** Insert the boot script at the start of head, once. */
export function injectAppearanceBoot(html: string): string {
  if (html.includes(APPEARANCE_KEY)) return html;
  const tag = `<script>${appearanceBootScript()}</script>`;
  if (html.includes("<head>")) return html.replace("<head>", `<head>\n    ${tag}`);
  return html.replace("<head", `<head>\n    ${tag}`);
}
