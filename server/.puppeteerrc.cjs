/**
 * Download chrome-headless-shell only. Full Chrome is a second ~380 MB
 * browser, and rendering launches the shell (`headless: "shell"`).
 * Firefox is already skipped by Puppeteer's defaults.
 *
 * The cache directory stays Puppeteer's default (or `PUPPETEER_CACHE_DIR`).
 * The image sets that variable to `/opt/puppeteer` before `npm ci`.
 * The linux/arm64 image sets `PUPPETEER_SKIP_DOWNLOAD` and uses Debian's
 * chromium instead. Chrome for Testing does not publish a linux-arm64 shell.
 */
module.exports = {
  chrome: { skipDownload: true },
  "chrome-headless-shell": { skipDownload: false },
};
