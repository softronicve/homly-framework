# Implementation Plan: homly para blog, SPA y frontend contra API

## Overview

Llevar homly.js de "componentes reactivos" a "framework que cubre tres casos completos"
—un blog, una SPA y un frontend que consume una API con filtros— **sin agregar build,
sin dependencias npm y sin boilerplate**. El presupuesto total es ~110 líneas sobre las
720 actuales.

El análisis del roadmap original de 6 puntos lo dejó en **5 slices**: uno se disolvió
dentro de otro, uno se demotó porque no resuelve el problema para el que se propuso, y
apareció un hueco que no estaba en la lista.

## Architecture Decisions

**AD-1 — Los params de ruta viajan como atributos del Custom Element, no como store global.**
`createStore` fija sus claves al crearse, así que un store global de ruta con claves
dinámicas (`slug`, `id`, …) obliga a inventar máquinaria. Los Custom Elements ya tienen
atributos: `handleRoute` crea `<blog-post slug="mi-post">` con `setAttribute` y el
componente lee `this.getAttribute('slug')`. Cero API nueva, cero escape de HTML
(`createElement` en vez de `innerHTML`), y el keep-alive sigue cacheando por path completo
sin tocarse.

**AD-2 — `resource` se registra como claves del store, no devuelve un objeto.**
`data-for` necesita una señal que *sea* el array. Si `resource()` devolviera
`{data, loading, error}` en una sola señal, ninguna directiva existente lo podría leer.
Siguiendo el patrón que ya existe (`store.computed(nombre, deps, fn)` inyecta una clave),
`store.resource('items', ['q'], fetcher)` registra **tres** claves: `items`, `itemsLoading`,
`itemsError`. Resultado: `data-for="items"`, `data-if="itemsLoading"` y
`data-bind="itemsError"` funcionan sin una sola directiva nueva.

**AD-3 — El debounce vive en `resource`, no en `data-model`.**
Era el punto 4 del roadmap. Debouncear en `data-model` retrasaría *todos* los suscriptores
de la señal, incluido el eco del propio `<input>` — el usuario vería su tecleo con lag.
Lo que hay que debouncear es el efecto de red, no el valor. Pasa a ser una opción:
`store.resource('items', ['q'], fetcher, { debounce: 300 })`. Ahorra el parser de
modificadores y una sintaxis nueva que documentar.

**AD-4 — El manejo de `<head>` NO resuelve el SEO del blog. Se demota.**
Era el punto 3, justificado como "sin esto el blog no indexa". Es falso: los scrapers
sociales (WhatsApp, Twitter, Slack, Facebook) **no ejecutan JavaScript**, así que un
`og:image` puesto después de hidratar no existe para ellos. Para un blog los meta tags
tienen que estar en el HTML servido — que es exactamente lo que homly ya soporta vía
adopción de prerender: un `.html` por post con su `<head>` escrito, y homly hidrata las
islas. El helper de head queda, pero por lo que sí resuelve: **actualizar `document.title`
al navegar dentro de la SPA**. Prioridad baja, no bloquea nada.

**AD-5 — Hueco encontrado: las filas de `data-for` no tienen contexto en sus acciones.**
No estaba en el roadmap y lo necesita todo frontend contra API (editar/borrar por fila).
Hoy `attachDispatcher` está en el host y hace `e.target.closest('[data-action]')`; el
handler recibe el nodo pero no tiene forma soportada de saber **qué ítem** es. El patrón
actual —stampar `data-bind-attr="data-id:id"` y leerlo con `closest`— funciona pero no
está documentado ni es obvio. `bindList` ya tiene el `itemStore` de cada fila: alcanza con
que lo deje accesible desde el nodo y que el dispatcher lo pase como contexto.

**AD-6 — Las dos piezas con lógica no trivial estrenan el primer test del repo.**
El matcher de rutas es un parser y `resource` tiene una carrera clásica (respuesta vieja
que pisa a la nueva). Ambas se rompen en silencio. El repo no tiene toolchain, así que:
la lógica pura de matcheo se extrae y se verifica con `node tests/route-match.test.js`
(el `assert` de Node, cero dependencias); lo que toca DOM va a un `tests/index.html` que
se abre en el navegador. Sin frameworks de test, sin fixtures.

