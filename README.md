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
import { HomlyComponent, Homly } from 'https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.1.0/homly.js';
```

O, para no repetir la URL en cada componente, declará un import map en tu `index.html` y usá un specifier corto:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<script type="importmap">
{ "imports": { "homly": "https://cdn.jsdelivr.net/gh/softronicve/homly-framework@v1.1.0/homly.js" } }
</script>
```

```js
import { HomlyComponent, Homly } from 'homly';
```

Fijá siempre una versión (`@v1.1.0`); evitá `@latest` o `@main` en producción, porque cambian sin aviso. También podés descargar `homly.js` y servirlo desde tu propio dominio.

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

## API

- `HomlyComponent` — clase base. Getters: `templateUrl`, `styleUrl`, `basePath`,
  `store`, `actions`. Hooks: `onMount`, `onUnmount`.
- `Homly.createStore(estado)` — devuelve `{ state, signals }`. Mutás con
  `store.state.clave = valor`.
- `HomlyRouter` — router SPA mínimo. Intercepta `<a data-router-link>`.

## Detalles

- Si un componente ya trae contenido en el HTML, se hidrata sin volver a pedir la
  plantilla. Sirve para dejar inline el contenido above-the-fold.
- El CSS de `styleUrl` se envuelve en `@scope`, así no se filtra fuera del componente.

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
