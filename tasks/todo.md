# TODO: homly para blog, SPA y frontend contra API

Detalle completo, criterios de aceptación y decisiones de arquitectura en [plan.md](plan.md).

## Fase 1 — Rutas dinámicas (desbloquea blog y SPA)

- [x] **Task 1 · `matchRoute()` + params como atributos** — S, +87 líneas — deps: ninguna
  - [x] Matcher puro `HomlyRouter.matchRoute(pattern, path)` → params o `null`
  - [x] `_resolve()`: lookup exacto primero, patrones `:param` después, `/404` al final
  - [x] `_create()` con `createElement` + `setAttribute`; `replaceChildren` reemplaza al `innerHTML` interpolado
  - [x] Keep-alive sigue cacheando por path completo (la cache se indexa por `path`, sin cambios)
  - [x] Adopción de prerender: avisa bajo `HOM_DEBUG` si al markup le falta un param
  - [x] `tests/route-match.test.js` con `node:assert` — 21 checks, primer test del repo
  - [x] Warning bajo `HOM_DEBUG` si un param lleva mayúsculas (HTML las baja)

### ⛳ Checkpoint Fase 1
- [x] `npm test` pasa (21 checks)
- [x] Bump 1.8.2 → 1.9.0 en `homly.js`, `package.json` y las URLs del CDN del README
- [x] Presupuesto: 807 líneas (techo 850) · 4.3 KB gzip minificado (techo 5 KB)
- [ ] Checks de navegador en `tests/index.html` (manuales, sin correr todavía)
- [ ] Revisión humana

## Fase 2 — Datos desde una API

- [x] **Task 2 · `store.resource(nombre, deps, fetcher, opts)`** — S/M, +78 líneas — deps: ninguna
  - [x] Registra 3 claves: `nombre`, `nombreLoading`, `nombreError`
  - [x] Re-dispara cuando cambia una dep; con `[]` carga una sola vez
  - [x] `AbortController` + token por disparo: una respuesta vieja nunca pisa a una nueva
  - [x] Opción `{ debounce: 300 }` (el debounce va acá, **no** en `data-model` — ver AD-3)
  - [x] En error, conserva el último valor bueno y limpia el error al recuperarse
  - [x] Devuelve `{ refresh }` para botones de reintentar
  - [x] Refactor previo: fábrica `addSignal(key, initial)` extraída del loop de `createStore`
        (hacía falta para registrar claves después de crear el store; de paso elimina el
        objeto paralelo `subscribers`)
  - [x] `tests/resource.test.js` — 28 checks, incluida la carrera lenta/rápida
- [x] **Task 3 · `Homly.bindQuery(store, [keys], signal)`** — S, +72 líneas — deps: T1, T2
  - [x] Lee `location.search` hacia el store al registrarse — va **antes** del `resource`,
        así el primer fetch ya usa los filtros de la URL en vez de pedir dos veces
  - [x] Escribe con `replaceState` (no apila una entrada de historial por tecla)
  - [x] Valor vacío **o en su default** sale de la URL: `/propiedades` limpio
  - [x] El botón "atrás" restaura los filtros; una clave que desaparece vuelve a su default
  - [x] **Castea por el tipo del valor inicial** — la URL solo tiene strings, y sin esto
        `pagina + 1` daba `'21'`
  - [x] `tests/query.test.js` — 24 checks con `location`/`history` stubeados

### ⛳ Checkpoint Fase 2
- [ ] Listado real contra una API, filtrado en vivo, con loading y error visibles
- [ ] URL filtrada compartible reproduce el mismo resultado
- [ ] Sin carreras reproducibles en `tests/index.html`
- [ ] Revisión humana

## Fase 3 — Listas usables

- [x] **Task 4 · contexto del ítem en acciones de `data-for`** — XS, +30 líneas — deps: ninguna
  - [x] `actions.borrar(target, ctx)` recibe `ctx.item` (el store de la fila)
  - [x] Acciones fuera de `data-for` no cambian de comportamiento (mismo objeto de antes)
  - [x] `WeakMap` nodo → store: borrar la fila alcanza para soltar la entrada
  - [x] Gana la fila más cercana (listas anidadas)
  - [x] Walk-up extraído a `Homly._itemFor(el)` — así deja de ser código no testeable
  - [x] `tests/list-item.test.js` — 13 checks con nodos falsos encadenados por `parentElement`
  - [x] `tests/index.html` corre 6 checks automáticos del camino DOM real (clicks de verdad)