## Dependency Graph

```
homly.js (base actual: signals + bindView + bindList + router)
   │
   ├── Slice 1 · matchRoute() + params como atributos ──────► blog /blog/:slug
   │        │                                                  SPA /propiedades/:id
   │        └── Slice 3 · query params ↔ store  ─────► filtros compartibles por URL
   │                     (depende: el router ya parsea la URL)
   │
   ├── Slice 2 · store.resource() (+ debounce, + abort) ────► listados desde API
   │        │                                                 estados loading/error
   │        └── Slice 3 (los filtros alimentan al resource)
   │
   ├── Slice 4 · contexto de ítem en acciones ──────────────► acciones por fila
   │             (depende: bindList, independiente del resto)
   │
   ├── Slice 5 · Homly.head() ──────────────────────────────► título por ruta
   │             (independiente)
   │
   └── Slice 6 · prefetch en hover ─────────────────────────► polish
                 (depende: Slice 1 para no prefetchear mal las rutas con params)
```

Orden: 1 → 2 → 3 → 4 → (5, 6 opcionales).
Los slices 1, 2 y 4 son independientes entre sí y podrían ir en paralelo; 3 depende de 1 y 2.

## Task List

### Fase 1 — Rutas dinámicas (desbloquea blog y SPA)

- [ ] Task 1: `matchRoute()` + params como atributos del elemento

### Checkpoint: Fase 1

### Fase 2 — Datos desde una API

- [ ] Task 2: `store.resource(nombre, deps, fetcher, opts)`
- [ ] Task 3: query params sincronizados con el store

### Checkpoint: Fase 2

### Fase 3 — Listas usables

- [ ] Task 4: contexto del ítem en las acciones de `data-for`

### Checkpoint: Fase 3

### Fase 4 — Opcionales (no bloquean ningún caso de uso)

- [ ] Task 5: `Homly.head()` — título/meta al navegar
- [ ] Task 6: prefetch en hover de `data-router-link`

---

## Task 1: `matchRoute()` + params como atributos del elemento

**Description:** `handleRoute` resuelve rutas con `this.routes[path]`, igualdad exacta de
string. No existe `/blog/:slug`. Se extrae un matcher puro que compile los patrones
registrados y devuelva `{ route, params }`, y `handleRoute` pasa cada param como atributo
del elemento que crea. Es el único cambio que bloquea dos de los tres casos de uso.

**Acceptance criteria:**
- [ ] `router.add('/blog/:slug', 'blog-post', loader)` matchea `/blog/mi-post` y no matchea `/blog` ni `/blog/a/b`.
- [ ] El elemento se crea con `setAttribute('slug', 'mi-post')` — nunca por interpolación en `innerHTML`.
- [ ] Las rutas estáticas siguen ganando sobre las dinámicas (`/blog/nuevo` le gana a `/blog/:slug`).
- [ ] El keep-alive sigue cacheando por path completo: `/blog/a` y `/blog/b` son entradas distintas.
- [ ] La adopción de prerender sigue funcionando en una ruta con params.

**Verification:**
- [ ] `node tests/route-match.test.js` pasa (asserts sobre el matcher puro, sin DOM).
- [ ] Manual: `tests/index.html` navega a `/blog/hola` y el componente muestra el slug.
- [ ] Manual: `HOM_DEBUG=true` loguea `⚡ route ∅ → /blog/hola` sin warnings nuevos.

**Dependencies:** None

**Files likely touched:** `homly.js`, `tests/route-match.test.js`, `README.md`

**Estimated scope:** S (~25 líneas)

---

## Task 2: `store.resource(nombre, deps, fetcher, opts)`

**Description:** Hoy cualquier carga desde una API se escribe a mano en `onMount`, con su
propio estado de loading, su propio manejo de error y ninguna protección contra respuestas
que llegan fuera de orden. `resource` registra tres claves en el store (`nombre`,
`nombreLoading`, `nombreError`) y re-dispara el fetch cuando cambia alguna de sus deps.
Es el corazón del caso "frontend contra una API".

