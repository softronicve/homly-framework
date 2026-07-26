# homly.js

Micro-framework de Web Components con reactividad por señales. Vanilla JS, sin
dependencias y sin paso de build: corre directo en el navegador.

La idea es simple:

- Cada componente es un Custom Element que hereda de `HomlyComponent`.
- El HTML y el CSS van en archivos aparte; el JS los carga con `templateUrl` y `styleUrl`.
- El estado es reactivo: una señal por variable. El DOM se enlaza con atributos `data-*`.
- Los eventos se manejan con `data-action`.

## Instalación

No hay nada que instalar ni compilar. Podés cargar `homly.js` desde un CDN, fijando la versión por tag:

```js
import { HomlyComponent, Homly } from 'https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.9.0/homly.js';
```

O, para no repetir la URL en cada componente, declará un import map en tu `index.html` y usá un specifier corto:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<script type="importmap">
{ "imports": { "homly": "https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.9.0/homly.js" } }
</script>
```

```js
import { HomlyComponent, Homly } from 'homly';
```

Fijá siempre una versión (`@v1.9.0`); evitá `@latest` o `@main` en producción, porque cambian sin aviso. También podés descargar `homly.js` y servirlo desde tu propio dominio.

## Ejemplo

```js
import { HomlyComponent, Homly } from 'homly';

class Contador extends HomlyComponent {
  get basePath() { return import.meta.url; }
  get templateUrl() { return './contador.html'; }
  get styleUrl() { return './contador.css'; }