### ⛳ Checkpoint Fase 3
- [x] `npm test` → 86 checks en 4 archivos
- [ ] Los tres casos de uso tienen un ejemplo corriendo
- [ ] Los checks de `tests/index.html` corridos en un navegador (T1 + T4)
- [x] ~~Techo de tamaño~~ retirado por decisión del 2026-07-26

## Fase 4 — Opcionales (no bloquean ningún caso de uso)

- [x] **Task 5 · `Homly.head(tags)`** — XS, +40 líneas — deps: ninguna
  - [x] `title` + cualquier `<meta>`; crea la primera vez, actualiza después
  - [x] Un valor vacío o `null` borra el tag
  - [x] `og:*` se escribe como `property`, el resto como `name`
  - [x] README aclara que **no es SEO** (los scrapers no ejecutan JS — ver AD-4)
  - [x] 8 checks automáticos en `tests/index.html` (DOM real, sin stub)
- [x] **Task 6 · prefetch en hover** — XS, +34 líneas — deps: Task 1
  - [x] Listeners delegados en `document.body`, uno por evento, no uno por link
  - [x] `pointerover` **y** `focusin`: quien navega con teclado recibe lo mismo
  - [x] Una sola vez por ruta (`Set` de rutas, no de paths: dos `/blog/:slug` distintos
        comparten loader)
  - [x] Un prefetch que falla se traga el error; navegar de verdad reintenta
  - [x] `router.prefetch(path)` es público, para adelantar una ruta a mano
  - [x] 7 checks en `tests/route-match.test.js`

## Fuera de este plan

- [ ] Minificar y publicar `homly.min.js` (10.2 KB → 3.9 KB gzip, medido) — el checkpoint 3 lo mide, conviene antes
- [ ] MCP de docs de homly
- ~~Modificador `|debounce` en `data-model`~~ → disuelto dentro de Task 2 (AD-3)
- ~~Head/meta como feature de SEO~~ → demotado a Task 5, no resuelve SEO (AD-4)

## Presupuesto — retirado (decisión del 2026-07-26)

El techo de 850 líneas / 5 KB gzip queda **sin efecto**. homly no compite por ser el más
chico: el objetivo es cubrir lo que cubren los otros para no tener que migrar a ninguno.

| | T1 | T2 | T3 | T4 | T5+T6 |
|---|---|---|---|---|---|
| Líneas de `homly.js` | 807 | 885 | 957 | 988 | 1061 |
| gzip minificado | 4302 B | 4558 B | 4832 B | 4915 B | 5155 B |

Referencia: Alpine.js son 16.7 KB gzip. homly minificado sigue 3× por debajo con las
seis tareas hechas.

Se sigue midiendo, pero como dato, no como límite. La restricción que **sí** sigue viva
—y es la que define al proyecto— es la otra: **sin build, sin dependencias npm, sin
boilerplate**. Esa no se negocia; ver "Techo real" abajo.

## Extra (fuera del plan de 6) — v1.13.1

- [x] **El router deja pasar los links que no le corresponden** — deps: T1, T6
  - [x] Otro origen ⇒ navegación real (`pushState` cross-origin tira `SecurityError`):
        lo pide la arquitectura multi-dominio (homly.dev / homly.blog / homly.world)
  - [x] `target` o `download` ⇒ el autor ya dijo dónde abrirlo
  - [x] ⌘/Ctrl/Shift/Alt+click y click del medio ⇒ "abrir en pestaña nueva" **era un bug
        preexistente**: el router llamaba a `preventDefault()` sin mirar los modificadores
  - [x] El prefetch también ignora links externos (antes bajaba el chunk del `/404`)
  - [x] 9 checks en `tests/route-match.test.js`

## Techo real: qué falta para "que homly haga todo"