**Acceptance criteria:**
- [ ] `store.resource('items', ['q'], q => fetch(...).then(r => r.json()))` llena `items`, y `data-for="items"` renderiza sin directivas nuevas.
- [ ] `itemsLoading` es `true` mientras corre y `false` al terminar, en éxito y en error.
- [ ] Un fetch en vuelo se aborta (`AbortController`) cuando una dep cambia: **una respuesta vieja nunca pisa a una nueva**.
- [ ] `{ debounce: 300 }` agrupa cambios rápidos de deps en un solo fetch; sin la opción, no hay retraso.
- [ ] Un error deja `itemsError` con el error y `items` con su último valor bueno (no lo borra).

**Verification:**
- [ ] `tests/index.html`: teclear rápido en el filtro dispara **un** request, no uno por tecla (visible en Network).
- [ ] `tests/index.html`: caso de carrera — respuesta lenta seguida de una rápida deja el resultado de la rápida.
- [ ] Manual: apagar la red y confirmar que `itemsError` se muestra y `items` conserva lo anterior.

**Dependencies:** None (independiente de Task 1)

**Files likely touched:** `homly.js`, `tests/index.html`, `README.md`

**Estimated scope:** S/M (~40 líneas)

---

## Task 3: query params sincronizados con el store

**Description:** Los filtros viven en el store pero no en la URL, así que un listado
filtrado no se puede compartir ni sobrevive a un F5. Un helper lee `location.search` hacia
las claves del store al montar y las escribe de vuelta con `replaceState` cuando cambian.

**Acceptance criteria:**
- [ ] Abrir `/propiedades?q=casa&orden=precio` deja el store con esos valores antes del primer render.
- [ ] Cambiar un filtro actualiza la URL con `replaceState` (no ensucia el historial con cada tecla).
- [ ] Un valor vacío quita el param de la URL en vez de dejar `?q=`.
- [ ] Volver con el botón "atrás" del navegador restaura los filtros.

**Verification:**
- [ ] Manual: filtrar, copiar la URL, abrirla en una pestaña nueva → el mismo resultado.
- [ ] Manual: filtrar tres veces y confirmar que "atrás" vuelve una sola vez a la página anterior.

**Dependencies:** Task 1 (el router ya parsea la URL), Task 2 (el resource consume los filtros)

**Files likely touched:** `homly.js`, `README.md`

**Estimated scope:** S (~15 líneas)

---

## Task 4: contexto del ítem en las acciones de `data-for`

**Description:** Hueco encontrado durante el análisis, no estaba en el roadmap. Un botón
"borrar" dentro de una fila de `data-for` no tiene forma soportada de saber qué ítem lo
disparó. `bindList` ya construye el `itemStore` de cada fila; alcanza con dejarlo colgado
del nodo y que `attachDispatcher` lo pase en el contexto del handler.

**Acceptance criteria:**
- [ ] `actions.borrar(target, ctx)` recibe en `ctx.item` el store de la fila que se clickeó.
- [ ] Un `data-action` **fuera** de cualquier `data-for` sigue recibiendo el contexto de antes, sin `item`.
- [ ] La referencia se libera cuando la fila se elimina (no retiene nodos removidos).

**Verification:**
- [ ] `tests/index.html`: lista de 3 ítems, borrar el del medio saca el correcto.
- [ ] Manual: con `HOM_DEBUG` no aparecen warnings nuevos al montar/desmontar la lista.

**Dependencies:** None

**Files likely touched:** `homly.js`, `tests/index.html`, `README.md`

**Estimated scope:** XS (~8 líneas)

---

## Task 5: `Homly.head()` — título/meta al navegar *(opcional)*

**Description:** Actualiza `document.title` y los meta tags al cambiar de ruta.
**No es una feature de SEO** (ver AD-4): los scrapers sociales no ejecutan JS. Sirve para
que la pestaña y el historial digan lo correcto dentro de la SPA.

**Acceptance criteria:**
- [ ] `Homly.head({ title, description })` setea el título y actualiza (o crea) el `<meta name="description">`.
- [ ] Llamarlo dos veces no duplica el meta tag.
- [ ] El README dice explícitamente que para SEO/link previews los tags van en el HTML servido.

**Verification:**
- [ ] Manual: navegar entre dos rutas y ver el título de la pestaña cambiar en ambos sentidos.

**Dependencies:** None

**Files likely touched:** `homly.js`, `README.md`

