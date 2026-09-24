# homly.js

Micro-framework de Web Components con reactividad por señales. Vanilla JS, sin
dependencias y sin paso de build: corre directo en el navegador.

La idea es simple:

- Cada componente es un Custom Element que hereda de `HomlyComponent`.
- El HTML y el CSS van en archivos aparte; el JS los carga con `templateUrl` y `styleUrl`.
- El estado es reactivo: una señal por variable. El DOM se enlaza con atributos `data-*`.
- Los eventos se manejan con `data-action`.

## Instalación

No hay nada que instalar ni compilar. Puedes cargar `homly.js` desde un CDN, fijando la versión por tag:

```js
import { HomlyComponent, Homly } from 'https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.10.0/homly.js';
```

O, para no repetir la URL en cada componente, declara un import map en tu `index.html` y usa un specifier corto:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<script type="importmap">
{ "imports": { "homly": "https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.10.0/homly.js" } }
</script>
```

```js
import { HomlyComponent, Homly } from 'homly';
```

Fija siempre una versión (`@v1.10.0`); evita `@latest` o `@main` en producción, porque cambian sin aviso. También puedes descargar `homly.js` (o `homly.min.js`, la misma versión minificada que se publica en cada tag) y servirlo desde tu propio dominio.

## Ejemplo

```js
import { HomlyComponent, Homly } from 'homly';

class Contador extends HomlyComponent {
  get basePath() { return import.meta.url; }
  get templateUrl() { return './contador.html'; }
  get styleUrl() { return './contador.css'; }

  // Memoiza el store (el ??=) para que la vista y las acciones usen la misma instancia.
  get store() {
    return (this._store ??= Homly.createStore({ n: 0 }));
  }

  get actions() {
    return { sumar: () => { this.store.state.n++; } };
  }
}

customElements.define('mi-contador', Contador);
```

```html
<!-- contador.html -->
<button data-action="sumar">+1</button>
<span data-bind="n"></span>
```

## Directivas

- `data-bind="clave"` — escribe el valor de la señal en el texto del elemento.
- `data-if="clave"` — muestra u oculta según el valor.
- `data-bind-class="clase:clave"` — agrega o quita una clase. Acepta varios pares
  separados por coma: `data-bind-class="activo:esActivo, destacado:esDestacado"`.
- `data-bind-attr="atributo:clave"` — enlaza un atributo (por ejemplo `href`). También
  acepta varios pares: `data-bind-attr="src:foto, alt:titulo"`.
- `data-model="clave"` — enlace de doble vía en `input`, `textarea`, `select` y checkbox:
  la señal escribe el control y el control escribe la señal (`change` en `select` y
  checkbox, `input` en el resto). En un checkbox se enlaza `checked`, no `value`.
- `data-action="[evento[.tecla]->]nombre"` — conecta un evento a `actions[nombre]`. Sin
  flecha (`data-action="nombre"`) es `click`, igual que siempre. Con flecha, cualquiera
  de `click`, `submit`, `change`, `input` o `keydown` (`keydown.enter->enviar` solo corre
  con esa tecla). Ver la sección de eventos, abajo.
- `data-loading-text="…"` — mientras una acción asíncrona corre, el framework gestiona solo el estado de carga del control: lo deshabilita, le agrega la clase `is-loading` y, si tiene `data-loading-text`, le pone ese texto. Al terminar, restaura el estado (el texto solo se restaura si la acción no lo cambió ella misma). No hace falta tocar el botón a mano. Si la acción es síncrona (no devuelve una promesa), este estado ni se activa.
- `data-for="clave"` en un `<template>` — renderiza una lista desde un array del
  store. Requiere `data-key="campo"` (identidad para reusar nodos al cambiar el
  array) y acepta `data-index="i"` (expone el índice 0-based, reactivo). Adentro,
  las directivas normales (`data-bind`, etc.) resuelven contra cada ítem. Para que
  reaccione, reasigna el array con una referencia nueva: `store.state.items = [...next]`.
  Cada ítem debe tener **un único elemento raíz** en el `<template>`; los hermanos de
  nivel superior se ignoran (con `HOM_DEBUG` el framework avisa si hay más de uno).
  Un `data-action` adentro de la lista recibe su fila en `ctx.item` (ver abajo).

```html
<!-- una lista reactiva: reusa nodos al cambiar el array -->
<template data-for="propiedades" data-key="id" data-index="i">
  <article data-bind-attr="data-id:id">
    <span data-bind="i"></span>. <strong data-bind="titulo"></strong> — <span data-bind="precio"></span>
  </article>