  // Memoizá el store (el ??=) para que la vista y las acciones usen la misma instancia.
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
- `data-bind-class="clase:clave"` — agrega o quita una clase.
- `data-bind-attr="atributo:clave"` — enlaza un atributo (por ejemplo `href`).
- `data-model="clave"` — enlace de doble vía en `input`, `textarea`, `select` y checkbox:
  la señal escribe el control y el control escribe la señal (`change` en `select` y
  checkbox, `input` en el resto). En un checkbox se enlaza `checked`, no `value`.
- `data-action="nombre"` — conecta un click a `actions[nombre]`.
- `data-loading-text="…"` — mientras una acción asíncrona corre, el framework gestiona solo el estado de carga del control: lo deshabilita, le agrega la clase `is-loading` y, si tiene `data-loading-text`, le pone ese texto. Al terminar, restaura el estado (el texto solo se restaura si la acción no lo cambió ella misma). No hace falta tocar el botón a mano.
- `data-for="clave"` en un `<template>` — renderiza una lista desde un array del
  store. Requiere `data-key="campo"` (identidad para reusar nodos al cambiar el
  array) y acepta `data-index="i"` (expone el índice 0-based, reactivo). Adentro,
  las directivas normales (`data-bind`, etc.) resuelven contra cada ítem. Para que
  reaccione, reasigná el array con una referencia nueva: `store.state.items = [...next]`.
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
// para que reaccione, reasigná con una referencia nueva (no mutes in-place):
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
  del store: `nombre`, `nombreLoading` y `nombreError` (ver abajo).
- `Homly.bindQuery(store, [keys], signal)` — espeja esas keys en el query string, así un
  listado filtrado se puede compartir por URL y sobrevive un F5 (ver abajo).
- `Homly.head({ title, description, … })` — título y `<meta>` de la pestaña al navegar.
  **No es SEO** (ver abajo).
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
- **La cantidad de segmentos tiene que coincidir.** `/blog/:slug` matchea `/blog/hola`,
  pero no `/blog` ni `/blog/a/b`. Un segmento vacío (`/blog/`) tampoco matchea.
- **El valor se decodifica**: `/buscar/caf%C3%A9` llega como `café`.
- **Sin riesgo de inyección**: los params se aplican con `setAttribute`, que nunca
  interpreta HTML. Igual, para escribirlos en la página usá `data-bind` o `textContent`.
- **Los params van en minúscula.** HTML baja los nombres de atributo, así que
  `/u/:userId` se lee con `getAttribute('userid')`. Usá kebab-case (`:user-id`); con
  `HOM_DEBUG` el framework avisa al registrar la ruta.
- **Con keep-alive, cada path es su propia entrada**: `/blog/a` y `/blog/b` conservan
  su DOM y su estado por separado.
- **Con DOM prerenderizado**, los atributos tienen que estar escritos en el markup
  (`<blog-post slug="hola-mundo">`): cuando el router adopta el elemento, su `onMount`
  ya corrió. Con `HOM_DEBUG` el framework avisa si falta alguno.

El componente se monta de nuevo en cada navegación, así que `onMount` vuelve a leer el
atributo. Si querés que una ruta cambie de param **sin** remontar (keep-alive de
`/blog/a` a `/blog/b`), usá `observedAttributes` + `attributeChangedCallback`, que ya
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

Qué hace por vos:

- **Se re-dispara solo** cuando cambia cualquiera de sus deps. Con `[]` carga una vez.
- **Ninguna respuesta vieja pisa a una nueva.** Cada corrida aborta la anterior y lleva
  un token; si la primera request tarda más que la segunda, se descarta. Es el bug que
  aparece una de cada veinte búsquedas y que no se ve leyendo el código.
- **El fetcher recibe un `{ signal }`** al final: pasáselo a `fetch` y el navegador
  cancela de verdad la request abortada.
- **En error conserva el último valor bueno.** Un refresh que falla no te blanquea la
  lista que ya está en pantalla; `nombreError` te dice qué pasó.
- **`debounce`** agrupa cambios rápidos (tipear en un filtro) en un solo request. La
  primera carga nunca se retrasa.
- **Devuelve `{ refresh }`** para un botón de reintentar.

`fetch` no tira error con un 404 o un 500, así que **chequeá `response.ok` y lanzá vos**
si querés que llegue a `nombreError`.

Para filtrar del lado del cliente sin volver a pegarle a la API, poné una `computed`
encima del resource:

```js
s.computed('visibles', ['propiedades', 'soloConFoto'],
  (props, soloConFoto) => (props || []).filter(p => !soloConFoto || p.foto));
```

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
  del array lo pisa. Para que persista, reasigná el array.

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
- **Una clave en su default no ensucia la URL.** Un listado sin tocar queda en
  `/propiedades`, no en `/propiedades?q=&orden=fecha&pagina=1`.
- **Usa `replaceState`**, así tipear en un filtro no apila una entrada de historial por
  tecla. Irte a otra ruta y volver con el botón atrás sí restaura los filtros.
- **Una clave que desaparece de la URL vuelve a su default**, en vez de quedar pegada.
- **Se limpia sola** con el `signal` del componente.

## Título y meta al navegar: `Homly.head`

```js
onMount() {
  Homly.head({
    title: `${this.getAttribute('slug')} — homly`,
    description: 'Un post del blog',
    'og:image': '/img/portada.png',
  });
}
```

Crea cada tag la primera vez y lo actualiza después, así llamarlo en cada navegación no
duplica nada. Un valor vacío borra el tag. Las claves `og:*` se escriben como `property`;
el resto, como `name`.

> ⚠️ **Esto no es SEO.** Los scrapers de WhatsApp, Twitter y Slack **no ejecutan
> JavaScript**: un `og:image` puesto acá, después de hidratar, no existe para ellos. Para
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

También lo podés llamar a mano para una ruta que sabés que sigue:

```js
router.prefetch('/checkout');
```

## Valores vs efectos: `computed`, binding o `subscribe`

La pregunta que decide la herramienta: **¿el cálculo vuelve al sistema reactivo/DOM, o sale hacia afuera?**

- **Derivar un valor** (que vas a mostrar) → `computed` + `data-bind`. Ej.: `precioVes = precio × rate`.
- **Reflejarlo en la vista** → directivas declarativas (`data-bind`, `data-if`, `data-bind-class`, `data-for`…).
- **Correr un efecto** hacia algo que NO es homly (una librería externa, una API del browser, la red, `localStorage`) → suscribite a la señal con `this.signal` (auto-cleanup):

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

## Detalles

- Si un componente ya trae contenido en el HTML, se hidrata sin volver a pedir la
  plantilla. Sirve para dejar inline el contenido above-the-fold.
- El CSS de `styleUrl` se envuelve en `@scope`, así no se filtra fuera del componente.
- **Cache + request collapsing:** las plantillas/CSS se cachean por URL (volver a un
  módulo no re-descarga), y si varios componentes piden el mismo archivo a la vez se
  lanza un solo `fetch` compartido.
- **Error boundary:** si la hidratación falla (p. ej. la plantilla no carga), el
  componente muestra un placeholder en vez de romper el DOM. Sobrescribí `renderError(err)`
  para personalizar el mensaje.
- Las **computed signals** convierten el estado en un grafo reactivo: derivás un
  valor de otras señales y se mantiene solo, sin recalcular a mano.

## Depuración (`HOM_DEBUG`)

homly.js trae un logger de desarrollo opt-in (apagado por defecto, **sin costo en producción**). Se prende de tres formas, según el caso:

- **En vivo, desde DevTools:** `window.HOM_DEBUG = true` (o `'verbose'`). Toggle inmediato, sin dejar rastro.
- **Por link (QA/cliente):** agregá `?homly-debug` o `?homly-debug=verbose` a la URL. Atrapa la hidratación desde el primer milisegundo.
- **Persistente entre recargas:** `localStorage.HOM_DEBUG = 'verbose'` en la consola; sobrevive a los F5.

Precedencia: lo seteado en `window` gana sobre el query param, y este sobre `localStorage`.

Dos niveles:

- **`true`** (básico) — ciclo de vida e hidratación (`⬆ <tag> hydrated in Xms`), cache de plantillas (`fetch`/`cache HIT`/`collapse`), router (`⚡ route …`, `keep-alive HIT/MISS`, `activate`/`deactivate`) y *warnings* de errores comunes (store sin memoizar, `data-for` sin su array).
- **`'verbose'`** — todo lo anterior **más** cada cambio de señal (`✎ signal precio: 199 → 249`) y cada recompute de computed (`↳ computed precioVes recompute: …`).

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

- **Guard de auth** — envolvé `handleRoute` para redirigir según la sesión:

