/**
 * Checks para Homly.bindQuery — el ida y vuelta URL ↔ store tiene tres trampas que no
 * se ven leyendo el código: los valores vuelven de la URL como string (un `pagina`
 * numérico se convierte en `'2'`), una clave ausente tiene que volver a su default y no
 * quedarse pegada, y `subscribe` es eager (escribiría la URL al registrarse).
 *
 * Corre sin dependencias ni build:  node tests/query.test.js
 *
 * bindQuery toca location/history pero no el DOM, así que alcanza con stubearlos.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};

// --- stubs de location / history / listeners ----------------------------------
const listeners = new Set();
globalThis.location = { pathname: '/propiedades', search: '', hash: '' };
globalThis.history = {
  state: null,
  replaceState(_state, _title, url) {
    const [path, search = ''] = url.split('?');
    location.pathname = path;
    location.search = search ? '?' + search : '';
  },
};
globalThis.addEventListener = (type, fn) => { if (type === 'popstate') listeners.add(fn); };
globalThis.removeEventListener = (type, fn) => { if (type === 'popstate') listeners.delete(fn); };

/** Simula el botón atrás: cambia la URL y avisa. */
const goBackTo = (search) => {
  location.search = search;
  listeners.forEach((fn) => fn());
};
const reset = (search = '') => {
  listeners.clear();
  location.pathname = '/propiedades';
  location.search = search;
  location.hash = '';
};

const { Homly } = await import('../homly.js');

// --- URL → store al arrancar --------------------------------------------------
{
  reset('?q=casa&orden=precio');
  const store = Homly.createStore({ q: '', orden: 'fecha' });
  Homly.bindQuery(store, ['q', 'orden']);

  assert.equal(store.state.q, 'casa');
  assert.equal(store.state.orden, 'precio', 'pisa el default con lo que dice la URL');
}

// --- una clave ausente conserva su default ------------------------------------
{
  reset('?q=casa');
  const store = Homly.createStore({ q: '', orden: 'fecha' });
  Homly.bindQuery(store, ['q', 'orden']);

  assert.equal(store.state.orden, 'fecha', 'sin ?orden= se queda con el default');
}

// --- store → URL --------------------------------------------------------------
{
  reset();
  const store = Homly.createStore({ q: '', orden: 'fecha' });
  Homly.bindQuery(store, ['q', 'orden']);
  assert.equal(location.search, '', 'registrarse no ensucia la URL');

  store.state.q = 'depto';
  assert.equal(location.search, '?q=depto');

  store.state.orden = 'precio';
  assert.equal(location.search, '?q=depto&orden=precio');
}

// --- un valor vacío o en su default sale de la URL ----------------------------
{
  reset();
  const store = Homly.createStore({ q: '', orden: 'fecha', conFoto: false });
  Homly.bindQuery(store, ['q', 'orden', 'conFoto']);

  store.state.q = 'casa';
  store.state.conFoto = true;
  assert.equal(location.search, '?q=casa&conFoto=true');

  store.state.q = '';
  assert.equal(location.search, '?conFoto=true', 'vacío ⇒ se borra el param');

  store.state.orden = 'precio';
  store.state.orden = 'fecha';
  assert.equal(location.search, '?conFoto=true', 'volver al default ⇒ se borra');

  store.state.conFoto = false;
  assert.equal(location.search, '', 'la URL limpia queda limpia');
}

// --- tipos: la URL siempre da strings, el store recupera su tipo --------------
{
  reset('?pagina=3&conFoto=true');
  const store = Homly.createStore({ pagina: 1, conFoto: false });
  Homly.bindQuery(store, ['pagina', 'conFoto']);

  assert.equal(store.state.pagina, 3);
  assert.equal(typeof store.state.pagina, 'number', "'3' vuelve como número, no string");
  assert.equal(store.state.pagina + 1, 4, 'y suma como número');

  assert.equal(store.state.conFoto, true);
  assert.equal(typeof store.state.conFoto, 'boolean');
}

{
  reset('?conFoto=false');
  const store = Homly.createStore({ conFoto: true });
  Homly.bindQuery(store, ['conFoto']);
  assert.equal(store.state.conFoto, false, "'false' no es truthy acá");
}

// --- el botón atrás restaura los filtros --------------------------------------
{
  reset('?q=casa');
  const store = Homly.createStore({ q: '', orden: 'fecha' });
  Homly.bindQuery(store, ['q', 'orden']);
  assert.equal(store.state.q, 'casa');

  goBackTo('?q=depto&orden=precio');
  assert.equal(store.state.q, 'depto');
  assert.equal(store.state.orden, 'precio');

  goBackTo('');
  assert.equal(store.state.q, '', 'un filtro que ya no está en la URL vuelve al default');
  assert.equal(store.state.orden, 'fecha');
}

// --- el abort suelta el listener de popstate ----------------------------------
{
  reset();
  const controller = new AbortController();
  const store = Homly.createStore({ q: '' });
  Homly.bindQuery(store, ['q'], controller.signal);
  assert.equal(listeners.size, 1);

  controller.abort();
  assert.equal(listeners.size, 0, 'no queda escuchando después de desmontar');
}

// --- el orden real de uso: bindQuery ANTES de resource ------------------------
{
  reset('?q=casa');
  const store = Homly.createStore({ q: '' });
  Homly.bindQuery(store, ['q']);

  const pedidos = [];
  store.resource('items', ['q'], async (q) => { pedidos.push(q); return [q]; });
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(pedidos, ['casa'],
    'el primer fetch ya usa el filtro de la URL: no pide dos veces');
}

console.log('✓ query: 24 checks OK');