Objetivo declarado: cubrir lo que cubren los otros frameworks para no tener que migrar
a ninguno. Del estudio del panorama 2026 sale esta lista. Está partida en dos porque
**una mitad convive con "sin build" y la otra, por construcción, no**.

### Entra sin build — el backlog real

| Falta | Se lo robamos a | Nota |
|---|---|---|
| Acciones con contexto de ítem | — | ya es T4 |
| Head/meta al navegar | React 19 | ya es T5 |
| Prefetch en hover | Inertia 3 | ya es T6 |
| Guard de rutas como hook | Vue Router, Angular | hoy se hace parcheando `handleRoute` a mano |
| Rutas anidadas / layouts | SvelteKit, Nuxt | outlets anidados |
| Formularios + validación | vee-validate, RHF | `data-model` ya existe; falta validar y estado de error |
| Transiciones entre rutas | Astro, Nuxt | **View Transitions es API nativa**: casi gratis |
| Updates optimistas | Inertia 3 | encaja como opción de `resource` |
| Paginación / scroll infinito | — | `IntersectionObserver` nativo |
| Lazy de imágenes y componentes | Alpine `x-intersect` | `IntersectionObserver` nativo |
| Realtime (WebSocket → store) | — | una señal que se suscribe a un socket |
| i18n | vue-i18n | `Intl` nativo + un store global |
| Tipos `.d.ts` | — | a mano, sin `tsc` |
| DevTools | Alpine, Vue | extensión que lea los stores |
| MCP de docs | Angular, Svelte, Astro | el README ya es la doc entera |

### No entra sin build — y hay que decirlo

Esto es exactamente lo que se compra con un paso de compilación. No se puede tener
"cero build" **y** esto al mismo tiempo:

- **SSR / streaming** (Next, Nuxt, Angular SSR) — necesita un servidor Node corriendo.
- **Server Components / Server Actions** (React 19) — ídem.
- **Optimizaciones de compilador** (Svelte runes, Vue Vapor) — necesitan compilador.
- **Single File Components** (`.vue`, `.svelte`) — ídem.
- **Type checking** — necesita `tsc`.
- **Tree-shaking del código de tu app** — necesita bundler.

**La salida intermedia — ACEPTADA (2026-07-26):** un CLI **opcional**
(`npx homly prerender`) que genere HTML estático de las rutas. No rompe la promesa
—seguís pudiendo usar homly con un `<script>` y nada más— y le tapa el agujero de SEO al
blog. Es lo mismo que hace Alpine: no exige build, pero no te lo prohíbe.

Reglas que tiene que respetar para no traicionar el proyecto:

1. **`homly.js` no se entera de que el CLI existe.** Cero código de build en el runtime,
   cero condicionales `if (isPrerender)`. Paquete aparte (`homly-cli`), o un archivo
   suelto del repo que no se publica en el bundle.
2. **Opt-in de verdad.** Todo lo que hoy anda sin el CLI tiene que seguir andando sin él.
   Si algún día una feature *requiere* prerender, dejó de ser opcional.
3. **Sin config.** Lee las rutas que ya declaraste en el router; no inventa un
   `homly.config.js`.
4. **Salida = HTML plano.** Cada ruta escribe un `.html` con su `<head>` resuelto y el
   markup del componente ya renderizado, listo para que el router lo **adopte** (la
   hidratación de DOM prerenderizado ya existe desde v1.8.0: el CLI no agrega un
   mecanismo nuevo, solo genera lo que ese mecanismo ya sabe consumir).

Lo que sí necesita el CLI es un DOM del lado de Node para correr los componentes. Ahí hay
una decisión que evaluar cuando le toque: usar el navegador que ya tenés (Playwright/
Chrome headless, cero implementación pero pesado) o un DOM mínimo propio. **No planificado
todavía** — va después de T5/T6.

## Preguntas abiertas

1. ¿`store.resource(...)` o `Homly.resource(...)` suelto? (el plan asume el primero — `data-for` no lee el segundo)
2. ¿Los params se reflejan como señales, además de atributos? Solo hace falta si una ruta cambia de param sin remontar (keep-alive `/blog/a` → `/blog/b`)
3. ¿Slices 5 y 6 entran en este ciclo o quedan para después?