</template>
```

```js
// para que reaccione, reasigna con una referencia nueva (no mutes in-place):
store.state.propiedades = [...store.state.propiedades, nuevaPropiedad];
```

## API

- `HomlyComponent` — clase base. Getters: `templateUrl`, `styleUrl`, `basePath`,
  `store`, `actions`, `globalStores`. Hooks: `onMount` (una vez), `onActivate`
  (cada vez que se muestra), `onDeactivate` (cada vez que se oculta con keep-alive),
  `onUnmount` (al destruir).
- `Homly.createStore(estado)` — devuelve `{ state, signals, computed }`. Mutás con
  `store.state.clave = valor`.
- `Homly.computed(deps, fn)` — señal derivada de solo lectura. `deps` son señales;
  `fn` es una función pura de sus valores. Se recalcula cuando una dep cambia y
  notifica solo si el resultado cambió. Como es una señal, se puede bindear igual.
- `store.computed(nombre, [keys], fn)` — registra una computed como key del store,
  así `data-bind="nombre"` y `store.state.nombre` funcionan sin nada extra.
- `store.resource(nombre, [keys], fetcher, opts)` — carga asíncrona como **tres** keys
  del store: `nombre`, `nombreLoading` y `nombreError` (ver abajo). Varias keys que
  cambian en el mismo tick se agrupan en **un solo** fetch (microtask); `{ sync: true }`
  vuelve al disparo inmediato de antes de 1.10.
- `Homly.bindQuery(store, [keys], signal)` — espeja esas keys en el query string, así un
  listado filtrado se puede compartir por URL y sobrevive un F5 (ver abajo). Igual que
  `resource`, varios cambios en el mismo tick se agrupan en un solo `replaceState`.
- `Homly.head({ title, description, canonical, jsonld, … })` — título, `<link
  rel=canonical>`, JSON-LD y `<meta>` de la pestaña al navegar. **No es SEO** (ver abajo).
- `el.ready` / evento `homly:hydrated` — en cualquier `HomlyComponent`: la promesa se
  resuelve (y el evento se dispara, con `bubbles: true`) justo después de `onMount`/
  `onActivate`, útil para una isla que espera a que otra termine de hidratar.
- `Homly.messages.loadError` — el texto del error boundary (`renderError`); reasignalo
  para traducirlo o cambiar el tono. `Homly.styleMode = 'inline'` y `Homly.styleNonce`
  controlan cómo se inyecta el CSS de los componentes (ver *Estilos y CSP*, abajo).
- `HomlyRouter` — router SPA mínimo. Intercepta `<a data-router-link>` y permite
  lazy loading por ruta. Las rutas aceptan segmentos `:param` (ver abajo).
  Con `new HomlyRouter('root', { keepAlive: true })` conserva
  el DOM/estado/scroll de cada ruta visitada (la oculta en vez de destruirla) y llama
  a `onActivate`/`onDeactivate`; `evict(path)` la descarga de la cache. En la carga
  inicial, si el outlet ya contiene el elemento de la ruta (HTML prerenderizado), el
  router lo **adopta** y lo hidrata en lugar de recrearlo (automático, sin config);
  navegaciones posteriores recrean/keep-alivean como siempre.

## Rutas con parámetros

Una ruta puede llevar segmentos `:param`, y cada valor le llega al componente **como
atributo**. No hay API nueva que aprender: se lee con `getAttribute`, que es lo que los
Custom Elements ya hacen.

```js
router.add('/blog/:slug', 'blog-post', () => import('./blog-post.js'));
```

```js
class BlogPost extends HomlyComponent {
  get templateUrl() { return './blog-post.html'; }
  onMount() {
    const slug = this.getAttribute('slug');   // '/blog/hola-mundo' → 'hola-mundo'
  }
}
```

Reglas de matcheo:

- **La ruta estática gana.** Con `/blog/nuevo` y `/blog/:slug` registradas, `/blog/nuevo`
  resuelve al editor, no a un post con slug `nuevo`. El orden de registro no importa.
- **La cantidad de segmentos tiene que coincidir.** `/blog/:slug` coincide con `/blog/hola`,
  pero no con `/blog` ni con `/blog/a/b`. Un segmento vacío (`/blog/`) tampoco coincide.
- **El valor se decodifica**: `/buscar/caf%C3%A9` llega como `café`.
- **Sin riesgo de inyección**: los params se aplican con `setAttribute`, que nunca
  interpreta HTML. De todos modos, para escribirlos en la página usa `data-bind` o `textContent`.
- **Los params van en minúscula.** HTML baja los nombres de atributo, así que
  `/u/:userId` se lee con `getAttribute('userid')`. Usa kebab-case (`:user-id`); con
  `HOM_DEBUG` el framework avisa al registrar la ruta.
- **Con keep-alive, cada path es su propia entrada**: `/blog/a` y `/blog/b` conservan
  su DOM y su estado por separado.
- **Con DOM prerenderizado**, los atributos tienen que estar escritos en el markup
  (`<blog-post slug="hola-mundo">`): cuando el router adopta el elemento, su `onMount`
  ya corrió. Con `HOM_DEBUG` el framework avisa si falta alguno.

El componente se monta de nuevo en cada navegación, así que `onMount` vuelve a leer el
atributo. Si necesitas que una ruta cambie de parámetro **sin** volver a montarse (keep-alive de
`/blog/a` a `/blog/b`), usa `observedAttributes` + `attributeChangedCallback`, que ya
son parte de la plataforma.

## Datos desde una API: `store.resource`

`resource` registra una carga asíncrona como **tres claves** del store —el valor, un
booleano de carga y el error— así que se bindean con las directivas que ya conocés,
sin nada nuevo:

```js
get store() {
  return (this._store ??= (() => {
    const s = Homly.createStore({ q: '', orden: 'precio' });

    s.resource('propiedades', ['q', 'orden'], (q, orden, { signal }) =>
      fetch(`/api/propiedades?q=${encodeURIComponent(q)}&orden=${orden}`, { signal })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      { debounce: 300 },
    );

    return s;
  })());
}
```

```html
<input data-model="q" placeholder="Buscar…">

