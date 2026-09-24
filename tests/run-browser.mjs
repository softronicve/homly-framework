#!/usr/bin/env node
/**
 * Browser test runner for homly.js — opens every tests/dom/*.html in a real, headless
 * Chrome (via puppeteer-core, a devDependency: it drives whatever Chrome the machine
 * already has, it doesn't download one) and waits for that page's own inline test
 * harness to resolve `window.__homly_results`.
 *
 * What this buys over `npm test` (plain Node): everything that only exists in a real
 * DOM — Custom Element lifecycle reactions, `<template>`/`data-for` cloning, CSS
 * `@scope`, `history`/`popstate`, and *trusted* clicks/keystrokes (a synthetic
 * `el.click()` isn't always equivalent — see CORE-2 in the fase-1 audit). For the cases
 * that need a trusted event, a dom test page calls the small `real` helper from
 * `./_harness.js`, which is backed here by Puppeteer's own `page.click`/`page.type`/
 * `page.keyboard`, exposed into the page via `page.exposeFunction`.
 *
 * homly.js stays dependency-free: this file, `_harness.js` and puppeteer-core are all
 * dev-only — `"files"` in package.json still publishes just the runtime.
 *
 * Usage:  node tests/run-browser.mjs   (exits 1 if anything failed or errored)
 * Chrome: autodetected (google-chrome / google-chrome-stable / chromium / chromium-browser
 * on PATH, plus the usual Linux/macOS install paths), or set CHROME_PATH to override.
 */
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOM_DIR = path.join(ROOT, 'tests', 'dom');
const PER_PAGE_TIMEOUT_MS = 20_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Find a Chrome/Chromium binary: CHROME_PATH first, then well-known names/paths. */
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch { /* not on PATH, keep looking */ }
  }

  for (const guess of [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(guess)) return guess;
  }

  return null;
}

/** A tiny static file server rooted at the repo root, so `/homly.js` and `/tests/dom/*`
 *  resolve exactly like they would if you served the repo yourself. Listens on port 0
 *  (an OS-assigned free port) so it never collides with anything else running locally. */
function serveStatic(root) {
  return http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const resolved = path.normalize(path.join(root, urlPath));
      if (!resolved.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }

      let filePath = resolved;
      let stat;
      try {
        stat = await fs.stat(filePath);
        if (stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); stat = await fs.stat(filePath); }
      } catch { res.writeHead(404); res.end('not found: ' + urlPath); return; }

      const body = await fs.readFile(filePath);
      const headers = { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' };
      // CSP-1: csp.html is served under a strict style-src, so it can assert the shared
      // adoptedStyleSheets mechanism (Homly._installSheet) needs no 'unsafe-inline'.
      if (path.basename(filePath) === 'csp.html') headers['content-security-policy'] = "style-src 'self'";
      res.writeHead(200, headers);
      res.end(body);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err && err.stack || err));
    }
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/** Wire the real-event bridge a dom test's `_harness.js` `real` helper calls into. */
async function exposeRealEvents(page) {
  await page.exposeFunction('__homClick', async (selector) => { await page.click(selector); });
  await page.exposeFunction('__homType', async (selector, text) => { await page.type(selector, text); });
  await page.exposeFunction('__homPress', async (key) => { await page.keyboard.press(key); });
  await page.exposeFunction('__homSelect', async (selector, value) => { await page.select(selector, value); });
}

/** Run one tests/dom/*.html file and return its `window.__homly_results`. */
async function runOne(browser, baseUrl, file) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  try {
    await exposeRealEvents(page);
    await page.goto(baseUrl + '/tests/dom/' + file, { waitUntil: 'load', timeout: PER_PAGE_TIMEOUT_MS });

    const result = await Promise.race([
      page.waitForFunction('window.__homly_results !== undefined')
        .then(() => page.evaluate(() => window.__homly_results)),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('timeout: ' + file + ' nunca resolvió window.__homly_results')),
        PER_PAGE_TIMEOUT_MS,
      )),
    ]);

    return { file, ...result, pageErrors, consoleErrors };
  } catch (err) {
    return {
      file, total: 0, failed: 1, failures: ['excepción en el runner: ' + (err && err.message || err)],
      pageErrors, consoleErrors,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('[test:browser] no se encontró Chrome/Chromium. Instala uno o exporta CHROME_PATH=/ruta/al/binario.');
    process.exit(1);
  }

  let files;
  try {
    files = (await fs.readdir(DOM_DIR)).filter((f) => f.endsWith('.html')).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) {
    console.error('[test:browser] no hay archivos en tests/dom/*.html — nada que correr.');
    process.exit(1);
  }

  const server = serveStatic(ROOT);
  const port = await listen(server);
  const baseUrl = 'http://127.0.0.1:' + port;

  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });

  console.log('[test:browser] Chrome: ' + chromePath);
  console.log('[test:browser] server: ' + baseUrl + ' (repo root: ' + ROOT + ')');
  console.log('[test:browser] archivos: ' + files.join(', '));
  console.log('');

  let totalChecks = 0;
  let totalFailed = 0;
  const brokenFiles = [];

  try {
    for (const file of files) {
      const r = await runOne(browser, baseUrl, file);
      totalChecks += r.total || 0;
      totalFailed += r.failed || 0;

      const ok = (r.failed || 0) === 0 && r.pageErrors.length === 0;
      console.log((ok ? '✓' : '✗') + ' ' + file + ': ' + (r.total || 0) + ' checks, ' + (r.failed || 0) + ' fallos');
      for (const f of r.failures || []) console.log('    ✗ ' + f);
      for (const e of r.pageErrors) console.log('    ✗ error sin capturar en la página: ' + e);
      if (r.consoleErrors?.length && process.env.HOM_DEBUG) {
        for (const e of r.consoleErrors) console.log('    · console.error: ' + e);
      }

      if (!ok) brokenFiles.push(file);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  console.log('[test:browser] total: ' + totalChecks + ' checks, ' + totalFailed + ' fallos en ' + brokenFiles.length + ' archivo(s)');

  if (brokenFiles.length > 0) {
    console.log('[test:browser] archivos con fallos: ' + brokenFiles.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test:browser] error fatal:', err);
  process.exit(1);
});