  ```js
  const base = router.handleRoute.bind(router);
  router.handleRoute = async (path) => {
    if (!auth.state.isAuthenticated && path !== '/login') return router.navigate('/login');
    await base(path);
  };
  ```

- **Volver a un módulo no re-descarga nada** — el `import()` lo cachea el navegador y las plantillas/CSS quedan en el cache interno de `loadTemplate`. Al regresar, el módulo se vuelve a renderizar desde cache, sin red. Para que además los **datos** persistan entre navegaciones, guardalos en un store global (no en estado local del componente). Y si querés preservar el **DOM/scroll exacto** (por ejemplo el scroll de un chat o un listado largo), activá keep-alive: `new HomlyRouter('outlet', { keepAlive: true })` — el módulo se oculta en vez de destruirse y vuelve instantáneo, disparando `onActivate`/`onDeactivate`.

## Caso de éxito

[**homly.world**](https://homly.world) — la landing del CRM inmobiliario Homly está hecha íntegramente con homly.js: Web Components, reactividad por señales, code splitting por ruta y CSS aislado con `@scope`, sin build. El código es abierto: [github.com/softronicve/homly-landing](https://github.com/softronicve/homly-landing).

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! La rama `main` está protegida: todo cambio entra por Pull Request.

1. Hacé un fork del repositorio.
2. Creá tu rama de feature (`git checkout -b feature/mi-feature`).
3. Commiteá tus cambios (`git commit -m 'Agrega mi feature'`).
4. Pusheá la rama (`git push origin feature/mi-feature`).
5. Abrí un Pull Request.

Los PR los valida y mergea el creador (o quien tenga permiso de escritura). Antes de empezar, leé las [guías de contribución](CONTRIBUTING.md) para los estándares de código.

## Licencia

MIT
