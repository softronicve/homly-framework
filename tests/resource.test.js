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

// --- FIX CORE-22a: una dep que no existe falla alto y claro, sin registrar nada -----
{
  const store = Homly.createStore({ q: 'a' });
  assert.throws(
    () => store.resource('items', ['q', 'noExiste'], async () => []),
    /H202/,
    'el mensaje trae el código para ubicarlo',
  );
  assert.equal(store.signals.items, undefined, 'no queda "items" registrado a medias');
  assert.equal(store.signals.itemsLoading, undefined);
  assert.equal(store.signals.itemsError, undefined);
}

// --- FIX CORE-22a: refresh() cancela un debounce pendiente, no dispara dos veces ---
{
  const store = Homly.createStore({ q: '' });
  let calls = 0;
  const items = store.resource('items', ['q'], async () => { calls++; return [calls]; }, { debounce: 30 });
  await tick();
  assert.equal(calls, 1, 'la carga inicial no espera el debounce');

  store.state.q = 'c';               // encola un run a los 30ms
  await items.refresh();             // dispara ya mismo y debería cancelar el pendiente
  assert.equal(calls, 2, 'refresh() corrió una vez más, ya');

  await tick(50);                    // si el timer viejo sigue vivo, aquí aparecería un 3er call
  assert.equal(calls, 2, 'el debounce pendiente no disparó un tercer request');
}

// --- FIX SSR-1: { initial } sembrado salta el primer fetch automático ---------------
{
  const store = Homly.createStore({ q: 'a' });
  let calls = 0;
  const items = store.resource('items', ['q'], async (q) => { calls++; return ['fetched-' + q]; }, { initial: ['seeded'] });

  assert.deepEqual(store.state.items, ['seeded'], 'arranca con el valor sembrado, sin esperar un tick');
  assert.equal(store.state.itemsLoading, false, 'no queda cargando: no hay fetch en vuelo');
  await tick();
  assert.equal(calls, 0, 'el primer fetch automático no corrió');

  store.state.q = 'b';                // un cambio de dep SÍ dispara el fetch normal
  await tick();
  assert.equal(calls, 1, 'una dep que cambia sigue disparando fetch');
  assert.deepEqual(store.state.items, ['fetched-b']);

  await items.refresh();
  assert.equal(calls, 2, 'refresh() también funciona igual que siempre');
}

// --- FIX SSR-1: { initial: null } cuenta como sembrado (no es "sin initial") --------
{
  const store = Homly.createStore({ q: 'a' });
  let calls = 0;
  store.resource('items', ['q'], async () => { calls++; return ['x']; }, { initial: null });
  assert.equal(store.state.items, null, 'null sembrado se respeta tal cual');
  await tick();
  assert.equal(calls, 0, 'un initial explícitamente null también salta el primer fetch');
}

// --- FIX PERF-5/CORE-9: varias deps cambiadas en el mismo tick ⇒ un solo run --------
{
  const store = Homly.createStore({ q: '', orden: 'precio', pagina: 1 });
  const calls = [];
  store.resource('items', ['q', 'orden', 'pagina'], async (q, orden, pagina) => {
    calls.push(q + '/' + orden + '/' + pagina);
    return [];
  });
  await tick();
  assert.deepEqual(calls, ['/precio/1'], 'carga inicial: un solo run');

  store.state.q = 'casa';
  store.state.orden = 'fecha';
  store.state.pagina = 2;               // "limpiar filtros" de un solo golpe: 3 deps
  // Batcheado: el run recién arranca en el microtask siguiente, no en este mismo tick.
  assert.equal(store.state.itemsLoading, false, 'loading NO cambia todavía en este mismo tick (recién en el microtask)');
  await tick();
  assert.deepEqual(calls, ['/precio/1', 'casa/fecha/2'],
    'UN solo run con el estado FINAL, no tres corridas (dos abortadas)');
}

// --- FIX PERF-5: { sync: true } vuelve al disparo inmediato (sin microtask) ---------
{
  const store = Homly.createStore({ q: 'a' });
  const calls = [];
  store.resource('items', ['q'], async (q) => { calls.push(q); return [q]; }, { sync: true });
  await tick();
  assert.deepEqual(calls, ['a']);

  store.state.q = 'b';
  // Sin esperar ni un tick: con { sync: true } el run ya arrancó en el mismo tick.
  assert.equal(store.state.itemsLoading, true, 'con sync:true, loading ya está en true sin esperar un microtask');
  await tick();
  assert.deepEqual(calls, ['a', 'b']);
}

console.log('✓ resource: 51 checks OK');
