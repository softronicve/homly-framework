/**
 * Checks for the DEBUG-1 fix: el modo verbose loguea el valor de cada señal que cambia
 * — contraseñas incluidas — así que (1) nunca se puede prender con un parámetro de URL
 * (un enlace compartido no debería poder activar el logueo de datos sensibles de otra
 * persona) y (2) una clave que huela a `password`/`token`/`secret` se redacta igual,
 * aunque el modo verbose esté prendido por una vía legítima (HOM_DEBUG global).
 *
 * Corre sin dependencias ni build:  node tests/debug-mode.test.js
 *
 * homly.js decide el nivel de HOM_DEBUG una sola vez, al importarse (lee la URL y
 * localStorage en un IIFE de tope de archivo). Para probar varias combinaciones hay que
 * reimportar el módulo "fresco" cada vez — un query string distinto en el specifier hace
 * que Node lo trate como un módulo nuevo y vuelva a correr ese IIFE.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.localStorage = undefined;

/** Reimporta homly.js con `location.search` dado, como si fuera la primera carga. */
const freshImport = async (search) => {
  delete globalThis.HOM_DEBUG;
  globalThis.location = { search };
  return import('../homly.js?fresh=' + Math.random().toString(36).slice(2));
};

// --- FIX DEBUG-1: verbose nunca se activa por la URL, ni pidiéndolo explícitamente --
{
  await freshImport('?homly-debug=verbose');
  assert.notEqual(globalThis.HOM_DEBUG, 'verbose',
    'un link con ?homly-debug=verbose no puede prender el logueo de valores');
}

// --- el nivel 'basic' (sin valores) sigue pudiéndose pedir por URL ------------------
{
  await freshImport('?homly-debug=true');
  assert.equal(globalThis.HOM_DEBUG, true, 'básico sigue disponible por URL: no loguea valores');
}
{
  await freshImport('?homly-debug');   // sin valor: equivale a =true
  assert.equal(globalThis.HOM_DEBUG, true);
}

// --- apagarlo explícitamente por URL sigue funcionando -------------------------------
{
  await freshImport('?homly-debug=false');
  assert.equal(globalThis.HOM_DEBUG, undefined);
}

// --- verbose SÍ puede prenderse por una vía que la URL no controla ------------------
{
  await freshImport('');
  globalThis.HOM_DEBUG = 'verbose';   // asignación directa: el código de la propia app
  assert.equal(globalThis.HOM_DEBUG, 'verbose');
}

// --- con verbose prendido, una clave sensible se redacta, no se loguea -------------
{
  const { Homly } = await freshImport('');
  globalThis.HOM_DEBUG = 'verbose';
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const store = Homly.createStore({ password: '', nombre: '' });
    store.state.password = 'hunter2';
    store.state.nombre = 'Ana';
  } finally {
    console.log = originalLog;
  }
  const joined = logs.join('\n');
  assert.ok(!joined.includes('hunter2'), 'la contraseña nunca aparece en el log');
  assert.ok(joined.includes('«redactado»'), 'se deja constancia de que el valor se redactó');
  assert.ok(joined.includes('"Ana"'), 'una clave no sensible se sigue logueando normalmente');
}

// --- lo mismo para una clave 'token' o 'secret', en cualquier posición del nombre ---
{
  const { Homly } = await freshImport('');
  globalThis.HOM_DEBUG = 'verbose';
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const store = Homly.createStore({ apiToken: '', clientSecret: '' });
    store.state.apiToken = 'abc123';
    store.state.clientSecret = 'zzz999';
  } finally {
    console.log = originalLog;
  }
  const joined = logs.join('\n');
  assert.ok(!joined.includes('abc123') && !joined.includes('zzz999'),
    'pass|token|secret en cualquier parte del nombre de la clave redacta el valor');
}

console.log('✓ debug-mode: 9 checks OK');