<p data-if="propiedadesLoading">Cargando…</p>
<p data-if="propiedadesError" data-bind="propiedadesError"></p>

<template data-for="propiedades" data-key="id">
  <article><strong data-bind="titulo"></strong> — <span data-bind="precio"></span></article>
</template>
```

Qué hace por ti:

- **Se re-dispara solo** cuando cambia cualquiera de sus deps. Con `[]` carga una vez.
- **Ninguna respuesta vieja sobrescribe a una nueva.** Cada ejecución aborta la anterior y lleva
  un token; si la primera request tarda más que la segunda, se descarta. Es el bug que
  aparece una de cada veinte búsquedas y que no se ve leyendo el código.
- **El fetcher recibe un `{ signal }`** al final: pásalo a `fetch` y el navegador
  cancela de verdad la request abortada.
- **En error conserva el último valor bueno.** Un refresh que falla no te blanquea la
  lista que ya está en pantalla; `nombreError` te dice qué pasó.
- **`debounce`** agrupa cambios rápidos (tipear en un filtro) en un solo request. La
  primera carga nunca se retrasa.
- **Varias deps cambiadas en el mismo tick disparan un solo fetch** (con el estado
  final, no uno por cada asignación intermedia) — el efecto es un microtask después del
  cambio, así que `nombreLoading` pasa a `true` recién ahí, no en el mismo tick.
  `{ sync: true }` vuelve al disparo inmediato (pre-1.10) si necesitas leer `loading`
  sincrónico justo después de cambiar una dep.
- **Devuelve `{ refresh }`** para un botón de reintentar.

`fetch` no lanza error con un 404 o un 500, así que **verifica `response.ok` y lanza tú**
si quieres que llegue a `nombreError`.

Para filtrar del lado del cliente sin volver a llamar a la API, coloca una `computed`
encima del resource:

```js
s.computed('visibles', ['propiedades', 'soloConFoto'],
  (props, soloConFoto) => (props || []).filter(p => !soloConFoto || p.foto));
