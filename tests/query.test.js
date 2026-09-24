/**
 * Checks para Homly.bindQuery — el ida y vuelta URL ↔ store tiene tres trampas que no
 * se ven leyendo el código: los valores vuelven de la URL como string (un `pagina`
 * numérico se convierte en `'2'`), una clave ausente tiene que volver a su default y no
 * quedarse pegada, y `subscribe` es eager (escribiría la URL al registrarse).
 *
 * FIX PERF-5: `store → URL` (`write()`) se coalesce en un microtask, así que un cambio
 * de señal ya no actualiza `location.search` en el mismo tick — de ahí los `await
 * tick()` después de cada `store.state.x = …` de este archivo (antes de esta versión,
 * la escritura era sincrónica).
 *
 * Corre sin dependencias ni build:  node tests/query.test.js
 *
 * bindQuery toca location/history pero no el DOM, así que alcanza con stubearlos.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};

/** Deja correr los microtasks encolados (el `write()` batcheado de bindQuery). */
const tick = () => new Promise((r) => setTimeout(r, 0));

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
  await tick();
  assert.equal(location.search, '?q=depto');

  store.state.orden = 'precio';
  await tick();
  assert.equal(location.search, '?q=depto&orden=precio');
}

// --- un valor vacío o en su default sale de la URL ----------------------------
{
  reset();
  const store = Homly.createStore({ q: '', orden: 'fecha', conFoto: false });
  Homly.bindQuery(store, ['q', 'orden', 'conFoto']);

  // FIX PERF-5: dos señales cambiadas en el mismo tick ⇒ un solo write() con el
  // estado final, no dos `replaceState` seguidos.
  store.state.q = 'casa';
  store.state.conFoto = true;
  await tick();
  assert.equal(location.search, '?q=casa&conFoto=true');

  store.state.q = '';
  await tick();
  assert.equal(location.search, '?conFoto=true', 'vacío ⇒ se borra el param');

  store.state.orden = 'precio';
  store.state.orden = 'fecha';
  await tick();
  assert.equal(location.search, '?conFoto=true', 'volver al default ⇒ se borra');

  store.state.conFoto = false;
  await tick();
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
  assert.equal(store.state.conFoto, false, "'false' no es truthy aquí");
}

// --- FIX CORE-8a: un número inválido en la URL vuelve al default, no a NaN ---------
{
  reset('?pagina=abc');
  const store = Homly.createStore({ pagina: 1 });
  const pedidos = [];
  Homly.bindQuery(store, ['pagina']);
  store.resource('items', ['pagina'], async (p) => { pedidos.push(p); return [p]; });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(store.state.pagina, 1, "'abc' no es un número: se queda con el default");
  assert.equal(location.search, '', 'un valor inválido no ensucia la URL con "pagina=NaN"');
  assert.deepEqual(pedidos, [1], 'un solo request, no uno por cada NaN !== NaN');
}

// --- FIX CORE-8a: '0' también cuenta como false, igual que 'false' ----------------
{
  reset('?conFoto=0');
  const store = Homly.createStore({ conFoto: true });
  Homly.bindQuery(store, ['conFoto']);
  assert.equal(store.state.conFoto, false, "'0' en la URL es tan false como 'false'");
}

// --- FIX CORE-8a: '' también vuelve al default, no a Number('') === 0 -------------
{
  reset('?precioMax=');
  const store = Homly.createStore({ precioMax: 500 });
  Homly.bindQuery(store, ['precioMax']);
  assert.equal(store.state.precioMax, 500,
    "un ?precioMax= vacío no es 0 — Number('') === 0 lo volvería un precio real");
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
  await tick();   // drena el write() que ese cambio encoló, antes del reset() del siguiente bloque
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

// --- FIX CORE-8b/QUERY-1: una clave cuyo default es un array usa getAll/append ------
{
  reset('?tipo=casa&tipo=apto');
  const store = Homly.createStore({ tipo: [] });
  Homly.bindQuery(store, ['tipo']);
  assert.deepEqual(store.state.tipo, ['casa', 'apto'], '?tipo repetido llega como array');

  store.state.tipo = ['casa'];
  await tick();
  assert.equal(location.search, '?tipo=casa', 'un solo valor: un solo par');

  store.state.tipo = ['casa', 'apto', 'quinta'];
  await tick();
  assert.equal(location.search, '?tipo=casa&tipo=apto&tipo=quinta', 'varios valores: un par por cada uno');

  store.state.tipo = [];
  await tick();
  assert.equal(location.search, '', '[] deja la URL limpia, igual que cualquier otro default');
}

console.log('✓ query: 33 checks OK');
