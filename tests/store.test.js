/**
 * Checks para Homly.createStore que no tocan el DOM: la semántica del Proxy
 * (`state`) como objeto normal (CORE-20/PROTO-1) y el aislamiento de errores entre
 * subscribers de una misma señal (CORE-18).
 *
 * Corre sin dependencias ni build:  node tests/store.test.js
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.HOM_DEBUG = undefined;
const { Homly } = await import('../homly.js');

// --- FIX CORE-20/PROTO-1: state se comporta como un objeto plano de verdad ----------
{
  const store = Homly.createStore({ a: 1, b: 'x' });

  assert.equal(JSON.stringify(store.state), '{"a":1,"b":"x"}',
    'JSON.stringify recorre las claves reales, no el target vacío del Proxy');
  assert.deepEqual({ ...store.state }, { a: 1, b: 'x' }, 'el spread también las recorre');
  assert.equal('a' in store.state, true, "'in' encuentra una clave declarada");
  assert.equal('nope' in store.state, false, "'in' no inventa claves");
}

// --- FIX CORE-20/PROTO-1: una clave del prototipo de Object no filtra ---------------
{
  const store = Homly.createStore({ a: 1 });
  // Antes de Object.create(null), signals.constructor resolvía a Function (Object) por
  // la cadena de prototipos: cualquier `if (store.signals[key])` la trataba como si
  // fuera una señal real y reventaba llamando a `.subscribe` sobre ella.
  assert.equal(store.signals.constructor, undefined, 'constructor no cuelga del prototipo');
  assert.equal(store.signals.toString, undefined);
  assert.equal(store.state.constructor, undefined, 'leer state.constructor no rompe ni filtra Object');
  // Escribir una clave no declarada no debe lanzar (se ignora, con warning bajo debug).
  assert.doesNotThrow(() => { store.state.constructor = 'x'; });
}

// --- [homly H201] al escribir una clave no declarada, solo bajo HOM_DEBUG ----------
{
  globalThis.HOM_DEBUG = true;
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const store = Homly.createStore({ a: 1 });
    store.state.noExiste = 5;
  } finally {
    console.warn = original;
    globalThis.HOM_DEBUG = undefined;
  }
  assert.ok(warns.some((w) => w.includes('H201')), 'avisa con el código H201');
}
{
  // Sin HOM_DEBUG, ni un warning.
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const store = Homly.createStore({ a: 1 });
    store.state.noExiste = 5;
  } finally {
    console.warn = original;
  }
  assert.equal(warns.length, 0, 'sin HOM_DEBUG no imprime nada');
}

// --- FIX CORE-18: notificación aislada por subscriber -------------------------------
{
  const store = Homly.createStore({ a: 1 });
  const vistosPor2 = [];
  let llamadas = 0;
  // No lanza en la llamada inicial (eager, con el valor 1) — solo en la del cambio real.
  store.signals.a.subscribe(() => { llamadas++; if (llamadas === 2) throw new Error('boom en el subscriber 1'); });
  store.signals.a.subscribe((v) => vistosPor2.push(v));

  assert.throws(() => { store.state.a = 2; }, /boom en el subscriber 1/,
    'el primer error se relanza (no se traga en silencio)');
  assert.deepEqual(vistosPor2, [1, 2],
    'el segundo subscriber igual recibió el valor inicial y el nuevo');
}

// --- FIX CORE-18: un error de un subscriber de resource no llega a xError -----------
{
  const store = Homly.createStore({ q: 'a' });
  store.resource('items', ['q'], async () => ['ok']);
  // Simula una vista que revienta al renderizar un valor real (no el null inicial).
  store.signals.items.subscribe((v) => { if (v !== null) throw new Error('fallo al renderizar'); });

  await new Promise((r) => setTimeout(r, 10));

  assert.equal(store.state.itemsError, null,
    'un error de renderizado no se confunde con un fetch fallido');
  assert.deepEqual(store.state.items, ['ok'], 'el dato sí llegó a escribirse');
  assert.equal(store.state.itemsLoading, false, 'loading igual se apaga');
}

console.log('✓ store: 15 checks OK');
