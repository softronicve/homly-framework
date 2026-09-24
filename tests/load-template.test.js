/**
 * Checks for Homly.loadTemplate — específicamente el FIX ROUTER-19/ROUTER-22: si la URL
 * de una plantilla en realidad devuelve un documento HTML completo (el fallback de SPA
 * del server, un redirect a /login, un 404 servido como 200…), eso se ve fatal metido
 * dentro de otro <html> y, peor, el error se repite en silencio en cada click. loadTemplate
 * tiene que rechazarlo con un mensaje que diga por qué, no dejarlo pasar como si fuera un
 * fragmento válido.
 *
 * Corre sin dependencias ni build:  node tests/load-template.test.js
 *
 * loadTemplate solo usa `fetch`, así que un stub de una función alcanza — no hace falta
 * un navegador ni un server real.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};

const responses = new Map();
globalThis.fetch = async (url) => {
  const body = responses.get(url);
  if (body === undefined) throw new Error('fetch stub: no hay respuesta para ' + url);
  return { ok: true, text: async () => body };
};

const { Homly } = await import('../homly.js');

// --- un documento HTML completo se rechaza, con doctype o sin él --------------------
responses.set('/spa-fallback.html', '<!doctype html>\n<html><body>índice de la SPA</body></html>');
await assert.rejects(
  () => Homly.loadTemplate('/spa-fallback.html'),
  /documento HTML completo/,
  'un <!doctype html> completo se rechaza, no se cachea como si fuera la plantilla',
);

responses.set('/sin-doctype.html', '<html>\n<head></head><body>ok</body></html>');
await assert.rejects(() => Homly.loadTemplate('/sin-doctype.html'), /documento HTML completo/,
  'también sin doctype: alcanza con que arranque en <html>');

// --- un fragmento normal (lo que realmente carga un componente) sigue funcionando ----
responses.set('/fragmento.html', '<p>hola</p><span data-bind="x"></span>');
const frag = await Homly.loadTemplate('/fragmento.html');
assert.equal(frag, '<p>hola</p><span data-bind="x"></span>', 'un fragmento normal no se toca');

// --- un fragmento que arranca con <header>/<html-algo> no cae en el falso positivo ---
responses.set('/con-header.html', '<header>menu</header><main>contenido</main>');
const conHeader = await Homly.loadTemplate('/con-header.html');
assert.equal(conHeader, '<header>menu</header><main>contenido</main>',
  'un tag que empieza con "html" (<header>) no dispara el rechazo — el check exige <html seguido de espacio/>');

// --- el rechazo no deja la URL cacheada ni el pendingRequest colgado -----------------
{
  await assert.rejects(() => Homly.loadTemplate('/spa-fallback.html'));
  // Si quedó cacheada, esta segunda llamada devolvería el string en vez de rechazar de nuevo.
  await assert.rejects(() => Homly.loadTemplate('/spa-fallback.html'), /documento HTML completo/,
    'no se cachea: reintentar sigue rechazando (no queda pegado un valor viejo)');
}

console.log('✓ load-template: 6 checks OK');
