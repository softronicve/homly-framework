/**
 * Tiny in-page test harness shared by tests/dom/*.html. Not part of homly.js — a page
 * built with the framework never needs this file; it only exists for these checks.
 *
 * Usage inside a dom test page:
 *
 *   import { runChecks, tick, real } from './_harness.js';
 *
 *   window.__homly_results = runChecks('mi-archivo', async (check, tick) => {
 *     check('algo pasó', condicion);
 *     await tick();
 *     await real.click('#boton');
 *   });
 */

/** Wait `ms` (default: long enough for a microtask chain + one render). */
export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a suite of checks and resolve to the `{ total, failed, failures }` shape
 * `tests/run-browser.mjs` reads off `window.__homly_results`.
 *
 * @param {string} file - Label shown in the runner's output (matches the .html filename).
 * @param {(check: (name: string, ok: boolean) => void, tick: typeof tick) => Promise<void>} fn
 * @returns {Promise<{ total: number, failed: number, failures: string[] }>}
 */
export function runChecks(file, fn) {
  const failures = [];
  let total = 0;
  const check = (name, ok) => {
    total++;
    if (!ok) failures.push(name);
  };

  return (async () => {
    try {
      await fn(check, tick);
    } catch (err) {
      failures.push('excepción sin capturar: ' + (err && err.stack ? err.stack : err));
    }
    return { total, failed: failures.length, failures };
  })();
}

/**
 * Real, trusted DOM interactions — dispatched by Puppeteer in the Node runner
 * (`tests/run-browser.mjs`, via `page.click`/`page.type`/`page.keyboard`/`page.select`),
 * never synthesized in-page. Use these instead of `el.click()` whenever the thing under
 * test cares about a *trusted* event: link navigation, form submission, anything that
 * listens on the element rather than calling a handler directly.
 *
 * The bridge (`window.__homClick` etc.) is bound by the runner before the page loads;
 * outside it (opening this file by hand) these calls simply fail, which is fine — the
 * automated suite is what `npm run test:browser` runs.
 */
export const real = {
  click: (selector) => window.__homClick(selector),
  type: (selector, text) => window.__homType(selector, text),
  press: (key) => window.__homPress(key),
  select: (selector, value) => window.__homSelect(selector, value),
};
