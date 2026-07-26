/**
 * Checks para Homly._itemFor — la resolución de "¿de qué fila salió este click?".
 * Lo que se puede romper acá no es obvio: que gane la fila más cercana (listas
 * anidadas), que un click fuera de toda lista devuelva undefined en vez de la última
 * fila registrada, y que el propio nodo de la fila cuente como su propia fila.
 *
 * Corre sin dependencias ni build:  node tests/list-item.test.js
 *
 * _itemFor solo usa `parentElement` y un WeakMap, así que unos objetos planos
 * encadenados alcanzan como DOM.
 */
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
const { Homly } = await import('../homly.js');

/** Encadena nodos falsos de padre a hijo y devuelve el último (el más profundo). */
const cadena = (...nodos) => {
  nodos.forEach((n, i) => { n.parentElement = nodos[i - 1] ?? null; });
  return nodos;
};

// --- el click sale de adentro de una fila -------------------------------------
{
  const [host, fila, celda, boton] = cadena({}, {}, {}, {});
  const store = Homly.createStore({ id: 7 });
  Homly.listItems.set(fila, store);

  assert.equal(Homly._itemFor(boton), store, 'sube desde el botón hasta la fila');
  assert.equal(Homly._itemFor(celda), store);
  assert.equal(Homly._itemFor(fila), store, 'la propia fila cuenta como su fila');
  assert.equal(Homly._itemFor(host), undefined, 'el host está por encima de la fila');
}

// --- fuera de toda lista -------------------------------------------------------
{
  const [host, boton] = cadena({}, {});
  assert.equal(Homly._itemFor(boton), undefined);
  assert.equal(Homly._itemFor(host), undefined);
}

// --- listas anidadas: gana la más cercana --------------------------------------
{
  const [host, filaExterna, filaInterna, boton] = cadena({}, {}, {}, {});
  const externa = Homly.createStore({ id: 'padre' });
  const interna = Homly.createStore({ id: 'hijo' });
  Homly.listItems.set(filaExterna, externa);
  Homly.listItems.set(filaInterna, interna);

  assert.equal(Homly._itemFor(boton), interna, 'la fila interna gana');
  assert.equal(Homly._itemFor(filaExterna), externa);
}

// --- dos filas hermanas no se pisan --------------------------------------------
{
  const host = { parentElement: null };
  const filaA = { parentElement: host };
  const filaB = { parentElement: host };
  const botonA = { parentElement: filaA };
  const botonB = { parentElement: filaB };
  const a = Homly.createStore({ id: 'a' });
  const b = Homly.createStore({ id: 'b' });
  Homly.listItems.set(filaA, a);
  Homly.listItems.set(filaB, b);

  assert.equal(Homly._itemFor(botonA).state.id, 'a');
  assert.equal(Homly._itemFor(botonB).state.id, 'b');
}

// --- la fila expone su store, no una copia: se lee y se puede tocar -----------
{
  const [, fila, boton] = cadena({}, {}, {});
  const store = Homly.createStore({ id: 3, titulo: 'casa' });
  Homly.listItems.set(fila, store);

  const item = Homly._itemFor(boton);
  assert.equal(item.state.id, 3);
  assert.equal(item.state.titulo, 'casa');

  item.state.titulo = 'depto';
  assert.equal(store.state.titulo, 'depto', 'es el store de la fila, no un snapshot');
}

console.log('✓ list-item: 13 checks OK');
