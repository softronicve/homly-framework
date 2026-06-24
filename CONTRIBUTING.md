# Contribuir a homly.js

¡Gracias por querer aportar! `homly.js` es un micro-framework de Web Components en vanilla JS, sin dependencias ni build.

## Flujo de trabajo

La rama `main` está protegida: **todo cambio entra por Pull Request** y lo valida/mergea el creador (o quien tenga permiso de escritura).

1. Hacé un fork del repositorio.
2. Creá tu rama de feature: `git checkout -b feature/mi-feature`.
3. Commiteá tus cambios: `git commit -m 'Agrega mi feature'`.
4. Pusheá la rama: `git push origin feature/mi-feature`.
5. Abrí un Pull Request hacia `main` y esperá la revisión.

## Estándares de código

- **Cero dependencias, sin build.** Nada de paquetes en runtime ni compiladores: tiene que correr directo en el navegador.
- **Web Components nativos.** Cada componente hereda de `HomlyComponent` y se registra con `customElements.define`.
- **HTML y CSS aparte.** Un componente = una carpeta con `<nombre>.js` + `<nombre>.html` + `<nombre>.css`. El JS los referencia con rutas relativas (`./`) usando `get basePath() { return import.meta.url; }`.
- **CSS aislado.** Va por `styleUrl` (o `styles` inline); el motor lo envuelve en `@scope`. Evitá estilos globales que se filtren.
- **Reactividad declarativa.** El estado vive en el store; la vista se enlaza con `data-bind`/`data-if`/`data-bind-class`/`data-bind-attr`/`data-model`. No manipules el DOM a mano en la lógica.
- **Eventos por `data-action`.** Nada de `onclick` inline para la lógica de negocio.
- **Memoizá el store:** `get store() { return (this._store ??= Homly.createStore({ ... })); }`.
- **JSDoc en inglés** para la API pública; comentarios concisos.
- Indentación de 2 espacios.

## Probar los cambios

Todavía no hay framework de tests: probá el componente en un navegador real (cargá una página que lo use y verificá render, reactividad y que no haya errores en consola).

## Commits y PRs

- Mensajes de commit claros y descriptivos.
- Un PR por feature/fix; explicá el qué y el porqué.