```

## SSR sin Node: adopción, siembra y `renderers/homly.php`

homly.js puede hidratar HTML que un servidor ya renderizó, sin refetch y sin
recrear nodos — protocolo pensado para un backend PHP (u otro), no para Node:

- **El host se marca con `data-homly-ssr`.** Tiene prioridad sobre la heurística de
  "¿ya tiene hijos?": aunque el contenido renderizado quede vacío (una lista sin
  resultados, por ejemplo), el componente nunca refetchea su plantilla.
- **`Homly.bindList` adopta las filas** que el servidor marcó con
  `data-homly-key="<clave>"`, ubicadas justo después del `<template>` y en el mismo
  orden que el array inicial del store. Son los **mismos nodos** — no se clonan —, y sus
  directivas quedan atadas al store *de esa fila*, no al del host.
- **`Homly.initial(host, defaults)`** lee el `<script type="application/json"
  data-homly-state>` hijo directo del host y superpone sus valores sobre `defaults`,
  **solo en las claves que ya declaraste**: una clave del JSON que el componente no
  espera no entra al store.

  ```js
  get store() {
    return (this._store ??= Homly.createStore(
      Homly.initial(this, { titulo: '', propiedades: [] }),
    ));
  }
  ```

- **`store.resource(nombre, deps, fetcher, { initial })`** — con `initial` presente
  (incluso `null`), arranca con ese valor y **no dispara el primer fetch**; los cambios
  de dependencias posteriores sí refetchean, igual que siempre.

  ```js
  const seed = Homly.initial(this, {});
  const s = Homly.createStore({});
  s.resource('propiedades', ['q'], fetcher,
    'propiedades' in seed ? { initial: seed.propiedades } : {});
  ```

- **Límite de componente:** `bindView`/`bindList` nunca alcanzan el markup de un
  componente anidado — cada `HomlyComponent` bindea solo lo suyo, aunque comparta el DOM
  ligero con su padre (homly no usa Shadow DOM). Esto es lo que hace seguro adoptar HTML
  con componentes hijos ya prerenderizados.

**`renderers/homly.php`** (PHP 8.4, `Dom\HTMLDocument`, sin dependencias) es la mitad
servidor del mismo protocolo: rellena `data-bind`/`data-if`/`data-bind-attr`/
`data-bind-class`/`data-for` contra un array de estado, marca cada fila con
`data-homly-key` y conserva el `<template>` para que el cliente la adopte.

```php
use Homly\Render;

echo Render::template($html, [
    'titulo' => 'Casas en Barquisimeto',
    'items' => [/* … */],
]);
// ::fragment($html, $state) hace lo mismo sin la isla de estado — para embeber
// dentro de una página/componente cuyo store ya la trae sembrada.
```

`conformance/` tiene el kit que prueba que ambos lados están de acuerdo: más de 20
fixtures (`template.html` + `state.json` + `expected.html`), un runner
(`php conformance/run.php`) que re-renderiza cada una y la compara byte a byte contra
el `expected.html` commiteado, y el oráculo `tests/dom/conformance.html`, que hidrata
esos mismos `expected.html` con homly.js y confirma cero mutaciones, el estado leído
del DOM igual al `state.json` y la interacción funcionando.

## Eventos: `data-action="evento->acción"`

Sin flecha, `data-action="nombre"` sigue siendo `click`, igual que en versiones
anteriores. Con flecha, cualquier evento del DOM sirve — los que más se usan son
`submit`, `change`, `input` y `keydown` (con un modificador de tecla):

```html
<form data-action="submit->guardar">
  <input name="nombre" data-action="keydown.enter->enviar">
  <select data-action="change->filtrar">…</select>
</form>
```

- **`ctx.event`** es el evento real (antes solo llegaban `target` y `ctx`): `ctx.event.key`,
  `ctx.event.target`, etc.
- **`ctx.formData`** — en un `submit`, `new FormData(target)` ya armado.
- **`preventDefault` es automático** cuando hay un handler para el evento: un `<form
  data-action="submit->guardar">` no recarga la página, un `<a href data-action="click->favorito">`
  no navega. Para el caso raro donde SÍ quieres el comportamiento nativo además de tu
  handler, agrega `data-action-default` al elemento.
- **Gana el host más interno.** Un botón dentro de una tarjeta, dentro de una página, con
  la misma acción `guardar` en ambos niveles: solo corre el de la tarjeta (antes corría
  en los dos).
- **El estado de carga (`is-loading`, `data-loading-text`, deshabilitar el control) solo
  se activa si la acción devuelve una `Promise`.** Un handler síncrono no lo dispara.
- **`homly:action-error`** se dispara en el contenedor (con `bubbles: true`) si la acción
  lanza o su promesa se rechaza — `e.detail` trae `{ name, error }`. Sin este evento, un
  error en una acción quedaba solo en la consola.

## Acciones por fila: `ctx.item`

Un botón adentro de un `data-for` recibe la fila de la que salió en el contexto de la
acción, sin tener que estampar ids en el markup y volver a leerlos con `closest`:

```html
<template data-for="propiedades" data-key="id">
  <article>
    <strong data-bind="titulo"></strong>
    <button data-action="borrar" data-loading-text="Borrando…">Borrar</button>
  </article>