**Estimated scope:** XS (~12 líneas)

---

## Task 6: prefetch en hover de `data-router-link` *(opcional)*

**Description:** Al pasar el mouse sobre un link del router, correr el `loader()` de esa
ruta. `loadTemplate` ya cachea y colapsa requests, así que el trabajo llega hecho al click.
Puro polish: no desbloquea ningún caso de uso.

**Acceptance criteria:**
- [ ] Hover sobre `<a data-router-link href="/x">` dispara el `import()` de esa ruta una sola vez.
- [ ] Un hover sobre una ruta sin loader, o ya cargada, no hace nada.
- [ ] El listener es delegado (uno solo en `document.body`), no uno por link.

**Verification:**
- [ ] Manual: en Network, hacer hover y ver el chunk descargarse antes del click.
- [ ] Manual: hover repetido sobre el mismo link no repite el request.

**Dependencies:** Task 1 (para no prefetchear patrones con params sin resolver)

**Files likely touched:** `homly.js`, `README.md`

**Estimated scope:** XS (~10 líneas)

---

## Checkpoints

### Checkpoint: Fase 1 (tras Task 1)
- [ ] `node tests/route-match.test.js` pasa.
- [ ] Las rutas estáticas de un proyecto existente (homly.world) siguen funcionando sin cambios.
- [ ] Bump de versión y URLs del CDN del README actualizadas en el mismo PR.
- [ ] Revisión humana antes de seguir.

### Checkpoint: Fase 2 (tras Tasks 2-3)
- [ ] Un listado real contra una API responde a un filtro tecleado, con loading y error visibles.
- [ ] La URL filtrada se puede compartir y reproduce el mismo resultado.
- [ ] Ningún caso de carrera reproducible en `tests/index.html`.
- [ ] Revisión humana antes de seguir.

### Checkpoint: Fase 3 (tras Task 4)
- [ ] Los tres casos de uso —blog, SPA, API con filtros— tienen un ejemplo corriendo.
- [ ] homly.js sigue por debajo de 850 líneas.
- [ ] `gzip -9` del build minificado sigue por debajo de 5 KB.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El matcher de rutas rompe las rutas estáticas de proyectos en producción (homly.world) | **Alto** | Las estáticas se resuelven primero por lookup exacto; el matcher solo corre si ese lookup falla. Test de regresión en el checkpoint 1. |
| `resource` deja carreras: respuesta vieja pisa a la nueva | **Alto** | `AbortController` por disparo + descartar cualquier respuesta que no sea la del último token. Caso explícito en `tests/index.html`. |
| El scope crece y homly deja de ser "un archivo que se lee de una sentada" | Medio | Presupuesto duro: 850 líneas y 5 KB gzip minificado en el checkpoint 3. Si no entra, se corta un slice, no se sube el techo. |
| Se confunde `Homly.head()` con una solución de SEO | Medio | AD-4 documentado en el README, en la propia sección de la API. |
| Cada slice necesita bump de versión y tocar las URLs del CDN del README | Bajo | Está en la checklist de cada checkpoint. |
| Estrenar tests sin toolchain se convierte en un proyecto aparte | Bajo | Techo explícito: `node` + `assert` para lógica pura, un `tests/index.html` para DOM. Sin frameworks, sin fixtures, sin CI. |

## Open Questions

1. **¿`resource` va en el store o suelto?** El plan asume `store.resource(...)` por simetría
   con `store.computed(...)`. La alternativa (`Homly.resource(...)` devolviendo una señal
   suelta) es más flexible pero no la lee `data-for`. Decisión tomada, pero es reversible.
2. **¿Los params de ruta se reflejan además como señales?** Con atributos alcanza para leerlos
   al montar. Si una ruta tiene que cambiar de param **sin** remontar el componente
   (`/blog/a` → `/blog/b` con keep-alive), hace falta `attributeChangedCallback` +
   `observedAttributes`. No está en el plan: agregarlo solo si aparece el caso real.
3. **¿Slices 5 y 6 entran en este ciclo o quedan para después?** No bloquean nada.
4. **¿Se minifica en este ciclo?** Fuera del plan, pero el checkpoint 3 mide gzip, así que
   conviene resolverlo antes (10.2 KB → 3.9 KB medidos).
