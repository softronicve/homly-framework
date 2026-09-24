/**
 * Checks for HomlyRouter.matchRoute — el matcheo de rutas es un parser, y un parser
 * roto falla en silencio (una ruta que deja de matchear parece "página vacía").
 *
 * Corre sin dependencias ni build:  node tests/route-match.test.js
 *
 * ponytail: homly.js declara `class HomlyComponent extends HTMLElement`, que no existe
 * en Node. Un stub de una línea alcanza para importar el módulo; matchRoute es puro y
 * no toca el DOM, que es justo por lo que se puede testear aquí.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
const { HomlyRouter } = await import('../homly.js');

const { matchRoute } = HomlyRouter;

// --- matchea y extrae ---------------------------------------------------------
assert.deepEqual(matchRoute('/blog/:slug', '/blog/hola-mundo'), { slug: 'hola-mundo' });
assert.deepEqual(matchRoute('/propiedades/:id', '/propiedades/42'), { id: '42' });
assert.deepEqual(
  matchRoute('/u/:user/posts/:post', '/u/ana/posts/7'),
  { user: 'ana', post: '7' },
);

// --- rutas estáticas ----------------------------------------------------------
assert.deepEqual(matchRoute('/blog', '/blog'), {}, 'una ruta sin params matchea con {}');
assert.equal(matchRoute('/blog', '/otra'), null);

// --- no matchea: el conteo de segmentos tiene que coincidir --------------------
assert.equal(matchRoute('/blog/:slug', '/blog'), null, 'falta el segmento');
assert.equal(matchRoute('/blog/:slug', '/blog/a/b'), null, 'sobra un segmento');
assert.equal(matchRoute('/blog/:slug', '/'), null);

// --- no matchea: param vacío --------------------------------------------------
assert.equal(matchRoute('/blog/:slug', '/blog/'), null, '/blog/ no es un slug válido');

// --- no matchea: prefijo distinto ---------------------------------------------
assert.equal(matchRoute('/blog/:slug', '/noticias/hola'), null);

// --- decodifica el valor ------------------------------------------------------
assert.deepEqual(matchRoute('/buscar/:q', '/buscar/caf%C3%A9'), { q: 'café' });
assert.deepEqual(matchRoute('/buscar/:q', '/buscar/dos%20palabras'), { q: 'dos palabras' });

// --- un valor de la URL no se interpreta como patrón --------------------------
assert.deepEqual(matchRoute('/blog/:slug', '/blog/:otro'), { slug: ':otro' });

// --- FIX ROUTER-4/ROUTE-1: un '%' suelto no rompe el matcheo, cae a "no matchea" -----
// decodeURIComponent('%zz') lanza URIError; sin el try/catch, esto tiraba abajo toda la
// navegación en vez de simplemente no matchear (y caer al 404, como cualquier otra ruta).
assert.equal(matchRoute('/blog/:slug', '/blog/%zz'), null, "un '%' suelto no lanza: no matchea");
assert.doesNotThrow(() => matchRoute('/blog/:slug', '/blog/100%'));

// --- FIX ROUTER-4: un '/' codificado en el param no cuela un segmento extra ---------
assert.equal(matchRoute('/blog/:slug', '/blog/a%2Fb'), null,
  "'%2F' decodifica a '/': un solo :slug no puede esconder dos segmentos");

// --- prioridad de resolución --------------------------------------------------
// ponytail: _resolve solo lee this.routes, así que se prueba sin DOM salteando el
// constructor (que sí toca document/window).
const router = Object.create(HomlyRouter.prototype);
router.routes = {
  '/blog': { tag: 'blog-index', loader: null },
  '/blog/nuevo': { tag: 'blog-new', loader: null },
  '/blog/:slug': { tag: 'blog-post', loader: null },
  '/404': { tag: 'not-found', loader: null },
};

assert.equal(router._resolve('/blog/nuevo').route.tag, 'blog-new',
  'la ruta estática le gana a la dinámica');
assert.deepEqual(router._resolve('/blog/nuevo').params, {});

assert.equal(router._resolve('/blog/hola').route.tag, 'blog-post');
assert.deepEqual(router._resolve('/blog/hola').params, { slug: 'hola' });

assert.equal(router._resolve('/blog').route.tag, 'blog-index');
assert.equal(router._resolve('/nada/de/nada').route.tag, 'not-found', 'cae al /404');

// sin /404 registrado, el fallback sigue siendo un <div> vacío
const bare = Object.create(HomlyRouter.prototype);
bare.routes = { '/blog/:slug': { tag: 'blog-post', loader: null } };
assert.equal(bare._resolve('/otra').route.tag, 'div');

// --- FIX ROUTER-4/ROUTER-12: la barra final y '/index.html' matchean igual ----------
assert.equal(router._resolve('/blog/').route.tag, 'blog-index', "'/blog/' matchea como '/blog'");
assert.equal(router._resolve('/blog/index.html').route.tag, 'blog-index');
assert.equal(router._resolve('/blog/nuevo/').route.tag, 'blog-new', 'también en una ruta dinámica-vs-estática');
assert.equal(HomlyRouter._normalize('/'), '/', 'la raíz se deja como está');
assert.equal(HomlyRouter._normalize('///'), '/', 'nunca queda vacía');

// --- FIX ROUTER-23: una ruta llamada 'constructor' no matchea por el prototipo -------
assert.equal(router._resolve('constructor').route.tag, 'not-found',
  "'constructor' no es una clave propia de this.routes: Object.hasOwn no la confunde con la del prototipo");
assert.equal(router._resolve('toString').route.tag, 'not-found');

// --- FIX ROUTER-9/ROUTER-19: el constructor valida que el root exista ---------------
{
  globalThis.document = { getElementById: () => null };
  assert.throws(() => new HomlyRouter('no-existe-este-id'), /no existe.*no-existe-este-id/,
    'sin el elemento raíz, el constructor lanza en vez de fallar más tarde en otro método');
}

// --- prefetch: una vez por ruta, y solo si tiene loader ------------------------
{
  let cargasBlog = 0;
  let cargasIndex = 0;
  const r = Object.create(HomlyRouter.prototype);
  r.prefetched = new Set();
  r.routes = {
    '/blog': { tag: 'blog-index', loader: () => { cargasIndex++; return Promise.resolve(); } },
    '/blog/:slug': { tag: 'blog-post', loader: () => { cargasBlog++; return Promise.resolve(); } },
    '/quienes-somos': { tag: 'about-us', loader: null },
  };

  r.prefetch('/blog/hola');
  assert.equal(cargasBlog, 1);

  r.prefetch('/blog/hola');
  r.prefetch('/blog/otro-post');
  assert.equal(cargasBlog, 1, 'la misma ruta no se vuelve a bajar, ni con otro param');

  r.prefetch('/blog');
  assert.equal(cargasIndex, 1, 'cada ruta lleva su propia cuenta');

  r.prefetch('/quienes-somos');          // sin loader: no hay nada que bajar
  r.prefetch('/no-existe');              // sin match ni /404: cae al <div> sin loader
  assert.equal(r.prefetched.size, 2, 'solo se marcan las rutas que sí tenían loader');
}

// --- qué clicks toma el router y cuáles deja pasar ----------------------------
{
  globalThis.location ??= {};
  location.origin = 'https://homly.dev';

  const link = (props = {}) => ({
    origin: props.origin ?? 'https://homly.dev',
    attrs: props.attrs ?? {},
    hasAttribute(name) { return name in this.attrs; },
  });
  const click = (props = {}) => ({ button: 0, ...props });

  assert.equal(HomlyRouter._handles(click(), link()), true, 'link interno, click normal');

  // otro dominio: pushState tiraría SecurityError
  assert.equal(HomlyRouter._handles(click(), link({ origin: 'https://homly.blog' })), false,
    'un sitio hermano se navega de verdad, no por el router');

  // el autor ya dijo dónde abrirlo
  assert.equal(HomlyRouter._handles(click(), link({ attrs: { target: '_blank' } })), false);
  assert.equal(HomlyRouter._handles(click(), link({ attrs: { download: '' } })), false);

  // "abrir en pestaña nueva" tiene que seguir funcionando
  assert.equal(HomlyRouter._handles(click({ metaKey: true }), link()), false, '⌘+click');
  assert.equal(HomlyRouter._handles(click({ ctrlKey: true }), link()), false, 'ctrl+click');
  assert.equal(HomlyRouter._handles(click({ shiftKey: true }), link()), false, 'shift+click');
  assert.equal(HomlyRouter._handles(click({ altKey: true }), link()), false, 'alt+click (descarga)');
  assert.equal(HomlyRouter._handles(click({ button: 1 }), link()), false, 'click del medio');
}

// --- un loader que falla no rompe ni queda marcado como imposible -------------
{
  const r = Object.create(HomlyRouter.prototype);
  r.prefetched = new Set();
  r.routes = { '/x': { tag: 'x-page', loader: () => Promise.reject(new Error('offline')) } };

  assert.doesNotThrow(() => r.prefetch('/x'), 'un prefetch fallido se traga el error');
  await new Promise((res) => setTimeout(res, 0));   // que la rejection se resuelva sin unhandled
}

console.log('✓ route-match: 45 checks OK');