</template>
```

```js
get actions() {
  return {
    borrar: async (target, { item }) => {
      await fetch(`/api/propiedades/${item.state.id}`, { method: 'DELETE' });
      const s = this.store;
      s.state.propiedades = s.state.propiedades.filter(p => p.id !== item.state.id);
    },
  };
}
```

- `ctx.item` es el **store de esa fila**, así que `item.state.campo` lee cualquiera de
  sus campos (incluido el `data-index`, si lo declaraste).
- Gana la fila **más cercana**: en una lista anidada, un click resuelve a la fila interna.
- Una acción que no está dentro de ningún `data-for` no recibe `item` — el contexto
  queda como siempre (`{ signal, host }`).
- Escribir en `item.state` actualiza **solo esa fila**, útil para un cambio optimista
  mientras corre el request. Ojo: no toca el array del store, así que el próximo cambio
  del array lo sobrescribe. Para que persista, reasigna el array.

**La fila ve las claves del padre** (pero gana la fila): una directiva dentro de un
`data-for` que enlaza una clave que el ítem no tiene cae al store del componente, así que
`data-if="esAdmin"` (una clave del componente, no del ítem) funciona dentro de la lista
sin tener que copiar `esAdmin` en cada fila:

```html
<template data-for="propiedades" data-key="id">
  <article>
    <strong data-bind="titulo"></strong>            <!-- del ítem -->
    <button data-if="esAdmin" data-action="borrar">Borrar</button>  <!-- del componente -->
  </article>
</template>
```

Si el ítem SÍ tiene esa clave (`{ id, titulo, moneda: 'VES' }` con el componente en
`moneda: 'USD'`), gana la del ítem. `renderers/homly.php` sigue la misma regla.

## Filtros en la URL: `Homly.bindQuery`

Un listado filtrado que no se puede pasar por WhatsApp no sirve. `bindQuery` espeja las
claves que le digas en el query string, en las dos direcciones:

```js
get store() {
  return (this._store ??= (() => {
    const s = Homly.createStore({ q: '', orden: 'fecha', pagina: 1, conFoto: false });

    // ⚠️ Antes del resource: así el primer fetch ya usa los filtros de la URL.
    Homly.bindQuery(s, ['q', 'orden', 'pagina', 'conFoto'], this.signal);

    s.resource('propiedades', ['q', 'orden', 'pagina', 'conFoto'], (q, orden, pagina, conFoto, { signal }) =>
      fetch(`/api/propiedades?${new URLSearchParams({ q, orden, pagina, conFoto })}`, { signal })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      { debounce: 300 },
    );

    return s;
  })());
}
```

Con eso, `/propiedades?q=casa&orden=precio` abre el listado ya filtrado, y tocar un filtro
actualiza la URL sola.

- **Los tipos se conservan.** La URL solo tiene strings, así que `bindQuery` castea según
  el valor inicial de cada clave: `pagina: 1` vuelve como número, `conFoto: false` como
  booleano. Sin eso, `pagina + 1` te daría `'21'`.
- **Una clave cuyo valor inicial es un array es un param repetido**: `tipo: []` lee
  `?tipo=casa&tipo=apto` como `['casa', 'apto']` (`getAll`) y lo escribe de vuelta con
  `append` — un `[]` deja la URL limpia, igual que cualquier otro valor en su default.
- **Una clave en su default no ensucia la URL.** Un listado sin tocar queda en
  `/propiedades`, no en `/propiedades?q=&orden=fecha&pagina=1`.
- **Usa `replaceState`**, así tipear en un filtro no apila una entrada de historial por
  tecla. Irte a otra ruta y volver con el botón atrás sí restaura los filtros.
- **Varias claves cambiadas en el mismo tick escriben la URL una sola vez** (microtask),
  no un `replaceState` por cada asignación.
- **Una clave que desaparece de la URL vuelve a su default**, en vez de quedar pegada.
- **Se limpia sola** con el `signal` del componente.

## Título y meta al navegar: `Homly.head`

```js
onMount() {
  Homly.head({
    title: `${this.getAttribute('slug')} — homly`,
    description: 'Un post del blog',
    canonical: `https://homly.dev/blog/${this.getAttribute('slug')}`,
    'og:image': '/img/portada.png',
    'article:author': 'Ana',
    jsonld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'Un post del blog' },
  });
}
```

Crea cada tag la primera vez y lo actualiza después, así llamarlo en cada navegación no
duplica nada. Un valor vacío (o `null`) borra el tag.

- `title` — `document.title`, como siempre.
- `canonical` — un `<link rel="canonical">` (no un `<meta>`).
- `jsonld` — un objeto, serializado en un `<script type="application/ld+json"
  data-homly-head="jsonld">`.
- `og:*`, `article:*`, `product:*`, `profile:*` y `fb:*` se escriben como `property`
  (lo que Open Graph espera); el resto, como `name`.
- Una clave con comillas u otros caracteres raros no rompe el `<head>`: el selector que
  busca el tag existente pasa por `CSS.escape`.

> ⚠️ **Esto no es SEO.** Los scrapers de WhatsApp, Twitter y Slack **no ejecutan
> JavaScript**: un `og:image` escrito aquí, después de hidratar, no existe para ellos. Para
> que un link se previsualice bien y para que Google indexe, los tags tienen que venir en
> el HTML que sirve el servidor — que es justo lo que el router sabe adoptar (ver
> *prerender*). Lo que `head` sí arregla es que la pestaña y el historial digan lo
> correcto mientras te movés por la SPA.

## Varios sitios que se enlazan entre sí

Un `data-router-link` que apunta a **otro dominio** el router lo deja pasar como
navegación normal, en vez de romper con un `SecurityError` de `pushState`. Así un
header compartido entre sitios hermanos puede llevar todos los links marcados igual:

```html
<nav>
  <a href="/docs"                 data-router-link>Docs</a>      <!-- lo toma el router -->
  <a href="https://homly.blog"    data-router-link>Blog</a>      <!-- navegación real -->
  <a href="/guia.pdf" download    data-router-link>Guía</a>      <!-- descarga -->
  <a href="/docs" target="_blank" data-router-link>Docs ↗</a>    <!-- pestaña nueva -->
