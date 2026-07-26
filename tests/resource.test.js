/**
 * Checks para store.resource — la carrera de respuestas (una lenta que aterriza después
 * de una rápida y pisa el resultado bueno) es un bug que no se ve mirando el código y
 * que en producción aparece una de cada veinte veces.
 *
 * Corre sin dependencias ni build:  node tests/resource.test.js
 *
 * createStore no toca el DOM, así que esto se testea entero en Node.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
const { Homly } = await import('../homly.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// --- carga inicial ------------------------------------------------------------
{
  const store = Homly.createStore({ q: 'a' });
  const calls = [];
  store.resource('items', ['q'], async (q) => { calls.push(q); return ['x-' + q]; });

  assert.equal(store.state.itemsLoading, true, 'loading arranca en true, sincrónico');
  await tick();

  assert.deepEqual(store.state.items, ['x-a']);
  assert.equal(store.state.itemsLoading, false);
  assert.equal(store.state.itemsError, null);
  assert.deepEqual(calls, ['a'], 'un solo request, no uno por dep');
}

// --- se re-dispara cuando cambia una dep --------------------------------------
{
  const store = Homly.createStore({ q: 'a', orden: 'asc' });
  const calls = [];
  store.resource('items', ['q', 'orden'], async (q, orden) => {
    calls.push(q + '/' + orden);
    return [q + '/' + orden];
  });
  await tick();

  store.state.orden = 'desc';
  await tick();

  assert.deepEqual(store.state.items, ['a/desc']);
  assert.deepEqual(calls, ['a/asc', 'a/desc']);
}

// --- carrera: una respuesta vieja NO pisa a una nueva -------------------------
{
  const store = Homly.createStore({ q: 'lento' });
  let resolverLento;
  store.resource('items', ['q'], (q) => (
    q === 'lento'
      ? new Promise((r) => { resolverLento = () => r(['LENTO']); })
      : Promise.resolve(['RAPIDO'])
  ));

  store.state.q = 'rapido';          // dispara el segundo run y aborta el primero
  await tick();
  assert.deepEqual(store.state.items, ['RAPIDO']);

  resolverLento();                   // el primero contesta tarde
  await tick();
  assert.deepEqual(store.state.items, ['RAPIDO'], 'la respuesta vieja se descarta');
  assert.equal(store.state.itemsLoading, false, 'y no deja loading colgado');
}

// --- el run anterior recibe el abort -----------------------------------------
{
  const store = Homly.createStore({ q: 'a' });
  let signalDelPrimero;
  store.resource('items', ['q'], async (q, { signal }) => {
    if (q === 'a') { signalDelPrimero = signal; return new Promise(() => {}); }  // nunca resuelve
    return ['b'];
  });

  store.state.q = 'b';
  await tick();
  assert.equal(signalDelPrimero.aborted, true, 'el fetch en vuelo se aborta');
  assert.equal(store.state.itemsError, null, 'abortar no es un error');
}

// --- error: publica y conserva el último valor bueno --------------------------
{
  const store = Homly.createStore({ q: 'ok' });
  store.resource('items', ['q'], async (q) => {
    if (q === 'boom') throw new Error('falló la API');
    return ['dato-' + q];
  });
  await tick();
  assert.deepEqual(store.state.items, ['dato-ok']);

  store.state.q = 'boom';
  await tick();
  assert.equal(store.state.itemsError.message, 'falló la API');
  assert.deepEqual(store.state.items, ['dato-ok'], 'no borra la lista que ya está en pantalla');
  assert.equal(store.state.itemsLoading, false);

  store.state.q = 'ok2';             // se recupera
  await tick();
  assert.equal(store.state.itemsError, null, 'un run exitoso limpia el error');
  assert.deepEqual(store.state.items, ['dato-ok2']);
}

// --- debounce: cuatro teclas, un request --------------------------------------
{
  const store = Homly.createStore({ q: '' });
  let calls = 0;
  store.resource('items', ['q'], async () => { calls++; return []; }, { debounce: 30 });

  await tick();
  assert.equal(calls, 1, 'la primera carga nunca se retrasa');

  store.state.q = 'c';
  store.state.q = 'ca';
  store.state.q = 'cas';
  store.state.q = 'casa';
  await tick(60);
  assert.equal(calls, 2, 'cuatro cambios rápidos colapsan en un solo request');
}

// --- sin deps: carga una sola vez ---------------------------------------------
{
  const store = Homly.createStore({ otra: 1 });
  let calls = 0;
  store.resource('config', [], async () => { calls++; return { ok: true }; });
  await tick();

  store.state.otra = 2;              // no es dep suya
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(store.state.config, { ok: true });
}

// --- refresh() re-dispara a mano (botón "reintentar") -------------------------
{
  const store = Homly.createStore({ q: 'a' });
  let calls = 0;
  const items = store.resource('items', ['q'], async () => { calls++; return [calls]; });
  await tick();

  await items.refresh();
  assert.equal(calls, 2);
  assert.deepEqual(store.state.items, [2]);
}

// --- las 3 claves son señales normales: se bindean como cualquier otra --------
{
  const store = Homly.createStore({ q: 'a' });
  store.resource('items', ['q'], async () => ['uno']);
  const vistos = [];
  store.signals.items.subscribe((v) => vistos.push(v));
  await tick();

  assert.deepEqual(vistos, [null, ['uno']], 'subscribe es eager y después notifica');
  assert.ok(store.signals.itemsLoading, 'itemsLoading existe como señal');
  assert.ok(store.signals.itemsError, 'itemsError existe como señal');
}

// --- una computed encima de un resource (el flujo real de "filtrar un listado") --
{
  const store = Homly.createStore({ q: '' });
  store.resource('items', [], async () => ['casa', 'depto', 'casaquinta']);
  store.computed('visibles', ['items', 'q'], (items, q) => (items || []).filter((i) => i.includes(q)));

  await tick();
  assert.deepEqual(store.state.visibles, ['casa', 'depto', 'casaquinta']);

  store.state.q = 'casa';
  assert.deepEqual(store.state.visibles, ['casa', 'casaquinta'],
    'el filtro es sincrónico: no vuelve a pegarle a la API');
}

console.log('✓ resource: 28 checks OK');
