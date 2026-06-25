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
import { HomlyComponent, Homly } from 'https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.6.0/homly.js';
```

O, para no repetir la URL en cada componente, declará un import map en tu `index.html` y usá un specifier corto:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<script type="importmap">
{ "imports": { "homly": "https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.6.0/homly.js" } }
</script>
```

```js
import { HomlyComponent, Homly } from 'homly';
```

Fijá siempre una versión (`@v1.6.0`); evitá `@latest` o `@main` en producción, porque cambian sin aviso. También podés descargar `homly.js` y servirlo desde tu propio dominio.

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
- `data-action="nombre"` — conecta un click a `actions[nombre]`.
- `data-loading-text="…"` — mientras una acción asíncrona corre, el framework gestiona solo el estado de carga del control: lo deshabilita, le agrega la clase `is-loading` y, si tiene `data-loading-text`, le pone ese texto. Al terminar, restaura el estado (el texto solo se restaura si la acción no lo cambió ella misma). No hace falta tocar el botón a mano.
- `data-for="clave"` en un `<template>` — renderiza una lista desde un array del
  store. Requiere `data-key="campo"` (identidad para reusar nodos al cambiar el
  array) y acepta `data-index="i"` (expone el índice 0-based, reactivo). Adentro,
  las directivas normales (`data-bind`, etc.) resuelven contra cada ítem. Para que
  reaccione, reasigná el array con una referencia nueva: `store.state.items = [...next]`.

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
- `HomlyRouter` — router SPA mínimo. Intercepta `<a data-router-link>` y permite
  lazy loading por ruta. Con `new HomlyRouter('root', { keepAlive: true })` conserva
  el DOM/estado/scroll de cada ruta visitada (la oculta en vez de destruirla) y llama
  a `onActivate`/`onDeactivate`; `evict(path)` la descarga de la cache.

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