</nav>
```

También deja pasar ⌘/Ctrl/Shift/Alt+click y el click del medio, así "abrir en pestaña
nueva" sigue funcionando en cualquier link del router.

## Prefetch en hover

Automático, sin configuración: pasar el mouse por un `<a data-router-link>` —o tabular
hasta él— dispara el `import()` de esa ruta, así al hacer click el chunk ya está. Cada
ruta se baja una sola vez, y un prefetch que falla se ignora (al navegar de verdad se
reintenta).

También puedes llamarlo a mano para una ruta que sabes que viene después:

```js
router.prefetch('/checkout');
```

## Valores vs efectos: `computed`, binding o `subscribe`

La pregunta que decide la herramienta: **¿el cálculo vuelve al sistema reactivo/DOM, o sale hacia afuera?**

- **Derivar un valor** (que vas a mostrar en pantalla) → `computed` + `data-bind`. Ej.: `precioVes = precio × rate`.
- **Reflejarlo en la vista** → directivas declarativas (`data-bind`, `data-if`, `data-bind-class`, `data-for`…).
- **Correr un efecto** hacia algo que NO es homly (una librería externa, una API del browser, la red, `localStorage`) → suscríbete a la señal con `this.signal` (limpieza automática):

```js
onMount() {
  // re-centrar un mapa de Leaflet (objeto NO-homly) cuando cambian las coords
  this.store.signals.coords.subscribe(c => this.map.setView([c.lat, c.lng]), this.signal);
}
```

`subscribe(fn, this.signal)` se autolimpia al desmontar (cero leaks) y es **eager**: corre una vez al suscribir + en cada cambio.

| Necesidad | El resultado va a… | Herramienta |
|---|---|---|
| Recalcular un precio cuando cambia la tasa | tu DOM | `computed` + `data-bind` |
| Mostrar/ocultar una sección | tu DOM | `data-if` |
| Re-centrar un mapa de Leaflet | un objeto externo | `subscribe` |
| `document.title`, analytics, `localStorage` | browser / red | `subscribe` |

No hay (ni hace falta) un `onUpdate`: **los valores los hace `computed`, la vista los bindings, y el efecto imperativo —el caso raro— es una línea de `subscribe`.**

## Estilos y CSP

El CSS de `styleUrl`/`styles` se envuelve en `@scope (tag)`, así no se filtra fuera del
componente — pero, a partir de 1.10, **una sola hoja por clase de componente**, no una
por instancia: la primera tarjeta de una grilla de 100 instala la hoja (vía
`document.adoptedStyleSheets`); las otras 99 la reutilizan.

```js
class PropertyCard extends HomlyComponent {
  get styles() { return '.precio { font-weight: 600; }'; }
}
```

- **CSP estricta, sin `'unsafe-inline'`.** `adoptedStyleSheets` no es un recurso de
  estilo "inline" para la CSP: una página servida con `style-src 'self'` (sin nonce ni
  hash) queda con 0 violaciones. `Homly.styleNonce = '…'` es para el caso donde el
  navegador no soporta hojas construibles y hace falta el `<style>` de respaldo.
- **`[data-if][hidden] { display: none !important }`** se instala una sola vez, para que
  el CSS propio de un componente (con más especificidad dentro de su `@scope`) nunca
  pueda dejar visible algo que `data-if` ocultó.
- **`Homly.styleMode = 'inline'`** vuelve al `<style data-homly-scope>` por instancia de
  antes de 1.10 (una hoja por tarjeta, no compartida) — úsalo solo si algo depende del
  orden exacto de cascada de esa versión. Se retira en 2.0.
- **`renderError`** ya no escribe un `style=` inline: el placeholder usa una regla de la
  hoja compartida, y su texto sale de `Homly.messages.loadError` (reasignable).

## Detalles

- Si un componente ya trae contenido en el HTML, se hidrata sin volver a pedir la
  plantilla. Sirve para dejar inline el contenido above-the-fold.
- **Reconciliación de `data-for` con LIS + `moveBefore`:** cambiar el orden de una lista
  mueve solo lo estrictamente necesario (dos elementos que cambian de lugar en una lista
  de 1.000 son dos movimientos, no 997) y usa `Element.moveBefore` cuando el navegador lo
  soporta, así un Custom Element movido no se desmonta ni se vuelve a hidratar. Las filas
  que se van se quitan antes de mover las que quedan.
- **Cache + request collapsing:** las plantillas/CSS se cachean por URL (volver a un
  módulo no re-descarga), y si varios componentes piden el mismo archivo a la vez se
  lanza un solo `fetch` compartido.
- **Error boundary:** si la hidratación falla (p. ej. la plantilla no carga), el
  componente muestra un placeholder en vez de romper el DOM. Sobrescribe `renderError(err)`
  para personalizar el mensaje.
- Las **computed signals** convierten el estado en un grafo reactivo: derivas un
  valor de otras señales y se mantiene solo, sin recalcular a mano.

## Depuración (`HOM_DEBUG`)

homly.js trae un logger de desarrollo opt-in (apagado por defecto, **sin costo en producción**). Se prende de tres formas, según el caso:

- **En vivo, desde DevTools:** `window.HOM_DEBUG = true` (o `'verbose'`). Toggle inmediato, sin dejar rastro.
- **Por enlace (QA/cliente):** agrega `?homly-debug` o `?homly-debug=verbose` a la URL. Atrapa la hidratación desde el primer milisegundo.
- **Persistente entre recargas:** `localStorage.HOM_DEBUG = 'verbose'` en la consola; sobrevive a los F5.

Precedencia: lo seteado en `window` gana sobre el query param, y este sobre `localStorage`.

Dos niveles:

- **`true`** (básico) — ciclo de vida e hidratación (`⬆ <tag> hydrated in Xms`), cache de plantillas (`fetch`/`cache HIT`/`collapse`), router (`⚡ route …`, `keep-alive HIT/MISS`, `activate`/`deactivate`) y *warnings* de errores comunes (store sin memoizar, `data-for` sin su array).
- **`'verbose'`** — todo lo anterior **más** cada cambio de señal (`✎ signal precio: 199 → 249`) y cada recompute de computed (`↳ computed precioVes recompute: …`).

Cada *warning* trae un código estable entre corchetes, `[homly Hxxx]`, para buscarlo sin
depender del texto exacto (que puede cambiar de una versión a otra): `errors.json`, en la
raíz del repo, tiene la lista completa con una línea de descripción por código.

## Patrón: panel / SPA con módulos lazy

Para un panel de administración (o cualquier SPA con muchas secciones) el patrón es:

- **Shell persistente** — el sidebar y el topbar viven en `index.html` (o en componentes montados una sola vez), fuera del contenedor que cambia el router. Nunca se destruyen, así que su estado y sus suscripciones siguen vivos.
- **Módulos = rutas lazy** — cada módulo se descarga solo al navegar a él:

  ```js
  router.add('/login',          'admin-login',          () => import('./modules/login/login.js'));
  router.add('/dashboard',      'admin-dashboard',      () => import('./modules/dashboard/dashboard.js'));
  router.add('/conversaciones', 'admin-conversaciones', () => import('./modules/conversaciones/conversaciones.js'));
  ```

- **Islands** — cada widget del dashboard es un componente propio (y puede ser lazy: importalo en `onMount` del módulo). Cada uno hidrata y mantiene su estado por separado.
- **Estado global compartido** — un store es un singleton de módulo; cualquier componente lo enlaza con `get globalStores() { return [miStore]; }`. Sirve para que, por ejemplo, un mensaje entrante actualice un badge en el menú aunque estés en otra ruta:

  ```js
  // stores/notifications.js
  export const notifications = Homly.createStore({ unread: 0 });
  ```
  ```html
  <!-- en el sidebar (persistente) -->
  <a href="/conversaciones" data-router-link data-bind-class="alert:unread">
    Conversaciones <span class="badge" data-if="unread" data-bind="unread"></span>
  </a>
  ```

- **Guard de auth** — envuelve `handleRoute` para redirigir según la sesión:

  ```js
  const base = router.handleRoute.bind(router);
  router.handleRoute = async (path) => {
    if (!auth.state.isAuthenticated && path !== '/login') return router.navigate('/login');
    await base(path);
  };
  ```

- **Volver a un módulo no re-descarga nada** — el `import()` lo cachea el navegador y las plantillas/CSS quedan en el cache interno de `loadTemplate`. Al regresar, el módulo se vuelve a renderizar desde cache, sin red. Para que además los **datos** persistan entre navegaciones, guárdalos en un store global (no en estado local del componente). Y si quieres preservar el **DOM/scroll exacto** (por ejemplo el scroll de un chat o un listado largo), activa keep-alive: `new HomlyRouter('outlet', { keepAlive: true })` — el módulo se oculta en vez de destruirse y vuelve instantáneo, disparando `onActivate`/`onDeactivate`.

## Caso de éxito

[**homly.world**](https://homly.world) — la landing del CRM inmobiliario Homly está hecha íntegramente con homly.js: Web Components, reactividad por señales, code splitting por ruta y CSS aislado con `@scope`, sin build. El código es abierto: [github.com/softronicve/homly-landing](https://github.com/softronicve/homly-landing).

## Tests

```bash
npm test           # lógica pura, Node, sin navegador
npm run test:browser   # ciclo de vida, DOM, eventos confiables (usa Chrome + puppeteer-core, solo de desarrollo)
npm run test:php       # renderers/homly.php + el kit de conformidad (necesita PHP 8.4)
npm run size            # tamaño real, minificado y gzip -9 (esbuild vía npx, solo de desarrollo)
```

`npm test` corre con el `assert` de Node: sin dependencias de runtime, sin build. Cubre
lo que falla en silencio —el matcheo de rutas, las carreras de respuestas de `resource`,
el casteo de tipos de `bindQuery`— y no mucho más. El número de checks lo imprime cada
corrida; no se escribe a mano aquí para no quedar desactualizado.

Lo que necesita DOM real (ciclo de vida de Custom Elements, `<template>`/`data-for`,
historial, eventos confiables) vive en `tests/dom/*.html` y corre con
`npm run test:browser`, o se abre a mano desde `tests/index.html`. En las
[guías de contribución](CONTRIBUTING.md) está el detalle de qué protege cada archivo y
qué merece un test.

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! La rama `main` está protegida: todo cambio entra por Pull Request.

1. Haz un fork del repositorio.
2. Crea tu rama de feature (`git checkout -b feature/mi-feature`).
3. Haz commit de tus cambios (`git commit -m 'Agrega mi feature'`).
4. Sube la rama (`git push origin feature/mi-feature`).
5. Abre un Pull Request.

Los PR los valida y mergea el creador (o quien tenga permiso de escritura). Antes de empezar, lee la [guía de contribución](CONTRIBUTING.md) para conocer los estándares de código.

## Licencia

MIT
