/**
 * homly.js — micro-framework de Web Components con reactividad por señales.
 * Sin dependencias, sin build.
 */

export class Homly {
  static templateCache = new Map();

  // Descarga un archivo de texto (plantilla o CSS) y lo cachea por URL.
  static async loadTemplate(url) {
    if (this.templateCache.has(url)) return this.templateCache.get(url);
    const response = await fetch(url);
    const html = await response.text();
    this.templateCache.set(url, html);
    return html;
  }

  // Crea una señal por cada clave del estado inicial.
  static createStore(initialState) {
    const signals = {};
    const subscribers = {};

    for (const key in initialState) {
      let value = initialState[key];
      subscribers[key] = new Set();

      signals[key] = {
        subscribe: (fn, abortSignal) => {
          subscribers[key].add(fn);
          if (abortSignal) {
            abortSignal.addEventListener('abort', () => subscribers[key].delete(fn), { once: true });
          }
          fn(value);
        },
        set: (newVal) => {
          if (value === newVal) return;
          value = newVal;
          subscribers[key].forEach(fn => fn(value));
        },
        get: () => value,
      };
    }

    // Proxy para leer y escribir como store.state.clave.
    const stateProxy = new Proxy({}, {
      get(_, prop) { return signals[prop] ? signals[prop].get() : undefined; },
      set(_, prop, val) {
        if (signals[prop]) signals[prop].set(val);
        return true;
      },
    });

    return { state: stateProxy, signals };
  }

  // Enlaza el DOM al store mediante atributos data-*.
  static bindView(container, store, signal) {
    container.querySelectorAll('[data-bind]').forEach(el => {
      const key = el.getAttribute('data-bind');
      if (store.signals[key]) {
        store.signals[key].subscribe((val) => {
          const newVal = val !== undefined ? String(val) : '';
          if (el.textContent !== newVal) el.textContent = newVal;
        }, signal);
      }
    });

    container.querySelectorAll('[data-if]').forEach(el => {
      const key = el.getAttribute('data-if');
      if (store.signals[key]) {
        store.signals[key].subscribe((val) => {
          if (!!val) el.removeAttribute('hidden');
          else el.setAttribute('hidden', '');
        }, signal);
      }
    });

    container.querySelectorAll('[data-bind-class]').forEach(el => {
      const [className, key] = el.getAttribute('data-bind-class').split(':');
      if (store.signals[key]) {
        store.signals[key].subscribe((val) => {
          if (val) el.classList.add(className);
          else el.classList.remove(className);
        }, signal);
      }
    });

    container.querySelectorAll('[data-bind-attr]').forEach(el => {
      const [attr, key] = el.getAttribute('data-bind-attr').split(':');
      if (store.signals[key]) {
        store.signals[key].subscribe((val) => {
          if (val === undefined || val === null || val === '') el.removeAttribute(attr);
          else el.setAttribute(attr, val);
        }, signal);
      }
    });
  }

  // Delegación de clicks: data-action="nombre" llama a actions[nombre].
  static attachDispatcher(container, actions, context = {}) {
    const handler = async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const actionName = target.getAttribute('data-action');
      if (actions[actionName]) await actions[actionName](target, context);
    };
    container.addEventListener('click', handler);
    if (context.signal) {
      context.signal.addEventListener('abort', () => container.removeEventListener('click', handler), { once: true });
    }
  }
}

export class HomlyComponent extends HTMLElement {
  constructor() {
    super();
    this.controller = new AbortController();
    this.signal = this.controller.signal;
  }

  async connectedCallback() {
    const resolve = (path) => (this.basePath ? new URL(path, this.basePath).href : path);

    // Si el componente ya trae contenido en el HTML, se hidrata sin volver a
    // descargar plantilla ni estilo.
    const prerendered = this.childElementCount > 0;

    if (!prerendered) {
      if (this.templateUrl) {
        this.innerHTML = await Homly.loadTemplate(resolve(this.templateUrl));
      } else if (this.template) {
        this.innerHTML = this.template();
      }

      // El CSS de styleUrl se envuelve en @scope para que no se filtre fuera del componente.
      if (this.styleUrl) {
        const css = await Homly.loadTemplate(resolve(this.styleUrl));
        const styleBlock = document.createElement('style');
        styleBlock.textContent = `@scope {\n${css}\n}`;
        this.prepend(styleBlock);
      }
    }

    if (this.store) Homly.bindView(this, this.store, this.signal);
    if (this.actions) Homly.attachDispatcher(this, this.actions, { signal: this.signal, host: this });
    if (this.onMount) this.onMount();
  }

  disconnectedCallback() {
    this.controller.abort();
    if (this.onUnmount) this.onUnmount();
  }

  get templateUrl() { return null; }
  get styleUrl() { return null; }
  get basePath() { return null; }
  get template() { return null; }
  get store() { return null; }
  get actions() { return null; }
}

export class HomlyRouter {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.routes = {};

    window.addEventListener('popstate', () => this.handleRoute(window.location.pathname));

    document.body.addEventListener('click', e => {
      const link = e.target.closest('a[data-router-link]');
      if (link) {
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
      }
    });
  }

  add(path, componentTag) {
    this.routes[path] = componentTag;
  }

  navigate(path) {
    window.history.pushState({}, '', path);
    this.handleRoute(path);
  }

  handleRoute(path) {
    const componentTag = this.routes[path] || this.routes['/404'] || '<div>404 No encontrado</div>';
    this.root.innerHTML = componentTag;
    window.scrollTo(0, 0);
  }

  start() {
    this.handleRoute(window.location.pathname);
  }
}
