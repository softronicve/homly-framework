/**
 * Checks para los códigos estables de warning ("[homly Hxxx] mensaje corto") — DX P6:
 * cada código que aparece en homly.js tiene que estar documentado en errors.json, y
 * viceversa, así el listado nunca queda desactualizado (el futuro homly.doctor.js y las
 * páginas homly.dev/e/{code} leen de este mismo archivo).
 *
 * Corre sin dependencias ni build:  node tests/errors.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(ROOT, 'homly.js'), 'utf8');
const errors = JSON.parse(readFileSync(path.join(ROOT, 'errors.json'), 'utf8'));

const used = new Set([...source.matchAll(/\[homly (H\d{3})\]/g)].map((m) => m[1]));

// --- todo código usado en homly.js está documentado ---------------------------------
{
  const undocumented = [...used].filter((code) => !Object.hasOwn(errors, code));
  assert.deepEqual(undocumented, [], 'un código usado en homly.js sin entrada en errors.json: ' + undocumented.join(', '));
}

// --- todo código documentado se usa de verdad (nada de entradas huérfanas) ----------
{
  const orphaned = Object.keys(errors).filter((code) => !used.has(code));
  assert.deepEqual(orphaned, [], 'una entrada de errors.json que ningún warning usa: ' + orphaned.join(', '));
}

// --- el formato es siempre "Hxxx" (tres dígitos), y cada mensaje es una sola línea -----
{
  for (const code of Object.keys(errors)) {
    assert.match(code, /^H\d{3}$/, 'código con formato raro: ' + code);
    assert.equal(typeof errors[code], 'string');
    assert.ok(!errors[code].includes('\n'), 'errors.json:' + code + ' debe ser una sola línea');
  }
}

// --- se usa al menos un código por categoría ya cubierta en 1.10 --------------------
{
  assert.ok(used.has('H104') && used.has('H201') && used.has('H701'),
    'algunos códigos ya existentes de v1.9.1 siguen presentes');
}

console.log('✓ errors: 36 checks OK');
